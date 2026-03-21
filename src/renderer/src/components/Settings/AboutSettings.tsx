import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { appIcon } from '../../assets'

export function AboutSettings(): JSX.Element {
  const { t } = useTranslation()
  const appName = 'memU bot'
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    window.updater.getVersion().then((result) => {
      if (result.success && result.data) {
        setAppVersion(result.data)
      }
    })
  }, [])

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{t('settings.about.title')}</h3>
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{t('settings.about.description')}</p>
      </div>

      <div className="p-6 rounded-2xl bg-[var(--glass-bg)] backdrop-blur-xl border border-[var(--glass-border)] shadow-sm text-center">
        <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-[var(--icon-bg)] flex items-center justify-center shadow-lg">
          <img src={appIcon} alt={appName} className="w-16 h-16 rounded-xl" />
        </div>
        <h4 className="text-lg font-semibold text-[var(--text-primary)]">{appName}</h4>
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5 select-none">
          {t('settings.about.version')} {appVersion}
        </p>
        <div className="mt-4 pt-4 border-t border-[var(--border-color)] text-left space-y-2">
          <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
            {t('settings.about.memu.tagline')}
          </p>
          <ul className="text-[12px] text-[var(--text-muted)] leading-relaxed space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-[var(--primary)]">{'\u2022'}</span>
              <span>{t('settings.about.memu.feature1')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[var(--primary)]">{'\u2022'}</span>
              <span>{t('settings.about.memu.feature2')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[var(--primary)]">{'\u2022'}</span>
              <span>{t('settings.about.memu.feature3')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[var(--primary)]">{'\u2022'}</span>
              <span>{t('settings.about.memu.feature4')}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="space-y-2">
        <div className="p-3.5 rounded-xl bg-[var(--glass-bg)] backdrop-blur-xl border border-[var(--glass-border)] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--text-muted)]">Electron</span>
            <span className="text-[12px] text-[var(--text-primary)] font-medium tabular-nums">
              {window.electron?.process?.versions?.electron ?? '-'}
            </span>
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-[var(--glass-bg)] backdrop-blur-xl border border-[var(--glass-border)] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--text-muted)]">Node.js</span>
            <span className="text-[12px] text-[var(--text-primary)] font-medium tabular-nums">
              {window.electron?.process?.versions?.node ?? '-'}
            </span>
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-[var(--glass-bg)] backdrop-blur-xl border border-[var(--glass-border)] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--text-muted)]">Chrome</span>
            <span className="text-[12px] text-[var(--text-primary)] font-medium tabular-nums">
              {window.electron?.process?.versions?.chrome ?? '-'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
