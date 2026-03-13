import * as https from 'https'
import * as http from 'http'
import * as fs from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'
import { getSetting } from '../../config/settings.config'
import { agentService } from '../../services/agent.service'
import { infraService } from '../../services/infra.service'
import { securityService } from '../../services/security.service'
import { appEvents } from '../../events'
import { qqStorage } from './storage'
import { QQBotApi } from './api'
import { QQGateway } from './gateway'
import type { BotStatus, AppMessage } from '../types'
import type {
  StoredQQMessage,
  QQC2CMessageEvent,
  QQGroupMessageEvent,
  QQGuildMessageEvent,
  QQMessageAttachment,
} from './types'

/**
 * QQBotService manages the QQ bot connection and message handling
 */
export class QQBotService {
  private api: QQBotApi | null = null
  private gateway: QQGateway | null = null
  private status: BotStatus = {
    platform: 'qq',
    isConnected: false,
  }

  // Deduplication
  private processedMessageIds: Set<string> = new Set()
  private readonly MAX_PROCESSED_IDS = 1000

  // ==================== Lifecycle ====================

  async connect(): Promise<void> {
    try {
      console.log('[QQ] Starting connection...')

      const appId = await getSetting('qqAppId')
      const appSecret = await getSetting('qqAppSecret')

      if (!appId || !appSecret) {
        throw new Error('QQ App ID and App Secret not configured. Please set them in Settings.')
      }

      await qqStorage.initialize()

      this.api = new QQBotApi(appId, appSecret)

      // Fetch bot info
      try {
        const botInfo = await this.api.getBotInfo()
        this.status.botName = botInfo.username
        this.status.avatarUrl = botInfo.avatar
        console.log(`[QQ] Bot info: ${botInfo.username} (${botInfo.id})`)
      } catch {
        this.status.botName = 'QQ Bot'
        console.log('[QQ] Could not fetch bot info, using default name')
      }

      this.gateway = new QQGateway(this.api, {
        onReady: (botInfo) => {
          this.status = { ...this.status, isConnected: true }
          if (!this.status.botName) this.status.botName = botInfo.username
          appEvents.emitQQStatusChanged(this.status)
        },
        onC2CMessage: (event) => this.handleC2CMessage(event),
        onGroupMessage: (event) => this.handleGroupMessage(event),
        onGuildMessage: (event) => this.handleGuildMessage(event),
        onDirectMessage: (event) => this.handleDirectMessage(event),
      })

      await this.gateway.connect()

      this.status = { ...this.status, platform: 'qq', isConnected: true }
      appEvents.emitQQStatusChanged(this.status)
      console.log('[QQ] Bot connected successfully')
    } catch (error) {
      console.error('[QQ] Connection error:', error)
      this.status = {
        platform: 'qq',
        isConnected: false,
        error: error instanceof Error ? error.message : String(error),
      }
      appEvents.emitQQStatusChanged(this.status)
      throw error
    }
  }

  disconnect(): void {
    this.gateway?.disconnect()
    this.gateway = null
    this.api = null
    this.status = { platform: 'qq', isConnected: false }
    appEvents.emitQQStatusChanged(this.status)
    console.log('[QQ] Disconnected')
  }

  getStatus(): BotStatus {
    return this.status
  }

  async getMessages(limit?: number): Promise<AppMessage[]> {
    const messages = await qqStorage.getMessages(limit)
    return messages.map((m) => this.convertToAppMessage(m))
  }

  // ==================== Message Handlers ====================

  private async downloadImages(attachments?: QQMessageAttachment[]): Promise<string[]> {
    if (!attachments || attachments.length === 0) return []
    const imageAttachments = attachments.filter(
      (a) => a.content_type?.startsWith('image/') || a.url?.match(/\.(jpg|jpeg|png|gif|webp)$/i)
    )
    const localPaths: string[] = []
    const downloadsDir = path.join(app.getPath('userData'), 'downloads', 'qq')
    await fs.mkdir(downloadsDir, { recursive: true })

    for (const att of imageAttachments) {
      try {
        const tempPath = path.join(downloadsDir, `${Date.now()}_${att.id}.tmp`)
        await this.downloadFile(att.url, tempPath)

        // Detect format from magic bytes
        const data = await fs.readFile(tempPath)
        let ext = 'jpg'
        if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) ext = 'png'
        else if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) ext = 'gif'
        else if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
                 data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) ext = 'webp'

