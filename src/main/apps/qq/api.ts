import * as https from 'https'
import * as http from 'http'
import type {
  QQAccessTokenResponse,
  QQSendMessageResponse,
} from './types'

const QQ_API_BASE = 'https://api.sgroup.qq.com'
const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const REQUEST_TIMEOUT_MS = 30_000

/**
 * QQ Bot API v2 HTTP client
 * Handles token management and all REST API calls
 */
export class QQBotApi {
  private appId: string
  private appSecret: string
  private accessToken: string | null = null
  private tokenExpiresAt: number = 0
  private tokenRefreshPromise: Promise<string> | null = null

  constructor(appId: string, appSecret: string) {
    this.appId = appId
    this.appSecret = appSecret
  }

  // ==================== Token Management ====================

  /**
   * Get a valid access token, refreshing if needed.
   * Uses singleflight pattern to avoid concurrent refreshes.
   */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken
    }
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise
    }
    this.tokenRefreshPromise = this.refreshAccessToken().finally(() => {
      this.tokenRefreshPromise = null
    })
    return this.tokenRefreshPromise
  }

  private async refreshAccessToken(): Promise<string> {
    const body = JSON.stringify({ appId: this.appId, clientSecret: this.appSecret })
    const result = await this.request<QQAccessTokenResponse>(
      'POST',
      QQ_TOKEN_URL,
      body,
      { skipAuth: true }
    )
    this.accessToken = result.access_token
    this.tokenExpiresAt = Date.now() + result.expires_in * 1000
    console.log(`[QQ API] Access token refreshed, expires in ${result.expires_in}s`)
    return this.accessToken
  }

  // ==================== HTTP Request ====================

  private async request<T>(
    method: string,
    url: string,
    body?: string,
    opts?: { skipAuth?: boolean }
  ): Promise<T> {
    const token = opts?.skipAuth ? null : await this.getAccessToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (token) {
      headers['Authorization'] = `QQBot ${token}`
    }

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const isHttps = parsedUrl.protocol === 'https:'
      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      }

      const req = (isHttps ? https : http).request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`QQ API error ${res.statusCode}: ${data}`))
            } else {
              resolve(parsed as T)
            }
          } catch {
            reject(new Error(`Failed to parse QQ API response: ${data}`))
          }
        })
      })

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy()
        reject(new Error('QQ API request timed out'))
      })

      req.on('error', reject)

      if (body) req.write(body)
      req.end()
    })
  }

  // ==================== Send Messages ====================

  /**
   * Send a C2C (private) message in reply to a user message
   */
  async sendC2CMessage(
    userOpenid: string,
    content: string,
    msgId: string
  ): Promise<QQSendMessageResponse> {
    return this.request<QQSendMessageResponse>(
      'POST',
      `${QQ_API_BASE}/v2/users/${userOpenid}/messages`,
      JSON.stringify({ content, msg_type: 0, msg_id: msgId })
    )
  }

  /**
   * Send a group message in reply to a group message
   */
  async sendGroupMessage(
    groupOpenid: string,
    content: string,
    msgId: string
  ): Promise<QQSendMessageResponse> {
    return this.request<QQSendMessageResponse>(
      'POST',
      `${QQ_API_BASE}/v2/groups/${groupOpenid}/messages`,
      JSON.stringify({ content, msg_type: 0, msg_id: msgId })
    )
  }

  /**
   * Send a guild channel message
   */
  async sendGuildMessage(
    channelId: string,
    content: string,
    msgId?: string
  ): Promise<QQSendMessageResponse> {
    const payload: Record<string, unknown> = { content }
    if (msgId) payload['msg_id'] = msgId
    return this.request<QQSendMessageResponse>(
      'POST',
      `${QQ_API_BASE}/channels/${channelId}/messages`,
      JSON.stringify(payload)
    )
  }

  /**
   * Send a guild direct message
   */
  async sendDirectMessage(
    guildId: string,
    content: string,
    msgId?: string
  ): Promise<QQSendMessageResponse> {
    const payload: Record<string, unknown> = { content }
    if (msgId) payload['msg_id'] = msgId
    return this.request<QQSendMessageResponse>(
      'POST',
      `${QQ_API_BASE}/dms/${guildId}/messages`,
      JSON.stringify(payload)
    )
  }

  // ==================== Bot Info ====================

  async getBotInfo(): Promise<{ id: string; username: string; avatar: string }> {
    return this.request('GET', `${QQ_API_BASE}/users/@me`)
  }
}
