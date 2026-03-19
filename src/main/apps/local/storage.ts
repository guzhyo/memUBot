import * as fs from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'
import type { StoredLocalMessage } from './types'

const STORAGE_DIR = 'local-data'
const MESSAGES_FILE = 'messages.json'

/**
 * Local chat storage for desktop conversations.
 * Single-session in v1, but keeps sessionId for forward compatibility.
 */
export class LocalStorage {
  private storagePath: string
  private messages: StoredLocalMessage[] = []
  private initialized = false

  constructor() {
    this.storagePath = path.join(app.getPath('userData'), STORAGE_DIR)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    await fs.mkdir(this.storagePath, { recursive: true })
    await this.loadData()
    this.initialized = true
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  private async loadData(): Promise<void> {
    try {
      const messagesPath = path.join(this.storagePath, MESSAGES_FILE)
      const content = await fs.readFile(messagesPath, 'utf-8')
      const data = JSON.parse(content)

      if (Array.isArray(data)) {
        this.messages = data as StoredLocalMessage[]
        console.log(`[Local Storage] Loaded ${this.messages.length} messages`)
      } else {
        this.messages = []
        await this.saveData()
      }
    } catch {
      this.messages = []
      console.log('[Local Storage] No existing messages found')
    }
  }

  private async saveData(): Promise<void> {
    const messagesPath = path.join(this.storagePath, MESSAGES_FILE)
    await fs.writeFile(messagesPath, JSON.stringify(this.messages, null, 2), 'utf-8')
  }

  async storeMessage(message: StoredLocalMessage): Promise<void> {
    await this.ensureInitialized()

    const exists = this.messages.some(
      (m) => m.messageId === message.messageId && m.sessionId === message.sessionId
    )

    if (!exists) {
      this.messages.push(message)
      await this.saveData()
    }
  }

  async getMessages(limit?: number, sessionId = 'default'): Promise<StoredLocalMessage[]> {
    await this.ensureInitialized()
    const filtered = this.messages.filter((message) => message.sessionId === sessionId)
    const sorted = [...filtered].sort((a, b) => a.date - b.date)
    return limit ? sorted.slice(-limit) : sorted
  }

  async clearMessages(sessionId?: string): Promise<void> {
    await this.ensureInitialized()
    if (sessionId) {
      this.messages = this.messages.filter((message) => message.sessionId !== sessionId)
    } else {
      this.messages = []
    }
    await this.saveData()
  }
}

export const localStorage = new LocalStorage()