        const localPath = path.join(downloadsDir, `${Date.now()}_${att.id}.${ext}`)
        await fs.rename(tempPath, localPath)
        localPaths.push(localPath)
        console.log(`[QQ] Image downloaded (${ext}): ${localPath}`)
      } catch (e) {
        console.error('[QQ] Failed to download image:', e)
      }
    }
    return localPaths
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const client = parsedUrl.protocol === 'https:' ? https : http
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const file = require('fs').createWriteStream(dest)
      client.get(url, (res) => {
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', reject)
      }).on('error', reject)
    })
  }

  private async handleC2CMessage(event: QQC2CMessageEvent): Promise<void> {
    if (!this.deduplicate(event.id)) return

    const senderId = event.author.user_openid
    const chatId = senderId // C2C: chatId = user's openid
    const text = this.stripBotMention(event.content)
    const imageUrls = await this.downloadImages(event.attachments)

    console.log(`[QQ] C2C message from ${senderId}: ${text.substring(0, 80)}${imageUrls.length > 0 ? ` [${imageUrls.length} image(s)]` : ''}`)

    if (text.startsWith('/bind')) {
      await this.handleBindCommand(chatId, senderId, text, 'c2c', event.id)
      return
    }

    const isAuthorized = await securityService.isAuthorizedByStringId(senderId, 'qq')
    if (!isAuthorized) {
      await this.sendC2CText(senderId, '请先绑定账号，发送 /bind <6位验证码> 完成绑定。\n\n验证码请在 memU 应用的 设置 → 安全 中获取。', event.id)
      return
    }

    await this.storeIncoming(event.id, chatId, 'c2c', senderId, text, imageUrls)
    await this.processWithAgentAndReply(chatId, 'c2c', senderId, text, event.id, imageUrls)
  }

  private async handleGroupMessage(event: QQGroupMessageEvent): Promise<void> {
    if (!this.deduplicate(event.id)) return

    const senderId = event.author.member_openid
    const chatId = event.group_openid
    const text = this.stripBotMention(event.content)
    const imageUrls = await this.downloadImages(event.attachments)

    console.log(`[QQ] Group message from ${senderId} in ${chatId}: ${text.substring(0, 80)}${imageUrls.length > 0 ? ` [${imageUrls.length} image(s)]` : ''}`)

    const isAuthorized = await securityService.isAuthorizedByStringId(senderId, 'qq')
    if (!isAuthorized) {
      await this.sendGroupText(chatId, '请先绑定账号，在私聊中发送 /bind <6位验证码> 完成绑定。', event.id)
      return
    }

    await this.storeIncoming(event.id, chatId, 'group', senderId, text, imageUrls)
    await this.processWithAgentAndReply(chatId, 'group', senderId, text, event.id, imageUrls)
  }

  private async handleGuildMessage(event: QQGuildMessageEvent): Promise<void> {
    if (!this.deduplicate(event.id)) return

    const senderId = event.author.id
    const chatId = event.channel_id
    const text = this.stripBotMention(event.content)
    const imageUrls = await this.downloadImages(event.attachments)

    console.log(`[QQ] Guild message from ${senderId} in channel ${chatId}: ${text.substring(0, 80)}${imageUrls.length > 0 ? ` [${imageUrls.length} image(s)]` : ''}`)

    const isAuthorized = await securityService.isAuthorizedByStringId(senderId, 'qq')
    if (!isAuthorized) {
      await this.sendGuildText(chatId, '请先绑定账号。', event.id)
      return
    }

    await this.storeIncoming(event.id, chatId, 'guild', senderId, text, imageUrls)
    await this.processWithAgentAndReply(chatId, 'guild', senderId, text, event.id, imageUrls)
  }

  private async handleDirectMessage(event: QQGuildMessageEvent): Promise<void> {
    if (!this.deduplicate(event.id)) return

    const senderId = event.author.id
    const chatId = event.guild_id // DM guild_id is the DM session ID
    const text = this.stripBotMention(event.content)
    const imageUrls = await this.downloadImages(event.attachments)

    if (text.startsWith('/bind')) {
      await this.handleBindCommand(chatId, senderId, text, 'guild_dm', event.id)
      return
    }

    const isAuthorized = await securityService.isAuthorizedByStringId(senderId, 'qq')
    if (!isAuthorized) {
      await this.sendDirectText(chatId, '请先绑定账号，发送 /bind <6位验证码> 完成绑定。', event.id)
      return
    }

    await this.storeIncoming(event.id, chatId, 'guild', senderId, text, imageUrls)
    await this.processWithAgentAndReply(chatId, 'guild_dm', senderId, text, event.id, imageUrls)
  }

  // ==================== Bind Command ====================

  private async handleBindCommand(
    chatId: string,
    senderId: string,
    text: string,
    chatType: string,
    msgId: string
  ): Promise<void> {
    const isAlreadyBound = await securityService.isAuthorizedByStringId(senderId, 'qq')
    if (isAlreadyBound) {
      await this.sendReply(chatId, chatType, '✅ 您的账号已绑定。', msgId)
      return
    }

    const parts = text.trim().split(/\s+/)
    if (parts.length < 2) {
      await this.sendReply(chatId, chatType, '🔐 请提供验证码：\n\n/bind <6位验证码>\n\n请在 memU 应用的 设置 → 安全 中获取验证码。', msgId)
      return
    }

    const code = parts[1]
    const result = await securityService.validateAndBindByStringId(
      code,
      senderId,
      senderId,
      undefined,
      undefined,
      'qq'
    )

    if (result.success) {
      await this.sendReply(chatId, chatType, '✅ 账号绑定成功！现在可以正常使用了。', msgId)
    } else {
      await this.sendReply(chatId, chatType, `❌ 绑定失败：${result.error || '验证码无效或已过期'}`, msgId)
    }
  }

  // ==================== Agent Processing ====================

  private async processWithAgentAndReply(
    chatId: string,
    chatType: string,
    senderId: string,
    text: string,
    msgId: string,
    imageUrls: string[] = []
  ): Promise<void> {
    try {
      if (await infraService.tryConsumeUserInput(text, 'qq')) {
        console.log('[QQ] Message consumed by another service')
        return
      }

      const response = await agentService.processMessage(text, 'qq', imageUrls, chatId)

      if (!response.success && response.busyWith) {
        if (response.message) {
          await this.sendReply(chatId, chatType, response.message, msgId)
        }
        return
      }

      if (response.success && response.message) {
        await this.sendReply(chatId, chatType, response.message, msgId)

        // Store bot reply
        const botMsg: StoredQQMessage = {
          messageId: `bot_${Date.now()}`,
          chatId,
          chatType: chatType === 'c2c' ? 'c2c' : chatType === 'group' ? 'group' : 'guild',
          fromId: 'bot',
          fromName: this.status.botName || 'QQ Bot',
          text: response.message,
          date: Math.floor(Date.now() / 1000),
          isFromBot: true,
        }
        await qqStorage.storeMessage(botMsg)
        appEvents.emitQQNewMessage(this.convertToAppMessage(botMsg))

        infraService.publish('message:outgoing', {
          platform: 'qq',
          timestamp: botMsg.date,
          message: { role: 'assistant', content: response.message },
          metadata: { chatId, senderId },
        })
      } else {
        console.error('[QQ] Agent error:', response.error)
        await this.sendReply(chatId, chatType, `错误：${response.error || '未知错误'}`, msgId)
      }
    } catch (error) {
      console.error('[QQ] Error processing with agent:', error)
      await this.sendReply(chatId, chatType, '抱歉，处理消息时出现错误。', msgId)
    }
  }

  // ==================== Send Helpers ====================

  private async sendReply(chatId: string, chatType: string, text: string, msgId: string): Promise<void> {
    if (!this.api) return
    try {
      // Truncate to QQ's 2000-char limit
      const content = text.length > 2000 ? text.substring(0, 1997) + '...' : text
      if (chatType === 'c2c') {
        await this.api.sendC2CMessage(chatId, content, msgId)
      } else if (chatType === 'group') {
        await this.api.sendGroupMessage(chatId, content, msgId)
      } else if (chatType === 'guild_dm') {
        await this.api.sendDirectMessage(chatId, content, msgId)
      } else {
        await this.api.sendGuildMessage(chatId, content, msgId)
      }
    } catch (error) {
      console.error('[QQ] Failed to send reply:', error)
    }
  }

  private async sendC2CText(userOpenid: string, text: string, msgId: string): Promise<void> {
    if (!this.api) return
    await this.api.sendC2CMessage(userOpenid, text, msgId).catch((err) =>
      console.error('[QQ] sendC2CText error:', err)
    )
  }

  private async sendGroupText(groupOpenid: string, text: string, msgId: string): Promise<void> {
    if (!this.api) return
    await this.api.sendGroupMessage(groupOpenid, text, msgId).catch((err) =>
      console.error('[QQ] sendGroupText error:', err)
    )
  }

  private async sendGuildText(channelId: string, text: string, msgId: string): Promise<void> {
    if (!this.api) return
    await this.api.sendGuildMessage(channelId, text, msgId).catch((err) =>
      console.error('[QQ] sendGuildText error:', err)
    )
  }

  private async sendDirectText(guildId: string, text: string, msgId: string): Promise<void> {
    if (!this.api) return
    await this.api.sendDirectMessage(guildId, text, msgId).catch((err) =>
      console.error('[QQ] sendDirectText error:', err)
    )
  }

  // ==================== Helpers ====================

  private deduplicate(messageId: string): boolean {
    if (this.processedMessageIds.has(messageId)) {
      console.log(`[QQ] Skipping duplicate message: ${messageId}`)
      return false
    }
    this.processedMessageIds.add(messageId)
    if (this.processedMessageIds.size > this.MAX_PROCESSED_IDS) {
      const arr = Array.from(this.processedMessageIds)
      for (let i = 0; i < this.MAX_PROCESSED_IDS / 2; i++) {
        this.processedMessageIds.delete(arr[i])
      }
    }
    return true
  }

  private stripBotMention(content: string): string {
    // Remove <@bot_id> mentions that QQ adds when bot is @-mentioned
    return content.replace(/<@!\d+>/g, '').replace(/<@\d+>/g, '').trim()
  }

  private async storeIncoming(
    messageId: string,
    chatId: string,
    chatType: 'c2c' | 'group' | 'guild',
    fromId: string,
    text: string,
    imageUrls: string[] = []
  ): Promise<void> {
    const msg: StoredQQMessage = {
      messageId,
      chatId,
      chatType,
      fromId,
      text,
      attachments: imageUrls.map((url) => ({ url, contentType: 'image/jpeg' })),
      date: Math.floor(Date.now() / 1000),
      isFromBot: false,
    }
    await qqStorage.storeMessage(msg)
    appEvents.emitQQNewMessage(this.convertToAppMessage(msg))

    infraService.publish('message:incoming', {
      platform: 'qq',
      timestamp: msg.date,
      message: { role: 'user', content: text },
      metadata: { userId: fromId, messageId, chatId, imageUrls },
    })
  }

  private convertToAppMessage(msg: StoredQQMessage): AppMessage {
    return {
      id: msg.messageId,
      platform: 'qq',
      chatId: msg.chatId,
      senderId: msg.fromId,
      senderName: msg.isFromBot ? (this.status.botName || 'QQ Bot') : (msg.fromName || msg.fromId),
      content: msg.text || '',
      isFromBot: msg.isFromBot,
      timestamp: new Date(msg.date * 1000),
    }
  }
}

export const qqBotService = new QQBotService()
