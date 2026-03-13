import * as fs from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'
import type { StoredQQMessage } from './types'

const STORAGE_DIR = 'qq-data'
const MESSAGES_FILE = 'messages.json'

/**
 * QQStorage handles local persistence of QQ messages
 */
export class QQStorage {
  private storagePath: string
  private messages: StoredQQMessage[] = []
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
        this.messages = data as StoredQQMessage[]
        console.log(`[QQ Storage] Loaded ${this.messages.length} messages`)
      } else {
        this.messages = []
        await this.saveData()
      }
    } catch {
      this.messages = []
      console.log('[QQ Storage] No existing messages found')
    }
  }

  private async saveData(): Promise<void> {
    const messagesPath = path.join(this.storagePath, MESSAGES_FILE)
    await fs.writeFile(messagesPath, JSON.stringify(this.messages, null, 2), 'utf-8')
  }

  async storeMessage(message: StoredQQMessage): Promise<void> {
    await this.ensureInitialized()
    const exists = this.messages.some((m) => m.messageId === message.messageId)
    if (!exists) {
      this.messages.push(message)
      await this.saveData()
    }
  }

  async getMessages(limit?: number, chatId?: string): Promise<StoredQQMessage[]> {
    await this.ensureInitialized()
    const filtered = chatId
      ? this.messages.filter((m) => m.chatId === chatId)
      : this.messages
    const sorted = [...filtered].sort((a, b) => a.date - b.date)
    return limit ? sorted.slice(-limit) : sorted
  }

  async getTotalMessageCount(): Promise<number> {
    await this.ensureInitialized()
    return this.messages.length
  }

  async clearMessages(): Promise<void> {
    await this.ensureInitialized()
    this.messages = []
    await this.saveData()
  }

  async deleteRecentMessages(count: number): Promise<number> {
    await this.ensureInitialized()
    const sorted = [...this.messages].sort((a, b) => a.date - b.date)
    const toDelete = Math.min(count, sorted.length)
    if (toDelete <= 0) return 0
    const idsToDelete = new Set(sorted.slice(-toDelete).map((m) => m.messageId))
    this.messages = this.messages.filter((m) => !idsToDelete.has(m.messageId))
    await this.saveData()
    return toDelete
  }
}

export const qqStorage = new QQStorage()
