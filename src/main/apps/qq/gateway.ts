import * as WebSocket from 'ws'
import type { QQBotApi } from './api'
import type {
  QQGatewayMessage,
  QQGatewayEventType,
  QQC2CMessageEvent,
  QQGroupMessageEvent,
  QQGuildMessageEvent,
} from './types'
import { QQGatewayOpCode } from './types'

const QQ_GATEWAY_URL = 'wss://api.sgroup.qq.com/websocket'

// Reconnect backoff intervals in ms
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000]

export type QQGatewayEventHandler = {
  onC2CMessage?: (event: QQC2CMessageEvent) => Promise<void>
  onGroupMessage?: (event: QQGroupMessageEvent) => Promise<void>
  onGuildMessage?: (event: QQGuildMessageEvent) => Promise<void>
  onDirectMessage?: (event: QQGuildMessageEvent) => Promise<void>
  onReady?: (botInfo: { id: string; username: string }) => void
}

/**
 * QQ Bot Gateway - manages WebSocket connection to QQ's gateway
 * Handles heartbeat, identify/resume, and event dispatch
 */
export class QQGateway {
  private api: QQBotApi
  private handlers: QQGatewayEventHandler
  private ws: WebSocket.WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatIntervalMs = 30_000
  private sessionId: string | null = null
  private lastSeq: number | null = null
  private reconnectAttempt = 0
  private stopped = false

  constructor(api: QQBotApi, handlers: QQGatewayEventHandler) {
    this.api = api
    this.handlers = handlers
  }

  // ==================== Lifecycle ====================

  async connect(): Promise<void> {
    this.stopped = false
    this.reconnectAttempt = 0
    await this.openWebSocket()
  }

  disconnect(): void {
    this.stopped = true
    this.clearHeartbeat()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    console.log('[QQ Gateway] Disconnected')
  }

  // ==================== WebSocket ====================

  private async openWebSocket(): Promise<void> {
    const token = await this.api.getAccessToken()
    const url = `${QQ_GATEWAY_URL}?encoding=json`

    console.log('[QQ Gateway] Connecting to gateway...')
    this.ws = new WebSocket.WebSocket(url)

    this.ws.on('open', () => {
      console.log('[QQ Gateway] WebSocket connected')
    })

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as QQGatewayMessage
        this.handleGatewayMessage(msg, token)
      } catch (err) {
        console.error('[QQ Gateway] Failed to parse message:', err)
      }
    })

    this.ws.on('close', (code) => {
      console.log(`[QQ Gateway] WebSocket closed: ${code}`)
      this.clearHeartbeat()
      if (!this.stopped) {
        this.scheduleReconnect()
      }
    })

    this.ws.on('error', (err) => {
      console.error('[QQ Gateway] WebSocket error:', err)
    })
  }

  private handleGatewayMessage(msg: QQGatewayMessage, token: string): void {
    if (msg.s != null) {
      this.lastSeq = msg.s
    }

    switch (msg.op) {
      case QQGatewayOpCode.HELLO:
        this.heartbeatIntervalMs = (msg.d as { heartbeat_interval: number }).heartbeat_interval
        this.startHeartbeat()
        if (this.sessionId && this.lastSeq != null) {
          this.resume(token)
        } else {
          this.identify(token)
        }
        break

      case QQGatewayOpCode.HEARTBEAT_ACK:
        // heartbeat acknowledged
        break

      case QQGatewayOpCode.RECONNECT:
        console.log('[QQ Gateway] Server requested reconnect')
        this.ws?.close()
        break

      case QQGatewayOpCode.INVALID_SESSION:
        console.log('[QQ Gateway] Invalid session, re-identifying')
        this.sessionId = null
        this.lastSeq = null
        this.identify(token)
        break

      case QQGatewayOpCode.DISPATCH:
        this.handleDispatch(msg)
        break
    }
  }

  // ==================== Identify / Resume ====================

  private identify(token: string): void {
    // Intents: 1<<9 (GUILD_MESSAGES) | 1<<12 (DIRECT_MESSAGE) | 1<<25 (C2C_MESSAGE_CREATE) | 1<<26 (GROUP_AT_MESSAGE_CREATE)
    const intents = (1 << 9) | (1 << 12) | (1 << 25) | (1 << 26)
    this.send({
      op: QQGatewayOpCode.IDENTIFY,
      d: {
        token: `QQBot ${token}`,
        intents,
        shard: [0, 1],
      },
    })
    console.log('[QQ Gateway] Sent IDENTIFY')
  }

  private resume(token: string): void {
    this.send({
      op: QQGatewayOpCode.RESUME,
      d: {
        token: `QQBot ${token}`,
        session_id: this.sessionId,
        seq: this.lastSeq,
      },
    })
    console.log('[QQ Gateway] Sent RESUME')
  }

  // ==================== Heartbeat ====================

  private startHeartbeat(): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: QQGatewayOpCode.HEARTBEAT, d: this.lastSeq })
    }, this.heartbeatIntervalMs)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ==================== Event Dispatch ====================

  private handleDispatch(msg: QQGatewayMessage): void {
    const eventType = msg.t as QQGatewayEventType

    if (eventType === 'READY') {
      const d = msg.d as { session_id: string; user: { id: string; username: string } }
      this.sessionId = d.session_id
      this.reconnectAttempt = 0
      console.log(`[QQ Gateway] Ready, session: ${this.sessionId}, bot: ${d.user.username}`)
      this.handlers.onReady?.({ id: d.user.id, username: d.user.username })
      return
    }

    if (eventType === 'RESUMED') {
      this.reconnectAttempt = 0
      console.log('[QQ Gateway] Resumed')
      return
    }

    if (eventType === 'C2C_MESSAGE_CREATE') {
      const event = msg.d as QQC2CMessageEvent
      this.handlers.onC2CMessage?.(event).catch((err) =>
        console.error('[QQ Gateway] onC2CMessage error:', err)
      )
      return
    }

    if (eventType === 'GROUP_AT_MESSAGE_CREATE') {
      const event = msg.d as QQGroupMessageEvent
      this.handlers.onGroupMessage?.(event).catch((err) =>
        console.error('[QQ Gateway] onGroupMessage error:', err)
      )
      return
    }

    if (eventType === 'AT_MESSAGE_CREATE') {
      const event = msg.d as QQGuildMessageEvent
      this.handlers.onGuildMessage?.(event).catch((err) =>
        console.error('[QQ Gateway] onGuildMessage error:', err)
      )
      return
    }

    if (eventType === 'DIRECT_MESSAGE_CREATE') {
      const event = msg.d as QQGuildMessageEvent
      this.handlers.onDirectMessage?.(event).catch((err) =>
        console.error('[QQ Gateway] onDirectMessage error:', err)
      )
      return
    }
  }

  // ==================== Reconnect ====================

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)]
    this.reconnectAttempt++
    console.log(`[QQ Gateway] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`)
    setTimeout(() => {
      if (!this.stopped) {
        this.openWebSocket().catch((err) =>
          console.error('[QQ Gateway] Reconnect failed:', err)
        )
      }
    }, delay)
  }

  // ==================== Helpers ====================

  private send(msg: QQGatewayMessage): void {
    if (this.ws?.readyState === WebSocket.WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }
}
