/**
 * QQ Bot platform types
 * Based on QQ Bot API v2
 */

// QQ Bot configuration
export interface QQBotConfig {
  appId: string
  appSecret: string
}

// Stored QQ message
export interface StoredQQMessage {
  messageId: string
  chatId: string
  chatType: 'c2c' | 'group' | 'guild'
  fromId: string
  fromName?: string
  text?: string
  attachments?: StoredQQAttachment[]
  date: number // Unix timestamp in seconds
  isFromBot: boolean
}

// Attachment for stored messages
export interface StoredQQAttachment {
  url: string
  contentType?: string
  width?: number
  height?: number
  size?: number
}

// QQ Bot API - Gateway event types
export type QQGatewayEventType =
  | 'C2C_MESSAGE_CREATE'        // Private/direct message
  | 'GROUP_AT_MESSAGE_CREATE'   // Group @ mention
  | 'AT_MESSAGE_CREATE'         // Guild channel mention
  | 'DIRECT_MESSAGE_CREATE'     // Guild direct message
  | 'READY'                     // Gateway ready
  | 'RESUMED'                   // Session resumed

// QQ Bot API - WebSocket op codes
export const QQGatewayOpCode = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const

// QQ Bot API - Message attachment
export interface QQMessageAttachment {
  content_type: string
  filename: string
  height?: number
  width?: number
  id: string
  size: number
  url: string
}

// QQ Bot API - Message author
export interface QQMessageAuthor {
  id: string
  username?: string
  avatar?: string
  member_openid?: string  // For group messages
  user_openid?: string    // For C2C messages
}

// QQ Bot API - C2C (private) message event
export interface QQC2CMessageEvent {
  id: string
  content: string
  timestamp: string
  author: {
    id: string
    user_openid: string
  }
  attachments?: QQMessageAttachment[]
}

// QQ Bot API - Group message event
export interface QQGroupMessageEvent {
  id: string
  content: string
  timestamp: string
  group_id: string
  group_openid: string
  author: {
    id: string
    member_openid: string
  }
  attachments?: QQMessageAttachment[]
}

// QQ Bot API - Guild/channel message event
export interface QQGuildMessageEvent {
  id: string
  content: string
  timestamp: string
  channel_id: string
  guild_id: string
  author: QQMessageAuthor
  attachments?: QQMessageAttachment[]
  direct_message?: boolean
}

// QQ Bot API - Gateway WebSocket message
export interface QQGatewayMessage {
  op: number
  d?: unknown
  s?: number
  t?: string
}

// QQ Bot API - Access token response
export interface QQAccessTokenResponse {
  access_token: string
  expires_in: number
}

// QQ Bot API - Send message response
export interface QQSendMessageResponse {
  id: string
  timestamp: string
}
