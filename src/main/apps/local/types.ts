/**
 * Local chat platform types
 */

export interface StoredLocalMessage {
  messageId: string
  sessionId: string
  text: string
  date: number
  isFromBot: boolean
  replyToMessageId?: string
  metadata?: Record<string, unknown>
}
