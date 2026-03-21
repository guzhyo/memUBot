import { useState, useEffect, useRef } from 'react'
import { Shield, Key, Copy, RefreshCw, Loader2, Check, FolderLock, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../stores/toastStore'

interface SecurityCodeInfo {
  active: boolean
  expiresAt?: number
  remainingSeconds?: number
}

export function SecuritySettings(): JSX.Element {
  const { t } = useTranslation()
  const [codeInfo, setCodeInfo] = useState<SecurityCodeInfo | null>(null)
  const [currentCode, setCurrentCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const [boundaryRoot, setBoundaryRoot] = useState('')
  const [boundaryLoading, setBoundaryLoading] = useState(true)
  const [boundarySaving, setBoundarySaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const result = await window.settings.get()
        if (result.success && result.data) {
          setBoundaryRoot(result.data.fileAccessBoundaryRoot ?? '')
        }
      } catch { /* ignore */ }
      setBoundaryLoading(false)
    })()
  }, [])

  const saveBoundaryRoot = async (value: string) => {
    setBoundarySaving(true)
    try {
      const result = await window.settings.save({ fileAccessBoundaryRoot: value })
      if (result.success) {
        setBoundaryRoot(value)
        toast.success(t('common.saved'))
      } else {
        toast.error(result.error || t('settings.saveError'))
      }
    } catch {
      toast.error(t('settings.saveError'))
    }
    setBoundarySaving(false)
  }

  // Countdown timer
  useEffect(() => {
    if (codeInfo?.active && codeInfo.remainingSeconds && codeInfo.remainingSeconds > 0) {
      timerRef.current = setInterval(() => {
        setCodeInfo((prev) => {
          if (!prev || !prev.remainingSeconds) return prev
          const newSeconds = prev.remainingSeconds - 1
          if (newSeconds <= 0) {
            setCurrentCode(null)
            return { active: false }
          }
          return { ...prev, remainingSeconds: newSeconds }
        })
      }, 1000)

      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current)
        }
      }
    }
  }, [codeInfo?.active])

  const generateCode = async () => {
    setLoading(true)
    try {
      const result = await window.security.generateCode()
      if (result.success && result.data) {
        setCurrentCode(result.data.code)
        setCodeInfo({
          active: true,
          remainingSeconds: 180 // 3 minutes
        })
        toast.success(t('settings.security.codeGenerated'))
      } else {
        toast.error(result.error || t('settings.security.generateFailed'))
      }
    } catch (error) {
      toast.error(t('settings.security.generateFailed'))
    }
    setLoading(false)
  }

  const copyCode = async () => {
    if (!currentCode) return
    try {
      await navigator.clipboard.writeText(currentCode)
      setCopied(true)
      toast.success(t('common.copied'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('errors.copyFailed'))
    }
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{t('settings.security.title')}</h3>
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
          {t('settings.security.description')}
        </p>
      </div>

      <div className="space-y-3">
        {/* Security Code Section */}
        <div className="p-4 rounded-2xl bg-[var(--glass-bg)] backdrop-blur-xl border border-[var(--glass-border)] shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[var(--primary-bg)] flex items-center justify-center">
              <Key className="w-5 h-5 text-[var(--primary)]" />
            </div>
            <div>
              <h4 className="text-[13px] font-medium text-[var(--text-primary)]">{t('settings.security.securityCode')}</h4>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {t('settings.security.securityCodeHint')}
              </p>
            </div>
          </div>

          {/* Code Display */}
          {currentCode && codeInfo?.active ? (
            <div className="mb-4">
              <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)]">
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-mono font-bold tracking-widest text-[var(--text-primary)]">
                    {currentCode}
                  </span>
                  <button
                    onClick={copyCode}
                    className="p-2 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="text-right">
                  <span className="text-[12px] text-[var(--text-muted)]">{t('settings.security.expiresIn')}</span>
                  <div className="text-[14px] font-mono font-medium text-amber-500">
                    {formatTime(codeInfo.remainingSeconds || 0)}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-2 text-center">
                {t('settings.security.sendCommand')} <code className="px-1 py-0.5 rounded bg-[var(--bg-input)] text-[var(--text-secondary)]">/bind {currentCode}</code>
              </p>
            </div>
          ) : (
            <div className="mb-4 p-4 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-center">
              <Shield className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2" />
              <p className="text-[12px] text-[var(--text-muted)]">
                {t('settings.security.noCodeYet')}
              </p>
            </div>
          )}

          {/* Generate Button */}
          <button
            onClick={generateCode}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white text-[13px] font-medium shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--primary-gradient)', boxShadow: 'var(--shadow-primary)' }}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t('settings.security.generating')}</span>
              </>
            ) : currentCode && codeInfo?.active ? (
              <>
                <RefreshCw className="w-4 h-4" />
                <span>{t('settings.security.regenerate')}</span>
              </>
            ) : (
              <>
                <Key className="w-4 h-4" />
                <span>{t('settings.security.generate')}</span>
              </>
            )}
          </button>
        </div>

        {/* File Access Boundary Section */}
        <div className="p-4 rounded-2xl bg-[var(--glass-bg)] backdrop-blur-xl border border-[var(--glass-border)] shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
              <FolderLock className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h4 className="text-[13px] font-medium text-[var(--text-primary)]">
                {t('settings.security.fileBoundary.title')}
              </h4>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {t('settings.security.fileBoundary.description')}
              </p>
            </div>
          </div>

          {boundaryLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 text-[var(--primary)] animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={boundaryRoot}
                  onChange={(e) => setBoundaryRoot(e.target.value)}
                  placeholder={t('settings.security.fileBoundary.placeholder')}
                  className="flex-1 px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[13px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/30 focus:border-[var(--primary)] transition-all"
                  onBlur={() => saveBoundaryRoot(boundaryRoot)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveBoundaryRoot(boundaryRoot)
                  }}
                  disabled={boundarySaving}
                />
                <button
                  onClick={() => saveBoundaryRoot('')}
                  disabled={boundarySaving || boundaryRoot === ''}
                  title={t('settings.security.fileBoundary.resetDefault')}
                  className="p-2.5 rounded-xl border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-primary)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-2 opacity-70">
                {t('settings.security.fileBoundary.hint')}
              </p>
            </>
          )}
        </div>

        {/* Security Notes */}
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            <strong>{t('common.note')}:</strong> {t('settings.security.note')}
          </p>
        </div>
      </div>
    </div>
  )
}
