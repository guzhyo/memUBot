import { ipcMain } from 'electron'
import { qqBotService } from '../apps/qq'
import type { IpcResponse, BotStatus, AppMessage } from '../types'

/**
 * Setup QQ-related IPC handlers
 */
export function setupQQHandlers(): void {
  ipcMain.handle('qq:connect', async (): Promise<IpcResponse> => {
    try {
      await qqBotService.connect()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('qq:disconnect', async (): Promise<IpcResponse> => {
    try {
      qqBotService.disconnect()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('qq:status', async (): Promise<IpcResponse<BotStatus>> => {
    try {
      const status = qqBotService.getStatus()
      return { success: true, data: status }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('qq:get-messages', async (_event, limit?: number): Promise<IpcResponse<AppMessage[]>> => {
    try {
      const messages = await qqBotService.getMessages(limit)
      return { success: true, data: messages }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
