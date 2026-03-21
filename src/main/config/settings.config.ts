import * as fs from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'
import { secureStorage, isSensitiveField, SENSITIVE_FIELDS, type SensitiveField } from '../services/secure-storage.service'

const CONFIG_DIR = 'config'
const SETTINGS_FILE = 'settings.json'

/**
 * LLM Provider type
 */
export type LLMProvider = 'claude' | 'minimax' | 'zenmux' | 'ollama' | 'openai' | 'gemini' | 'custom'

/**
 * Provider configurations
 */
export const PROVIDER_CONFIGS: Record<LLMProvider, { name: string; baseUrl: string; defaultModel: string }> = {
  claude: {
    name: 'Claude (Anthropic)',
    baseUrl: '',  // Empty = use Anthropic default
    defaultModel: 'claude-opus-4-5'
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    defaultModel: 'MiniMax-M2.1'
  },
  zenmux: {
    name: 'Zenmux',
    baseUrl: 'https://zenmux.ai/api/anthropic',
    defaultModel: ''
  },
  custom: {
    name: 'Custom Provider',
    baseUrl: '',
    defaultModel: ''
  },
  ollama: {
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: ''
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o'
  },
  gemini: {
    name: 'Gemini (Google)',
    baseUrl: '',
    defaultModel: 'gemini-2.5-pro'
  }
}

/**
 * Application settings
 */
export interface AppSettings {
  // LLM Provider selection
  llmProvider: LLMProvider
  
  // Claude (Anthropic) settings
  claudeApiKey: string
  claudeModel: string
  
  // MiniMax settings
  minimaxApiKey: string
  minimaxModel: string
  
  // Zenmux settings
  zenmuxApiKey: string
  zenmuxModel: string

  // Ollama settings
  ollamaApiKey: string;
  ollamaBaseUrl: string;
  ollamaModel: string;

  // OpenAI settings
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;

  // Gemini settings
  geminiApiKey: string
  geminiModel: string
  
  // Custom provider settings
  customApiKey: string
  customBaseUrl: string
  customModel: string
  
  // Shared LLM settings
  maxTokens: number
  temperature: number
  systemPrompt: string
  modelTier: 'agile' | 'smart' | 'deep'
  l0TargetTokens: number
  l1TargetTokens: number
  maxPromptTokens: number
  retrievalEscalationThresholds: {
    scoreThresholdHigh: number
    top1Top2Margin: number
    maxItemsForL1: number
    maxItemsForL2: number
  }
  enableSessionCompression: boolean
  maxArchives: number
  maxRecentMessages: number
  archiveChunkSize: number

  memuBaseUrl: string
  memuApiKey: string
  memuUserId: string
  memuAgentId: string
  memuProactiveUserId: string
  memuProactiveAgentId: string

  // Telegram settings
  telegramBotToken: string
  telegramAutoConnect: boolean

  // Discord settings
  discordBotToken: string
  discordAutoConnect: boolean

  // WhatsApp settings (placeholder for future implementation)
  whatsappEnabled: boolean

  // Slack settings
  slackBotToken: string
  slackAppToken: string
  slackAutoConnect: boolean

  // Line settings
  lineChannelAccessToken: string
  lineChannelSecret: string

  // Feishu settings
  feishuAppId: string
  feishuAppSecret: string
  feishuAutoConnect: boolean

  // General settings
  language: string

  // Experimental features
  experimentalVisualMode: boolean
  experimentalComputerUse: boolean

  // Debug/Dev features
  showAgentActivity: boolean

  // Search settings
  tavilyApiKey: string

  // Power settings
  preventSleep: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  // LLM Provider selection
  llmProvider: 'claude',
  
  // Claude settings
  claudeApiKey: '',
  claudeModel: 'claude-opus-4-5',
  
  // MiniMax settings
  minimaxApiKey: '',
  minimaxModel: 'MiniMax-M2.1',
  
  // Zenmux settings
  zenmuxApiKey: '',
  zenmuxModel: '',

  // Ollama settings
  ollamaApiKey: 'ollama',
  ollamaBaseUrl: 'http://localhost:11434/v1',
  ollamaModel: '',

  // OpenAI settings
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o',

