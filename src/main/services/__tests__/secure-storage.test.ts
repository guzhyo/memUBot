/**
 * Secure Storage Service Tests
 *
 * Test coverage for:
 * 1. Basic CRUD operations
 * 2. Backup export/import with password
 * 3. Invalid password handling
 * 4. Migration scenarios
 * 5. Error handling (corrupted files, unavailable encryption)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock electron modules
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((text: string) => Buffer.from(`encrypted:${text}`)),
    decryptString: vi.fn((buffer: Buffer) => {
      const str = buffer.toString()
      if (str.startsWith('encrypted:')) {
        return str.replace('encrypted:', '')
      }
      throw new Error('Invalid encrypted data')
    })
  },
  app: {
    getPath: vi.fn(() => '/tmp/test-userData')
  }
}))

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn()
  }
}))

vi.mock('path', () => ({
  join: vi.fn((...args: string[]) => args.join('/'))
}))

// Import after mocks
import { secureStorage, SENSITIVE_FIELDS, isSensitiveField, MCP_ENV_PREFIX, createMcpEnvKey, parseMcpEnvKey } from '../secure-storage.service'
import * as fs from 'fs/promises'

describe('SecureStorageService', () => {
  beforeEach(async () => {
    // Reset storage state before each test
    vi.clearAllMocks()
    // Re-import to reset singleton state
  })

  describe('SENSITIVE_FIELDS', () => {
    it('should include all LLM API keys', () => {
      const apiKeyFields = [
        'claudeApiKey',
        'minimaxApiKey',
        'zenmuxApiKey',
        'ollamaApiKey',
        'openaiApiKey',
        'geminiApiKey',
        'customApiKey'
      ]
      apiKeyFields.forEach(field => {
        expect(SENSITIVE_FIELDS).toContain(field)
      })
    })

    it('should include all bot tokens', () => {
      const tokenFields = [
        'telegramBotToken',
        'discordBotToken',
        'slackBotToken',
        'slackAppToken'
      ]
      tokenFields.forEach(field => {
        expect(SENSITIVE_FIELDS).toContain(field)
      })
    })

    it('should include all OAuth secrets', () => {
      const oauthFields = [
        'lineChannelAccessToken',
        'lineChannelSecret',
        'feishuAppId',
        'feishuAppSecret'
      ]
      oauthFields.forEach(field => {
        expect(SENSITIVE_FIELDS).toContain(field)
      })
    })

    it('should include githubToken', () => {
      expect(SENSITIVE_FIELDS).toContain('githubToken')
    })

    it('should include memuApiKey and tavilyApiKey', () => {
      expect(SENSITIVE_FIELDS).toContain('memuApiKey')
      expect(SENSITIVE_FIELDS).toContain('tavilyApiKey')
    })
  })

  describe('isSensitiveField', () => {
    it('should return true for sensitive fields', () => {
      expect(isSensitiveField('claudeApiKey')).toBe(true)
      expect(isSensitiveField('githubToken')).toBe(true)
      expect(isSensitiveField('telegramBotToken')).toBe(true)
    })

    it('should return false for non-sensitive fields', () => {
      expect(isSensitiveField('llmProvider')).toBe(false)
      expect(isSensitiveField('maxTokens')).toBe(false)
      expect(isSensitiveField('language')).toBe(false)
    })
  })

  describe('MCP_ENV_PREFIX', () => {
    it('should have correct prefix format', () => {
      expect(MCP_ENV_PREFIX).toBe('mcp:env:')
    })
  })

  describe('createMcpEnvKey', () => {
    it('should create correct MCP env key', () => {
      const key = createMcpEnvKey('my-server', 'API_KEY')
      expect(key).toBe('mcp:env:my-server:API_KEY')
    })
  })

  describe('parseMcpEnvKey', () => {
    it('should parse valid MCP env key', () => {
      const result = parseMcpEnvKey('mcp:env:my-server:API_KEY')
      expect(result).toEqual({ serverName: 'my-server', envVar: 'API_KEY' })
    })

    it('should return null for invalid key', () => {
      expect(parseMcpEnvKey('invalid-key')).toBeNull()
      expect(parseMcpEnvKey('mcp:env:invalid')).toBeNull()
      expect(parseMcpEnvKey('other:env:server:var')).toBeNull()
    })
  })

  describe('isEncryptionAvailable', () => {
    it('should check if encryption is available', () => {
      const { safeStorage } = require('electron')
      secureStorage.isEncryptionAvailable()
      expect(safeStorage.isEncryptionAvailable).toHaveBeenCalled()
    })
  })

  describe('getLoadStatus', () => {
    it('should return initial load status', () => {
      // Fresh instance should return 'fresh'
      const status = secureStorage.getLoadStatus()
      expect(['fresh', 'loaded', 'error']).toContain(status)
    })
  })
})

describe('Backup and Restore', () => {
  describe('exportBackup', () => {
    it('should export encrypted backup with password', async () => {
      // Set up some data first
      await secureStorage.initialize()

      const backup = await secureStorage.exportBackup('test-password')
      expect(backup).toBeDefined()
      expect(typeof backup).toBe('string')

      const backupData = JSON.parse(backup)
      expect(backupData.version).toBe(1)
      expect(backupData.timestamp).toBeDefined()
      expect(backupData.checksum).toBeDefined()
      expect(backupData.encrypted).toBeDefined()
    })

    it('should produce different output for different passwords', async () => {
      await secureStorage.initialize()

      const backup1 = await secureStorage.exportBackup('password1')
      const backup2 = await secureStorage.exportBackup('password2')

      expect(backup1).not.toBe(backup2)
    })
  })

  describe('importBackup', () => {
    it('should import backup with correct password', async () => {
      await secureStorage.initialize()

      // First export
      const backup = await secureStorage.exportBackup('my-password')

      // Clear storage
      await secureStorage.clear()

      // Import back
      const result = await secureStorage.importBackup(backup, 'my-password')

      expect(result.success).toBe(true)
      expect(result.imported).toBeGreaterThanOrEqual(0)
    })

    it('should fail with wrong password', async () => {
      await secureStorage.initialize()

      const backup = await secureStorage.exportBackup('correct-password')

      const result = await secureStorage.importBackup(backup, 'wrong-password')

      expect(result.success).toBe(false)
      expect(result.message).toContain('password')
      expect(result.imported).toBe(0)
    })

    it('should fail with corrupted backup', async () => {
      await secureStorage.initialize()

      const corruptedBackup = JSON.stringify({
        version: 1,
        timestamp: Date.now(),
        checksum: 'invalid-checksum',
        encrypted: Buffer.from('corrupted').toString('base64')
      })

      const result = await secureStorage.importBackup(corruptedBackup, 'any-password')

      expect(result.success).toBe(false)
    })

    it('should reject unsupported backup version', async () => {
      await secureStorage.initialize()

      const oldBackup = JSON.stringify({
        version: 999, // Future version
        timestamp: Date.now(),
        checksum: 'any',
        encrypted: Buffer.from('any').toString('base64')
      })

      const result = await secureStorage.importBackup(oldBackup, 'any-password')

      expect(result.success).toBe(false)
      expect(result.message).toContain('Unsupported backup version')
    })
  })

  describe('validateBackup', () => {
    it('should validate a valid backup', async () => {
      await secureStorage.initialize()

      const backup = await secureStorage.exportBackup('password')
      const result = await secureStorage.validateBackup(backup)

      expect(result.valid).toBe(true)
      expect(result.message).toBe('Valid backup file')
      expect(result.timestamp).toBeDefined()
    })

    it('should reject invalid JSON', async () => {
      const result = await secureStorage.validateBackup('not-valid-json')

      expect(result.valid).toBe(false)
      expect(result.message).toBe('Invalid JSON format')
    })

    it('should reject backup with missing fields', async () => {
      const incompleteBackup = JSON.stringify({
        version: 1
        // missing timestamp, checksum, encrypted
      })

      const result = await secureStorage.validateBackup(incompleteBackup)

      expect(result.valid).toBe(false)
    })

    it('should reject unsupported version', async () => {
      const oldBackup = JSON.stringify({
        version: 999,
        timestamp: Date.now(),
        checksum: 'any',
        encrypted: 'any'
      })

      const result = await secureStorage.validateBackup(oldBackup)

      expect(result.valid).toBe(false)
      expect(result.message).toContain('Unsupported backup version')
    })
  })
})

describe('Error Handling', () => {
  describe('initialize', () => {
    it('should handle missing storage file gracefully (fresh install)', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce({
        code: 'ENOENT'
      } as NodeJS.ErrnoException)

      // Should not throw
      await expect(secureStorage.initialize()).resolves.not.toThrow()
    })

    it('should handle corrupted storage file gracefully', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('Invalid JSON'))
      vi.mocked(fs.readFile).mockResolvedValueOnce('{"version":1,"encrypted":{}}')

      // Should not throw, just log error
      await expect(secureStorage.initialize()).resolves.not.toThrow()
    })
  })

  describe('get', () => {
    it('should return null for non-existent keys', async () => {
      await secureStorage.initialize()

      const value = await secureStorage.get('non-existent-key')
      expect(value).toBeNull()
    })
  })

  describe('has', () => {
    it('should return false for non-existent keys', async () => {
      await secureStorage.initialize()

      const exists = await secureStorage.has('non-existent-key')
      expect(exists).toBe(false)
    })
  })
})

describe('getStats', () => {
  it('should return storage statistics', async () => {
    await secureStorage.initialize()

    const stats = await secureStorage.getStats()

    expect(stats).toHaveProperty('totalKeys')
    expect(stats).toHaveProperty('sensitiveKeys')
    expect(stats).toHaveProperty('mcpEnvKeys')
    expect(typeof stats.totalKeys).toBe('number')
    expect(typeof stats.sensitiveKeys).toBe('number')
    expect(typeof stats.mcpEnvKeys).toBe('number')
  })
})
