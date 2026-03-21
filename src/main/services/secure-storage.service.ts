/**
 * Secure Storage Service
 * Uses Electron's safeStorage API to encrypt sensitive data
 * Provides import/export functionality for backup/restore
 */
import { safeStorage } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'
import { createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto'

// Encrypted data format stored in file
interface SecureStorageData {
  version: number
  encrypted: { [key: string]: string } // base64 encoded encrypted values
}

// Backup file format (password-protected)
interface BackupData {
  version: number
  timestamp: number
  checksum: string
  encrypted: string // base64 encoded, password-encrypted JSON
}

// List of all sensitive fields that should be encrypted
export const SENSITIVE_FIELDS = [
  // LLM API Keys
  'claudeApiKey',
  'minimaxApiKey',
  'zenmuxApiKey',
  'ollamaApiKey',
  'openaiApiKey',
  'geminiApiKey',
  'customApiKey',
  // Service API Keys
  'memuApiKey',
  'tavilyApiKey',
  // Bot Tokens
  'telegramBotToken',
  'discordBotToken',
  'slackBotToken',
  'slackAppToken',
  // OAuth Secrets
  'lineChannelAccessToken',
  'lineChannelSecret',
  'feishuAppId',
  'feishuAppSecret',
  // GitHub Token (from skills)
  'githubToken',
  // MCP Server env vars (dynamic keys with prefix)
  // These are handled separately with 'mcp:env:' prefix
] as const

export type SensitiveField = typeof SENSITIVE_FIELDS[number]

export function isSensitiveField(key: string): key is SensitiveField {
  return SENSITIVE_FIELDS.includes(key as SensitiveField)
}

// MCP env var prefix
export const MCP_ENV_PREFIX = 'mcp:env:'

export function isMcpEnvKey(key: string): boolean {
  return key.startsWith(MCP_ENV_PREFIX)
}

export function createMcpEnvKey(serverName: string, envVar: string): string {
  return `${MCP_ENV_PREFIX}${serverName}:${envVar}`
}

export function parseMcpEnvKey(key: string): { serverName: string; envVar: string } | null {
  if (!key.startsWith(MCP_ENV_PREFIX)) return null
  const parts = key.slice(MCP_ENV_PREFIX.length).split(':')
  if (parts.length !== 2) return null
  return { serverName: parts[0], envVar: parts[1] }
}

// Load status tracking
type LoadStatus = 'fresh' | 'loaded' | 'error'

class SecureStorageService {
  private configPath: string
  private cache: Map<string, string> = new Map()
  private initialized = false
  private loadStatus: LoadStatus = 'fresh'
  private readonly CURRENT_VERSION = 1
  private readonly BACKUP_VERSION = 1

  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'secure-storage.json')
  }

  /**
   * Get the current load status
   */
  getLoadStatus(): LoadStatus {
    return this.loadStatus
  }

  /**
   * Initialize the secure storage service
   * Safe initialization that preserves existing data on failure
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    const previousCache = this.cache  // Preserve existing data in case of failure
    const previousStatus = this.loadStatus

    try {
      await this.load()
      console.log('[SecureStorage] Initialized successfully')
    } catch (error) {
      console.error('[SecureStorage] Failed to initialize:', error)
      // Only reset cache if this is a fresh install (no previous data)
      // If migration fails, preserve previous cache to avoid data loss
      if (previousStatus === 'fresh' || previousCache.size === 0) {
        this.cache = new Map()
      }
      // Don't throw - allow the service to continue with existing or empty cache
    }

    this.initialized = true
  }

  /**
   * Check if safeStorage is available
   */
  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /**
   * Store a sensitive value
   */
  async set(key: string, value: string): Promise<void> {
    await this.ensureInitialized()

    if (!value || value.length === 0) {
      // Empty value means delete
      await this.delete(key)
      return
    }

    try {
      const encrypted = safeStorage.encryptString(value)
      this.cache.set(key, encrypted.toString('base64'))
      await this.save()
      console.log(`[SecureStorage] Stored key: ${key}`)
    } catch (error) {
      console.error(`[SecureStorage] Failed to store key ${key}:`, error)
      throw new Error(`Failed to encrypt and store ${key}`)
    }
  }

  /**
   * Retrieve a sensitive value
   */
  async get(key: string): Promise<string | null> {
    await this.ensureInitialized()

    const encrypted = this.cache.get(key)
    if (!encrypted) return null

    try {
      const buffer = Buffer.from(encrypted, 'base64')
      return safeStorage.decryptString(buffer)
    } catch (error) {
      console.error(`[SecureStorage] Failed to decrypt key ${key}:`, error)
      return null
    }
  }

  /**
   * Delete a sensitive value
   */
  async delete(key: string): Promise<void> {
    await this.ensureInitialized()

    if (this.cache.has(key)) {
      this.cache.delete(key)
      await this.save()
      console.log(`[SecureStorage] Deleted key: ${key}`)
    }
  }

  /**
   * Check if a key exists
   */
  async has(key: string): Promise<boolean> {
    await this.ensureInitialized()
    return this.cache.has(key)
  }

  /**
   * Get all stored keys
   */
  async keys(): Promise<string[]> {
    await this.ensureInitialized()
    return Array.from(this.cache.keys())
  }

  /**
   * Get all sensitive values (for migration/export)
   */
  async getAll(): Promise<Record<string, string>> {
    await this.ensureInitialized()
    const result: Record<string, string> = {}

    for (const key of this.cache.keys()) {
      const value = await this.get(key)
      if (value !== null) {
        result[key] = value
      }
    }

    return result
  }

  /**
   * Clear all stored values
   */
  async clear(): Promise<void> {
    await this.ensureInitialized()
    this.cache.clear()
    await this.save()
    console.log('[SecureStorage] Cleared all values')
  }

  /**
   * Export encrypted backup (password-protected)
   * This allows users to backup and restore across systems
   */
  async exportBackup(password: string): Promise<string> {
    await this.ensureInitialized()

    const data = await this.getAll()
    const timestamp = Date.now()
    const dataJson = JSON.stringify(data)
    
    // Create checksum for integrity verification
    const checksum = createHash('sha256').update(dataJson).digest('hex')

    // Encrypt with password using AES-256-GCM
    const salt = randomBytes(32)
    const iv = randomBytes(16)
    const key = scryptSync(password, salt, 32)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    
    let encrypted = cipher.update(dataJson, 'utf8', 'base64')
    encrypted += cipher.final('base64')
    const authTag = cipher.getAuthTag()

    // Combine all components
    const backupData: BackupData = {
      version: this.BACKUP_VERSION,
      timestamp,
      checksum,
      encrypted: Buffer.concat([
        salt,
        iv,
        authTag,
        Buffer.from(encrypted, 'base64')
      ]).toString('base64')
    }

    return JSON.stringify(backupData, null, 2)
  }

  /**
   * Import from password-protected backup
   */
  async importBackup(backupJson: string, password: string): Promise<{ success: boolean; message: string; imported: number }> {
    await this.ensureInitialized()

    try {
      const backupData: BackupData = JSON.parse(backupJson)

      if (backupData.version !== this.BACKUP_VERSION) {
        return { success: false, message: `Unsupported backup version: ${backupData.version}`, imported: 0 }
      }

      // Decode encrypted data
      const encryptedBuffer = Buffer.from(backupData.encrypted, 'base64')
      const salt = encryptedBuffer.slice(0, 32)
      const iv = encryptedBuffer.slice(32, 48)
      const authTag = encryptedBuffer.slice(48, 64)
      const encrypted = encryptedBuffer.slice(64)

      // Decrypt
      const key = scryptSync(password, salt, 32)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)

      let decrypted = decipher.update(encrypted.toString('base64'), 'base64', 'utf8')
      decrypted += decipher.final('utf8')

      // Verify checksum
      const checksum = createHash('sha256').update(decrypted).digest('hex')
      if (checksum !== backupData.checksum) {
        return { success: false, message: 'Backup integrity check failed (checksum mismatch)', imported: 0 }
      }

      // Parse and import data
      const data = JSON.parse(decrypted) as Record<string, string>
      let imported = 0

      for (const [key, value] of Object.entries(data)) {
        await this.set(key, value)
        imported++
      }

      console.log(`[SecureStorage] Imported ${imported} keys from backup`)
      return { success: true, message: `Successfully imported ${imported} keys`, imported }

    } catch (error) {
      console.error('[SecureStorage] Failed to import backup:', error)
      if ((error as Error).message.includes('Unsupported state or unable to authenticate data')) {
        return { success: false, message: 'Invalid password or corrupted backup', imported: 0 }
      }
      return { success: false, message: `Import failed: ${(error as Error).message}`, imported: 0 }
    }
  }

  /**
   * Validate backup file format without importing
   */
  async validateBackup(backupJson: string): Promise<{ valid: boolean; message: string; timestamp?: number }> {
    try {
      const backupData: BackupData = JSON.parse(backupJson)

      if (backupData.version !== this.BACKUP_VERSION) {
        return { valid: false, message: `Unsupported backup version: ${backupData.version}` }
      }

      if (!backupData.encrypted || !backupData.checksum) {
        return { valid: false, message: 'Invalid backup format' }
      }

      return { 
        valid: true, 
        message: 'Valid backup file',
        timestamp: backupData.timestamp 
      }
    } catch (error) {
      return { valid: false, message: 'Invalid JSON format' }
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{ totalKeys: number; sensitiveKeys: number; mcpEnvKeys: number }> {
    await this.ensureInitialized()
    const keys = Array.from(this.cache.keys())
    
    return {
      totalKeys: keys.length,
      sensitiveKeys: keys.filter(k => isSensitiveField(k)).length,
      mcpEnvKeys: keys.filter(k => isMcpEnvKey(k)).length
    }
  }

  /**
   * Load from file
   * Handles various error cases gracefully without losing data
   */
  private async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8')
      const data = JSON.parse(content) as SecureStorageData

      if (data.version !== this.CURRENT_VERSION) {
        console.warn(`[SecureStorage] Version mismatch: ${data.version} vs ${this.CURRENT_VERSION}`)
        // Handle migration if needed in the future
      }

      if (!data.encrypted || typeof data.encrypted !== 'object') {
        throw new Error('Invalid storage format: missing encrypted object')
      }

      this.cache = new Map(Object.entries(data.encrypted))
      this.loadStatus = 'loaded'
      console.log(`[SecureStorage] Loaded ${this.cache.size} encrypted values`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, this is a fresh install
        this.cache = new Map()
        this.loadStatus = 'fresh'
        console.log('[SecureStorage] No existing storage file, starting fresh')
      } else {
        // File exists but corrupted (JSON parse error, invalid format, etc.)
        // Preserve existing cache data, mark as error state
        this.loadStatus = 'error'
        console.error('[SecureStorage] Storage file corrupted, preserving existing data:', error)
        // Don't throw - preserve existing cache to avoid data loss
      }
    }
  }

  /**
   * Save to file
   */
  private async save(): Promise<void> {
    const data: SecureStorageData = {
      version: this.CURRENT_VERSION,
      encrypted: Object.fromEntries(this.cache)
    }

    await fs.writeFile(this.configPath, JSON.stringify(data, null, 2), 'utf-8')
  }

  /**
   * Ensure initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }
}

// Export singleton instance
export const secureStorage = new SecureStorageService()