  // Gemini settings
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-pro',
  
  // Custom provider settings
  customApiKey: '',
  customBaseUrl: '',
  customModel: '',
  
  // Shared LLM settings
  maxTokens: 8192,
  temperature: 0.7,
  systemPrompt: '',
  modelTier: 'deep',
  l0TargetTokens: 120,
  l1TargetTokens: 1200,
  maxPromptTokens: 32000,
  retrievalEscalationThresholds: {
    scoreThresholdHigh: 0.72,
    top1Top2Margin: 0.12,
    maxItemsForL1: 4,
    maxItemsForL2: 2
  },
  enableSessionCompression: true,
  maxArchives: 12,
  maxRecentMessages: 24,
  archiveChunkSize: 8,

  memuBaseUrl: 'https://api.memu.so',
  memuApiKey: '',
  memuUserId: 'bot_user',
  memuAgentId: 'bot_main_agent',
  memuProactiveUserId: 'bot_proactive_user',
  memuProactiveAgentId: 'bot_proactive_agent',

  telegramBotToken: '',
  telegramAutoConnect: true,
  discordBotToken: '',
  discordAutoConnect: true,

  whatsappEnabled: false,

  slackBotToken: '',
  slackAppToken: '',
  slackAutoConnect: true,

  lineChannelAccessToken: '',
  lineChannelSecret: '',

  feishuAppId: '',
  feishuAppSecret: '',
  feishuAutoConnect: true,

  language: 'en',

  // Experimental features
  experimentalVisualMode: false,
  experimentalComputerUse: false,

  // Debug/Dev features
  showAgentActivity: false,

  // Search settings
  tavilyApiKey: '',

  // Power settings
  preventSleep: true
}

/**
 * Settings manager
 * Uses secure storage for sensitive fields (API keys, tokens)
 * Uses regular JSON file for non-sensitive settings
 */
class SettingsManager {
  private configPath: string
  private settings: AppSettings = { ...DEFAULT_SETTINGS }
  private initialized = false
  private settingsLoaded = false  // Track if settings were successfully loaded from file
  private migrationPerformed = false

  constructor() {
    this.configPath = path.join(app.getPath('userData'), CONFIG_DIR)
  }

  /**
   * Initialize and load settings
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Initialize secure storage first
    await secureStorage.initialize()

    try {
      await fs.mkdir(this.configPath, { recursive: true })
      const filePath = path.join(this.configPath, SETTINGS_FILE)
      const content = await fs.readFile(filePath, 'utf-8')
      const saved = JSON.parse(content) as Partial<AppSettings>

      // Merge with defaults to ensure all fields exist
      this.settings = { ...DEFAULT_SETTINGS, ...saved }
      this.settingsLoaded = true  // Mark as successfully loaded

      // Migration: ensure provider is set (for existing users)
      if (!saved.llmProvider && saved.claudeApiKey) {
        console.log('[Settings] Setting default LLM provider to Claude (existing user)')
        this.settings.llmProvider = 'claude'
        await this.saveToFile()
      }

      // Migration: migrate sensitive data from plain text to secure storage
      await this.migrateSensitiveData()

      console.log('[Settings] Loaded settings')
    } catch (error) {
      // Check error type - only use defaults if file truly doesn't exist
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        // File doesn't exist, use defaults (fresh install)
        this.settings = { ...DEFAULT_SETTINGS }
        this.settingsLoaded = true  // Treat as successful load with defaults
        console.log('[Settings] No settings file found, using defaults')
      } else {
        // File exists but corrupted (JSON parse error, read error, etc.)
        // If we already loaded settings before (this.settingsLoaded is true), preserve them
        // Otherwise use defaults
        if (!this.settingsLoaded) {
          this.settings = { ...DEFAULT_SETTINGS }
          console.error('[Settings] Settings file corrupted, using defaults:', err.message)
        } else {
          console.error('[Settings] Settings file error, preserving current settings:', err.message)
        }
      }
    }

    this.initialized = true
  }

  /**
   * Migrate sensitive data from plain text to secure storage
   * This runs once when upgrading from older versions
   */
  private async migrateSensitiveData(): Promise<void> {
    if (this.migrationPerformed) return
    
    let migratedCount = 0
    
    for (const field of SENSITIVE_FIELDS) {
      // Skip githubToken as it's not in AppSettings interface
      if (field === 'githubToken') continue
      const value = (this.settings as unknown as Record<string, string | number | boolean>)[field]
      if (value && typeof value === 'string' && value.length > 0) {
        // Check if already in secure storage
        const existing = await secureStorage.get(field)
        if (!existing) {
          // Migrate to secure storage
          await secureStorage.set(field, value)
          // Clear from plain text settings (keep empty string for structure)
          this.settings[field] = ''
          migratedCount++
          console.log(`[Settings] Migrated ${field} to secure storage`)
        }
      }
    }
    
    if (migratedCount > 0) {
      await this.saveToFile()
      console.log(`[Settings] Migration complete: ${migratedCount} fields migrated to secure storage`)
    }
    
    this.migrationPerformed = true
  }

