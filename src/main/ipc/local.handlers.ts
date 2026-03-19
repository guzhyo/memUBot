import { ipcMain } from 'electron'
import { localChatService } from '../apps/local'
import type { IpcResponse, AppMessage, BotStatus } from '../types'

export function setupLocalHandlers(): void {
  ipcMain.handle('local:send-message', async (_event, message: string): Promise<IpcResponse<AppMessage>> => {
    try {
      const result = await localChatService.sendMessage(message)
      if (!result.success) {
        return { success: false, error: result.error }
      }
      return { success: true, data: result.data }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('local:get-messages', async (_event, limit?: number): Promise<IpcResponse<AppMessage[]>> => {
    try {
      const messages = await localChatService.getMessages(limit)
      return { success: true, data: messages }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('local:clear-messages', async (): Promise<IpcResponse> => {
    try {
      await localChatService.clearMessages()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('local:status', async (): Promise<IpcResponse<BotStatus>> => {
    try {
      await localChatService.initialize()
      return { success: true, data: localChatService.getStatus() }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
}
