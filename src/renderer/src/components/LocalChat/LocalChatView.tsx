import { useState, type KeyboardEvent } from 'react'
import { Loader2, MessageSquare, SendHorizontal, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { UnifiedMessageList, platformColors } from '../Shared'
import { toast } from '../Toast'

export function LocalChatView(): JSX.Element {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  const handleSend = async (): Promise<void> => {
    const message = input.trim()
    if (!message || isSending) return

    setInput('')
    setIsSending(true)

    try {
      const result = await window.local.sendMessage(message)
      if (!result.success) {
        setInput(message)
        toast.error(result.error || t('errors.messageFailed'))
      }
    } catch (error) {
      setInput(message)
      toast.error(error instanceof Error ? error.message : t('errors.messageFailed'))
    } finally {
      setIsSending(false)
    }
  }

  const handleClear = async (): Promise<void> => {
    if (isClearing) return

    setIsClearing(true)
    try {
      const result = await window.local.clearMessages()
      if (result.success) {
        toast.success(t('localChat.cleared'))
      } else {
        toast.error(result.error || t('errors.deleteFailed'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('errors.deleteFailed'))
    } finally {
      setIsClearing(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <UnifiedMessageList
        api={window.local}
        colors={platformColors.local}
        emptyIcon={MessageSquare}
        emptyTitle={t('messages.empty.title', 'No Messages Yet')}
        emptyDescription={t('messages.empty.local')}
      />

      <div className="border-t border-[var(--border-color)] bg-[var(--glass-bg)] backdrop-blur-xl">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <p className="text-xs text-[var(--text-muted)]">{t('localChat.helper')}</p>
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={isSending || isClearing}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {isClearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            <span>{isClearing ? t('common.clearing') : t('localChat.clearHistory')}</span>
          </button>
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-end gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-3 shadow-sm">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('messages.typeMessage')}
              disabled={isSending || isClearing}
              rows={1}
              className="min-h-[44px] max-h-40 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />

            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!input.trim() || isSending || isClearing}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#0f766e] to-[#14b8a6] text-white shadow-lg shadow-[#14b8a6]/20 transition disabled:cursor-not-allowed disabled:opacity-50"
              title={t('messages.send')}
            >
              {isSending ? (
                <Loader2 className="w-4.5 h-4.5 animate-spin" />
              ) : (
                <SendHorizontal className="w-4.5 h-4.5" />
              )}
            </button>
          </div>

          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            {isSending ? t('messages.thinking') : t('localChat.enterHint')}
          </p>
        </div>
      </div>
    </div>
  )
}