  /**
   * Ensure initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  /**
   * Get all settings
   * Sensitive fields are populated from secure storage
   */
  async getSettings(): Promise<AppSettings> {
    await this.ensureInitialized()
    
    // Create a copy of settings
    const settings = { ...this.settings }
    
    // Populate sensitive fields from secure storage
    for (const field of SENSITIVE_FIELDS) {
      if (field === 'githubToken') continue // githubToken is not in AppSettings
      const secureValue = await secureStorage.get(field)
      if (secureValue !== null) {
        ;(settings as Record<string, unknown>)[field] = secureValue
      }
    }
    
    return settings
  }

  /**
   * Get a specific setting
   * For sensitive fields, reads from secure storage
   */
  async get<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
    await this.ensureInitialized()
    
    // If it's a sensitive field, read from secure storage
    if (isSensitiveField(key as string)) {
      const secureValue = await secureStorage.get(key as string)
      return (secureValue ?? '') as unknown as AppSettings[K]
    }
    
    return this.settings[key]
  }

  /**
   * Save current settings to file
   * Only saves non-sensitive fields
   */
  private async saveToFile(): Promise<void> {
    const filePath = path.join(this.configPath, SETTINGS_FILE)
    await fs.writeFile(filePath, JSON.stringify(this.settings, null, 2), 'utf-8')
  }

  /**
   * Update settings
   * Sensitive fields are stored in secure storage, others in regular file
   */
  async updateSettings(updates: Partial<AppSettings>): Promise<void> {
    await this.ensureInitialized()
    
    // Separate sensitive and non-sensitive updates
    const sensitiveUpdates: Record<string, string> = {}
    const normalUpdates: Partial<AppSettings> = {}
    
    for (const [key, value] of Object.entries(updates)) {
      if (isSensitiveField(key)) {
        if (typeof value === 'string') {
          sensitiveUpdates[key] = value
        }
      } else {
        ;(normalUpdates as Record<string, unknown>)[key] = value
      }
    }
    
    // Handle githubToken separately if provided
    if ('githubToken' in updates) {
      const ghToken = (updates as Record<string, unknown>)['githubToken']
      if (typeof ghToken === 'string') {
        await secureStorage.set('githubToken', ghToken)
      }
    }
    
    // Save sensitive fields to secure storage
    for (const [key, value] of Object.entries(sensitiveUpdates)) {
      if (value && value.length > 0) {
        await secureStorage.set(key, value)
      } else {
        await secureStorage.delete(key)
      }
      // Keep empty string in settings.json for structure consistency
      ;(this.settings as unknown as Record<string, unknown>)[key] = ''
    }
    
    // Save non-sensitive fields to regular file
    this.settings = { ...this.settings, ...normalUpdates }
    await this.saveToFile()
    
    console.log('[Settings] Settings saved')
  }

  /**
   * Reset to defaults
   * Clears both regular settings and secure storage
   */
  async resetSettings(): Promise<void> {
    // Clear all sensitive data from secure storage
    for (const field of SENSITIVE_FIELDS) {
      await secureStorage.delete(field)
    }
    
    this.settings = { ...DEFAULT_SETTINGS }
    await this.saveToFile()
    console.log('[Settings] Settings reset to defaults')
  }

  /**
   * Get effective LLM configuration based on current provider
   * Reads API key from secure storage
   */
  async getEffectiveLLMConfig(): Promise<{ apiKey: string; baseUrl: string; model: string; provider: LLMProvider }> {
    await this.ensureInitialized()
    
    const provider = this.settings.llmProvider || 'claude'
    
    switch (provider) {
      case 'claude':
        return {
          apiKey: await secureStorage.get('claudeApiKey') ?? '',
          baseUrl: '',  // Use Anthropic default
          model: this.settings.claudeModel || 'claude-opus-4-5',
          provider
        }
      case 'minimax':
        return {
          apiKey: await secureStorage.get('minimaxApiKey') ?? '',
          baseUrl: 'https://api.minimaxi.com/anthropic',
          model: this.settings.minimaxModel || 'MiniMax-M2.1',
          provider
        }
      case 'zenmux':
        return {
          apiKey: await secureStorage.get('zenmuxApiKey') ?? '',
          baseUrl: 'https://zenmux.ai/api/anthropic',
          model: this.settings.zenmuxModel,
          provider
        }
        case 'ollama':
          return {
            apiKey: 'ollama',
            baseUrl: this.settings.ollamaBaseUrl || 'http://localhost:11434/v1',
            model: this.settings.ollamaModel || 'llama3',
            provider
          }
        case 'openai':
          return {
            apiKey: await secureStorage.get('openaiApiKey') ?? '',
            baseUrl: '',
            model: this.settings.openaiModel || 'gpt-4o',
            provider
          }
        case 'gemini':
          return {
            apiKey: await secureStorage.get('geminiApiKey') ?? '',
            baseUrl: '',
            model: this.settings.geminiModel || 'gemini-2.5-pro',
            provider
          }
      case 'custom':
        return {
          apiKey: await secureStorage.get('customApiKey') ?? '',
          baseUrl: this.settings.customBaseUrl,
          model: this.settings.customModel,
          provider
        }
      default:
        return {
          apiKey: await secureStorage.get('claudeApiKey') ?? '',
          baseUrl: '',
          model: this.settings.claudeModel || 'claude-opus-4-5',
          provider: 'claude'
        }
    }
  }

  /**
   * Get memu API configuration
   * Reads API key from secure storage
   */
  async getMemuConfig(): Promise<{ baseUrl: string; apiKey: string; userId: string; agentId: string }> {
    await this.ensureInitialized()
    
    return {
      baseUrl: this.settings.memuBaseUrl,
      apiKey: await secureStorage.get('memuApiKey') ?? '',
      userId: this.settings.memuUserId,
      agentId: this.settings.memuAgentId
    }
  }

  /**
   * Get proactive memu configuration
   */
  async getProactiveMemuConfig(): Promise<{ baseUrl: string; apiKey: string; userId: string; agentId: string }> {
    await this.ensureInitialized()
    
    return {
      baseUrl: this.settings.memuBaseUrl,
      apiKey: await secureStorage.get('memuApiKey') ?? '',
      userId: this.settings.memuProactiveUserId,
      agentId: this.settings.memuProactiveAgentId
    }
  }

  /**
   * Get Tavily API key from secure storage
   */
  async getTavilyApiKey(): Promise<string> {
    await this.ensureInitialized()
    return await secureStorage.get('tavilyApiKey') ?? ''
  }

  /**
   * Check if encryption is available
   */
  isEncryptionAvailable(): boolean {
    return secureStorage.isEncryptionAvailable()
  }

  /**
   * Get secure storage statistics
   */
  async getSecureStorageStats(): Promise<{ totalKeys: number; sensitiveKeys: number; mcpEnvKeys: number }> {
    await this.ensureInitialized()
    return await secureStorage.getStats()
  }
}

// Export singleton instance
export const settingsManager = new SettingsManager()

// Helper functions for easy access
export async function loadSettings(): Promise<AppSettings> {
  return settingsManager.getSettings()
}

export async function saveSettings(updates: Partial<AppSettings>): Promise<void> {
  return settingsManager.updateSettings(updates)
}

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  return settingsManager.get(key)
}

// Export sensitive fields for use in other modules
export { SENSITIVE_FIELDS, isSensitiveField }
export type { SensitiveField }
