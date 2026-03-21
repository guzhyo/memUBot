import { useState, useEffect, useRef } from 'react'
import { Shield, Key, Copy, RefreshCw, Loader2, Check, Download, Upload, Lock, AlertTriangle, FileKey } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../stores/toastStore'

interface SecurityCodeInfo {
  active: boolean
  expiresAt?: number
  remainingSeconds?: number
}

interface SecureStorageStats {
  totalKeys: number
  sensitiveKeys: number
  mcpEnvKeys: number
  isAvailable: boolean
}

export function SecuritySettings(): JSX.Element {
  const { t } = useTranslation()
  const [codeInfo, setCodeInfo] = useState<SecurityCodeInfo | null>(null)
  const [currentCode, setCurrentCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Secure storage states
  const [stats, setStats] = useState<SecureStorageStats | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [importPassword, setImportPassword] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)

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

  // Load secure storage stats on mount
  useEffect(() => {
    loadSecureStorageStats()
  }, [])

  const loadSecureStorageStats = async () => {
    try {
      const result = await window.security.getSecureStorageStats()
      if (result.success && result.data) {
        setStats(result.data)
      }
    } catch (error) {
      console.error('Failed to load secure storage stats:', error)
    }
  }

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

  // Export backup handlers
  const handleExportBackup = async () => {
    if (password.length < 8) {
      toast.error(t('settings.security.passwordMinLength'))
      return
    }
    if (password !== confirmPassword) {
      toast.error(t('settings.security.passwordsNotMatch'))
      return
    }

    setIsProcessing(true)
    try {
      const result = await window.security.exportBackup(password)
      if (result.success && result.data) {
        // Show save dialog
        const dialogResult = await window.security.showSaveBackupDialog()
        if (dialogResult.success && dialogResult.data && !dialogResult.data.canceled && dialogResult.data.filePath) {
          await window.security.writeBackupFile(dialogResult.data.filePath, result.data)
          toast.success(t('settings.security.exportSuccess'))
          setShowExportModal(false)
          setPassword('')
          setConfirmPassword('')
        }
      } else {
        toast.error(result.error || t('settings.security.exportFailed'))
      }
    } catch (error) {
      toast.error(t('settings.security.exportFailed'))
    }
    setIsProcessing(false)
  }

  // Import backup handlers
  const handleImportBackup = async () => {
    if (!importPassword) {
      toast.error(t('settings.security.enterPassword'))
      return
    }

    setIsProcessing(true)
    try {
      // Show open dialog
      const dialogResult = await window.security.showOpenBackupDialog()
      if (dialogResult.success && dialogResult.data && !dialogResult.data.canceled && dialogResult.data.filePath) {
        const readResult = await window.security.readBackupFile(dialogResult.data.filePath)

        if (readResult.success && readResult.data) {
          // Validate backup first
          const validateResult = await window.security.validateBackup(readResult.data)
          if (!validateResult.success || !validateResult.data?.valid) {
            toast.error(validateResult.data?.message || t('settings.security.invalidBackup'))
            setIsProcessing(false)
            return
          }

          // Import backup
          const importResult = await window.security.importBackup(readResult.data, importPassword)
          if (importResult.success && importResult.data?.success) {
            toast.success(t('settings.security.importSuccess', { count: importResult.data.imported }))
            setShowImportModal(false)
            setImportPassword('')
            loadSecureStorageStats() // Refresh stats
          } else {
            toast.error(importResult.data?.message || t('settings.security.importFailed'))
          }
        } else {
          toast.error(readResult.error || t('settings.security.readBackupFailed'))
        }
      }
    } catch (error) {
      toast.error(t('settings.security.importFailed'))
    }
    setIsProcessing(false)
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

          {/* Security Code Note - Moved directly under the button */}
          <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              <strong>{t('common.note')}:</strong> {t('settings.security.note')}
            </p>
          </div>
        </div>

        {/* Secure Storage Management Section */}
        <div className="p-4 rounded-2xl bg-[var(--glass-bg)] backdrop-blur-xl border border-[var(--glass-border)] shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h4 className="text-[13px] font-medium text-[var(--text-primary)]">{t('settings.security.secureStorageTitle')}</h4>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {t('settings.security.secureStorageHint')}
              </p>
            </div>
          </div>

          {/* Stats Display */}
          {stats && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-center">
                <div className="text-xl font-bold text-[var(--text-primary)]">{stats.totalKeys}</div>
                <div className="text-[10px] text-[var(--text-muted)]">{t('settings.security.totalKeys')}</div>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-center">
                <div className="text-xl font-bold text-emerald-500">{stats.sensitiveKeys}</div>
                <div className="text-[10px] text-[var(--text-muted)]">{t('settings.security.apiKeys')}</div>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-center">
                <div className="text-xl font-bold text-blue-500">{stats.mcpEnvKeys}</div>
                <div className="text-[10px] text-[var(--text-muted)]">{t('settings.security.mcpSecrets')}</div>
              </div>
            </div>
          )}

          {/* Encryption Status */}
          <div className={`p-3 rounded-xl mb-4 flex items-center gap-2 ${stats?.isAvailable ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-amber-500/10 border border-amber-500/20'}`}>
            {stats?.isAvailable ? (
              <>
                <Check className="w-4 h-4 text-emerald-500" />
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                  {t('settings.security.encryptionActive')}
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-[11px] text-amber-600 dark:text-amber-400">
                  {t('settings.security.encryptionNotAvailable')}
                </span>
              </>
            )}
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setShowExportModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-medium hover:bg-[var(--bg-input)] transition-all"
            >
              <Download className="w-4 h-4" />
              <span>{t('settings.security.exportBackup')}</span>
            </button>
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-medium hover:bg-[var(--bg-input)] transition-all"
            >
              <Upload className="w-4 h-4" />
              <span>{t('settings.security.importBackup')}</span>
            </button>
          </div>
        </div>

        {/* Backup Importance Note */}
        <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
          <p className="text-[11px] text-blue-600 dark:text-blue-400">
            <strong>{t('settings.security.backupImportantTitle')}:</strong> {t('settings.security.backupImportantDesc')}
          </p>
        </div>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <FileKey className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <h4 className="text-[15px] font-semibold text-[var(--text-primary)]">{t('settings.security.exportBackupTitle')}</h4>
                <p className="text-[11px] text-[var(--text-muted)]">{t('settings.security.exportBackupDesc')}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-2">
                  {t('settings.security.backupPasswordLabel')}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('settings.security.backupPasswordPlaceholder')}
                  className="w-full px-4 py-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] focus:outline-none focus:border-[var(--primary)] transition-all"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-2">
                  {t('settings.security.confirmPasswordLabel')}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('settings.security.confirmPasswordPlaceholder')}
                  className="w-full px-4 py-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] focus:outline-none focus:border-[var(--primary)] transition-all"
                />
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  <strong>{t('common.important')}:</strong> {t('settings.security.rememberPasswordWarning')}
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowExportModal(false)
                  setPassword('')
                  setConfirmPassword('')
                }}
                className="flex-1 px-4 py-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-medium hover:bg-[var(--bg-card)] transition-all"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleExportBackup}
                disabled={isProcessing || password.length < 8 || password !== confirmPassword}
                className="flex-1 px-4 py-3 rounded-xl text-white text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--primary-gradient)' }}
              >
                {isProcessing ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('settings.security.exporting')}
                  </span>
                ) : (
                  t('settings.security.export')
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Upload className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h4 className="text-[15px] font-semibold text-[var(--text-primary)]">{t('settings.security.importBackupTitle')}</h4>
                <p className="text-[11px] text-[var(--text-muted)]">{t('settings.security.importBackupDesc')}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-2">
                  {t('settings.security.backupPasswordLabel')}
                </label>
                <input
                  type="password"
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  placeholder={t('settings.security.enterBackupPassword')}
                  className="w-full px-4 py-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] focus:outline-none focus:border-[var(--primary)] transition-all"
                />
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  <strong>{t('common.warning')}:</strong> {t('settings.security.importWarning')}
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowImportModal(false)
                  setImportPassword('')
                }}
                className="flex-1 px-4 py-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] text-[13px] font-medium hover:bg-[var(--bg-card)] transition-all"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleImportBackup}
                disabled={isProcessing || !importPassword}
                className="flex-1 px-4 py-3 rounded-xl text-white text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--primary-gradient)' }}
              >
                {isProcessing ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('settings.security.importing')}
                  </span>
                ) : (
                  t('settings.security.import')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
