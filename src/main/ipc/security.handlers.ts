import { ipcMain, dialog } from 'electron'
import { securityService, type Platform } from '../services/security.service'
import { secureStorage } from '../services/secure-storage.service'
import { settingsManager } from '../config/settings.config'
import * as fs from 'fs/promises'

export function setupSecurityHandlers(): void {
  // Generate a new security code
  ipcMain.handle('security:generate-code', async () => {
    try {
      const code = securityService.generateCode()
      return { success: true, data: { code } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate code'
      }
    }
  })

  // Get current code info (active status, remaining time)
  ipcMain.handle('security:get-code-info', async () => {
    try {
      const info = securityService.getCodeInfo()
      return { success: true, data: info }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get code info'
      }
    }
  })

  // Get bound users for a specific platform (or all if not specified)
  ipcMain.handle('security:get-bound-users', async (_, platform?: Platform) => {
    try {
      const users = await securityService.getBoundUsers(platform)
      return { success: true, data: users }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get bound users'
      }
    }
  })

  // Remove a bound user from a specific platform
  ipcMain.handle(
    'security:remove-bound-user',
    async (_, userId: number, platform: Platform = 'telegram') => {
      try {
        const removed = await securityService.removeBoundUser(userId, platform)
        return { success: true, data: { removed } }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to remove user'
        }
      }
    }
  )

  // Remove a bound user by string ID (for Discord)
  ipcMain.handle(
    'security:remove-bound-user-by-id',
    async (_, uniqueId: string, platform: Platform) => {
      try {
        const removed = await securityService.removeBoundUserByStringId(uniqueId, platform)
        return { success: true, data: { removed } }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to remove user'
        }
      }
    }
  )

  // Clear bound users for a specific platform (or all if not specified)
  ipcMain.handle('security:clear-bound-users', async (_, platform?: Platform) => {
    try {
      await securityService.clearBoundUsers(platform)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear users'
      }
    }
  })

  // ============ Secure Storage Management ============

  // Get secure storage statistics
  ipcMain.handle('security:get-secure-storage-stats', async () => {
    try {
      const stats = await settingsManager.getSecureStorageStats()
      const isAvailable = settingsManager.isEncryptionAvailable()
      return { success: true, data: { ...stats, isAvailable } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get secure storage stats'
      }
    }
  })

  // Export secure storage backup
  ipcMain.handle('security:export-backup', async (_, password: string) => {
    try {
      const backupData = await secureStorage.exportBackup(password)
      return { success: true, data: backupData }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export backup'
      }
    }
  })

  // Import secure storage backup
  ipcMain.handle('security:import-backup', async (_, backupData: string, password: string) => {
    try {
      const result = await secureStorage.importBackup(backupData, password)
      return { success: result.success, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to import backup'
      }
    }
  })

  // Validate backup file
  ipcMain.handle('security:validate-backup', async (_, backupData: string) => {
    try {
      const result = await secureStorage.validateBackup(backupData)
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to validate backup'
      }
    }
  })

  // Clear all secure storage (dangerous operation)
  ipcMain.handle('security:clear-secure-storage', async () => {
    try {
      await secureStorage.clear()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear secure storage'
      }
    }
  })

  // Show save dialog for backup export
  ipcMain.handle('security:show-save-backup-dialog', async () => {
    try {
      const result = await dialog.showSaveDialog({
        title: 'Export Secure Backup',
        defaultPath: 'memu-bot-backup.json',
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to show save dialog'
      }
    }
  })

  // Show open dialog for backup import
  ipcMain.handle('security:show-open-backup-dialog', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Import Secure Backup',
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      })
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to show open dialog'
      }
    }
  })

  // Read file for backup import
  ipcMain.handle('security:read-backup-file', async (_, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return { success: true, data: content }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read backup file'
      }
    }
  })

  // Write file for backup export
  ipcMain.handle('security:write-backup-file', async (_, filePath: string, content: string) => {
    try {
      await fs.writeFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write backup file'
      }
    }
  })
}
