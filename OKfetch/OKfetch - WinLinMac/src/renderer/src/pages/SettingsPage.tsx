import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { renderSVG } from 'uqr'
import type { SecurityInfo, Settings } from '../../../shared/ipc'
import { MAX_PASSWORD_LENGTH, passwordLength, validatePassword } from '../../../shared/keys'
import type { BlockedView } from '../../../shared/model'
import { formatQr } from '../../../shared/qr'
import { COLOR_ROLES, FLAG_NAMES, PRESETS, lightness, resolveColors, resolveFlags, type FlagName } from '../../../shared/theme'
import { api } from '../api'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import { SecretInput } from '../components/SecretInput'
import { useApp } from '../context'
import { useData } from '../data'
import { Okfetch, isNative } from '../mobile/native'
import { isAndroid, useBack, usePhone } from '../mobile/phone'
import { groupId, shortId } from '../util/format'
import { NetworkGroup } from './NetworkGroup'
import { toAvatarPng } from '../util/image'

const DESKTOP_THEMES: Settings['theme'][] = ['light', 'dark', 'opikula', 'custom']
const PHONE_THEMES: Settings['theme'][] = ['system', 'light', 'dark', 'opikula', 'custom']
// The phone has no window frame: these switches mean nothing there.
const DESKTOP_ONLY_FLAGS = new Set(['native_titlebar', 'window_border', 'titlebar_border'])
const LOCK_TIMES = [0, 1, 5, 15]
const TABS = ['settings.tab.profile', 'settings.tab.appearance', 'settings.tab.security', 'settings.tab.system']
const tabLabel = (key: string): string => (key === 'settings.tab.system' && isAndroid() ? 'settings.tab.system_phone' : key)

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}

function ProfileTab() {
  const { t, notify } = useApp()
  const { profile } = useData()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)

  useEffect(() => {
    if (profile) setUsername(profile.username)
  }, [profile?.username]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile) return null

  const saveName = async (): Promise<void> => {
    await api.setUsername(username.trim())
    notify(t('settings.username_saved'))
  }
  const pickAvatar = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      if (!(await api.setAvatar(await toAvatarPng(file)))) throw new Error('rejected')
      notify(t('settings.avatar_saved'))
    } catch {
      notify(t('settings.avatar_failed'), true)
    }
  }
  const savePassword = async (): Promise<void> => {
    const error = validatePassword(password)
    if (error) return setPasswordError(t(`password.error.${error}`, { max: MAX_PASSWORD_LENGTH }))
    setPasswordError(null)
    const result = await api.setPassword(password)
    if (result) return setPasswordError(t(`password.error.${result}`, { max: MAX_PASSWORD_LENGTH }))
    setPassword('')
    notify(t('settings.password_saved'))
  }
  const removePassword = async (): Promise<void> => {
    await api.setPassword(null)
    notify(t('settings.password_removed'))
  }

  return (
    <>
      <Group title={t('settings.username')}>
        <p className="muted">{t('settings.username_info')}</p>
        <div className="row">
          <input className="grow" value={username} maxLength={64} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void saveName()} />
          <button type="button" className="primary" onClick={() => void saveName()}>
            {t('common.save')}
          </button>
        </div>
      </Group>
      <Group title={t('settings.avatar')}>
        <p className="muted">{t('settings.avatar_info')}</p>
        <div className="row">
          <Avatar name={profile.username || '?'} src={profile.avatar} size={64} />
          <label className="button">
            <Icon name="upload" size={16} /> {t('settings.avatar_choose')}
            <input type="file" hidden accept="image/png,image/jpeg,image/x-icon,image/vnd.microsoft.icon,.ico" onChange={(e) => { void pickAvatar(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {profile.avatar && (
            <button type="button" className="danger-outline" onClick={() => void api.setAvatar(null)}>
              {t('settings.avatar_remove')}
            </button>
          )}
        </div>
      </Group>
      <Group title={t('settings.identifier')}>
        <p className="muted">{t('settings.identifier_info')}</p>
        <div className="row">
          <input className="grow mono" readOnly value={groupId(profile.identifier)} onFocus={(e) => e.target.select()} />
          <button type="button" onClick={() => { void api.copyText(profile.identifier); notify(t('settings.identifier_copied')) }}>
            <Icon name="copy" size={16} /> {t('settings.copy')}
          </button>
        </div>
      </Group>
      <Group title={t('qr.title')}>
        <p className="muted">{t('qr.info')}</p>
        <ProfileQr identifier={profile.identifier} username={profile.username} />
      </Group>
      <Group title={t('settings.password')}>
        <p className="muted">{t('settings.password_info')}</p>
        <p>{profile.passwordSet ? t('settings.password_on') : <span className="error-text">{t('settings.password_off')}</span>}</p>
        <SecretInput value={password} maxLength={80} placeholder={t('settings.password_placeholder', { max: MAX_PASSWORD_LENGTH })} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void savePassword()} />
        <div className="counter muted">{passwordLength(password)} / {MAX_PASSWORD_LENGTH}</div>
        {passwordError && <div className="banner">{passwordError}</div>}
        <div className="row">
          <button type="button" className="primary" disabled={!password.trim()} onClick={() => void savePassword()}>
            {t(profile.passwordSet ? 'settings.password_change' : 'settings.password_set')}
          </button>
          {profile.passwordSet && (
            <button type="button" className="danger-outline" onClick={() => void removePassword()}>
              {t('settings.password_remove')}
            </button>
          )}
        </div>
      </Group>
    </>
  )
}

/** The identifier (and the user name) as a QR code, black on white so every camera reads it. */
function ProfileQr({ identifier, username }: { identifier: string; username: string }) {
  const svg = useMemo(() => renderSVG(formatQr(identifier, username), { ecc: 'M', border: 2, pixelSize: 6, blackColor: '#000000', whiteColor: '#FFFFFF' }), [identifier, username])
  return <div className="qr-box" role="img" aria-label="QR" dangerouslySetInnerHTML={{ __html: svg }} />
}

function AppearanceTab() {
  const { t, settings, updateSettings, notify } = useApp()
  const [base, setBase] = useState<keyof typeof PRESETS>(settings.theme === 'custom' || settings.theme === 'system' ? 'opikula' : settings.theme)
  const colors = resolveColors(settings)
  const flags = resolveFlags(settings)
  const isCustom = settings.theme === 'custom'

  const setTheme = (theme: Settings['theme']): Promise<void> =>
    updateSettings(theme === 'custom' && !Object.keys(settings.custom_colors).length ? { theme, custom_colors: { ...colors } } : { theme })
  const setColor = (role: string, value: string): Promise<void> => updateSettings({ custom_colors: { ...colors, [role]: value.toUpperCase() } })
  const setFlag = async (name: FlagName, value: boolean): Promise<void> => {
    if (name === 'native_titlebar') notify(t('settings.restart_frame'))
    await updateSettings({ custom_flags: { ...flags, [name]: value } })
  }

  return (
    <>
      <Group title={t('settings.general')}>
        <div className="form-row">
          <span>{t('settings.language')}</span>
          <select value={settings.language} onChange={(e) => void updateSettings({ language: e.target.value as Settings['language'] })}>
            <option value="cs">Čeština</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="form-row">
          <span>{t('settings.font_size')}</span>
          <div className="row">
            <input className="number" type="number" min={8} max={22} value={settings.font_size} onChange={(e) => void updateSettings({ font_size: Number(e.target.value) })} />
            <span className="muted">pt</span>
          </div>
        </div>
      </Group>
      <Group title={t('settings.theme')}>
        {(isAndroid() ? PHONE_THEMES : DESKTOP_THEMES).map((theme) => (
          <label key={theme} className="check">
            <input type="radio" name="theme" checked={settings.theme === theme} onChange={() => void setTheme(theme)} />
            {t(`theme.${theme}`)}
          </label>
        ))}
      </Group>
      <fieldset className="group" disabled={!isCustom}>
        <legend>{t('settings.custom')}</legend>
        <div className="row">
          <span>{t('settings.custom_base')}</span>
          <select className="grow" value={base} onChange={(e) => setBase(e.target.value as keyof typeof PRESETS)}>
            {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((key) => (
              <option key={key} value={key}>
                {t(`theme.${key}`)}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void updateSettings({ custom_colors: { ...PRESETS[base] } })}>
            {t('settings.custom_load')}
          </button>
        </div>
        <div className="color-grid">
          {COLOR_ROLES.map((role) => (
            <label key={role} className="color-row">
              <span>{t(`color.${role}`)}</span>
              <span className="swatch" style={{ background: colors[role], color: lightness(colors[role]) > 0.55 ? '#000000' : '#FFFFFF' }}>
                {colors[role]}
                <input type="color" value={colors[role].toLowerCase()} onChange={(e) => void setColor(role, e.target.value)} />
              </span>
            </label>
          ))}
        </div>
        <h3 className="subheading">{t('settings.elements')}</h3>
        {FLAG_NAMES.filter((name) => !isAndroid() || !DESKTOP_ONLY_FLAGS.has(name)).map((name) => (
          <label key={name} className="check">
            <input type="checkbox" checked={flags[name]} onChange={(e) => void setFlag(name, e.target.checked)} />
            {t(`flag.${name}`)}
          </label>
        ))}
      </fieldset>
    </>
  )
}

function SecurityTab() {
  const { t } = useApp()
  const [info, setInfo] = useState<SecurityInfo | null>(null)
  const [blocked, setBlocked] = useState<BlockedView[]>([])
  const load = (): void => void api.listBlocked().then(setBlocked)
  useEffect(() => {
    void api.getSecurityInfo().then(setInfo)
    load()
    return api.onEvent((event) => {
      if (event.type === 'blocked') load()
    })
  }, [])

  return (
    <>
      {isAndroid() && <LockGroup />}
      <Group title={t('settings.keystore')}>
        <p className="muted">{t('settings.keystore_info')}</p>
        {info && (
          <>
            <p>
              <Icon name="shield" size={14} /> {t('settings.keystore_backend')}: <b>{info.backend}</b>
            </p>
            {!info.strong && <div className="banner">{t('settings.keystore_weak')}</div>}
          </>
        )}
      </Group>
      <Group title={t('settings.attempts')}>
        <p className="muted">{t('settings.attempts_info')}</p>
      </Group>
      <Group title={t('settings.blocked')}>
        {blocked.length === 0 && <p className="muted">{t('settings.blocked_none')}</p>}
        {blocked.map((peer) => (
          <div key={peer.pub} className="row blocked-row">
            <Icon name="ban" size={16} />
            <span className="grow">
              {peer.name || t('settings.blocked_unknown')} <span className="muted" title={peer.pub}>{shortId(peer.pub)}</span>
            </span>
            <button type="button" onClick={() => void api.unblockPeer(peer.pub)}>
              {t('contact.unblock')}
            </button>
          </div>
        ))}
      </Group>
    </>
  )
}

/** Android: fingerprint / screen-lock gate, when it applies again, and the screenshot block. */
function LockGroup() {
  const { t, settings, updateSettings, notify } = useApp()
  const [availability, setAvailability] = useState<'ok' | 'none' | 'unavailable'>('ok')
  useEffect(() => void Okfetch.lockInfo().then((info) => setAvailability(info.availability)).catch(() => undefined), [])

  const toggleLock = async (on: boolean): Promise<void> => {
    if (!on) return updateSettings({ app_lock: false })
    const info = await Okfetch.lockInfo().catch(() => ({ availability: 'unavailable' as const }))
    setAvailability(info.availability)
    if (info.availability !== 'ok') return notify(t(`lock.${info.availability}`), true)
    const { ok } = await Okfetch.verifyLock().catch(() => ({ ok: false }))
    if (ok) await updateSettings({ app_lock: true })
  }

  return (
    <Group title={t('lock.title')}>
      <p className="muted">{t('lock.info')}</p>
      <label className="check">
        <input type="checkbox" checked={settings.app_lock} disabled={!settings.app_lock && availability !== 'ok'} onChange={(e) => void toggleLock(e.target.checked)} />
        {t('lock.enable')}
      </label>
      {availability !== 'ok' && <div className="banner">{t(`lock.${availability}`)}</div>}
      <div className="form-row">
        <span>{t('lock.after')}</span>
        <select value={settings.lock_after} disabled={!settings.app_lock} onChange={(e) => void updateSettings({ lock_after: Number(e.target.value) })}>
          {LOCK_TIMES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes === 0 ? t('lock.now') : t('lock.minutes', { n: minutes })}
            </option>
          ))}
        </select>
      </div>
      <label className="check">
        <input type="checkbox" checked={settings.block_screenshots} onChange={(e) => void updateSettings({ block_screenshots: e.target.checked })} />
        {t('lock.screenshots')}
      </label>
    </Group>
  )
}

/** Android: background service, notifications, battery, backup and restore. */
function PhoneSystemTab() {
  const { t, settings, updateSettings, notify, confirm } = useApp()
  const [optimized, setOptimized] = useState(false)
  const [granted, setGranted] = useState(true)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [withFiles, setWithFiles] = useState(false)
  const [restorePassword, setRestorePassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const refresh = (): void => {
      void Okfetch.batteryInfo().then((info) => setOptimized(info.optimized)).catch(() => undefined)
      void Okfetch.notificationsInfo().then((info) => setGranted(info.granted)).catch(() => undefined)
    }
    refresh()
    // Coming back from the system settings screen.
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])

  const toggleNotifications = async (on: boolean): Promise<void> => {
    await updateSettings({ notifications: on })
    if (on && isNative) {
      const result = await Okfetch.requestNotifications().catch(() => ({ granted: false }))
      setGranted(result.granted)
    }
  }

  const backup = async (): Promise<void> => {
    if (password.length < 8) return notify(t('backup.error.short'), true)
    if (password !== again) return notify(t('backup.error.mismatch'), true)
    setBusy(true)
    const result = await api.createBackup(password, withFiles)
    setBusy(false)
    if (result.ok) {
      setPassword('')
      setAgain('')
      notify(t('backup.done'))
    } else if (result.error !== 'cancelled') {
      notify(t(result.error === 'key_unavailable' ? 'backup.error.key_unavailable' : 'backup.error.io'), true)
    }
  }

  const restore = async (): Promise<void> => {
    const ok = await confirm({ title: t('backup.restore'), text: t('backup.restore_text'), confirmText: t('backup.restore'), danger: true })
    if (!ok) return
    setBusy(true)
    const result = await api.restoreBackup(restorePassword)
    setBusy(false)
    if (result.ok) {
      setRestorePassword('')
      notify(t('backup.restored'))
    } else if (result.error !== 'cancelled') {
      notify(t(`backup.error.${result.error === 'wrong_password' ? 'wrong_password' : 'damaged'}`), true)
    }
  }

  return (
    <>
      <Group title={t('phone.background')}>
        <p className="muted">{t('phone.background_info')}</p>
        <label className="check">
          <input type="checkbox" checked={settings.background_service} onChange={(e) => void updateSettings({ background_service: e.target.checked })} />
          {t('phone.background_on')}
        </label>
        <p className={optimized ? 'banner' : 'muted'}>{t(optimized ? 'phone.battery_optimized' : 'phone.battery_ok')}</p>
        {optimized && (
          <button type="button" onClick={() => void Okfetch.openBatterySettings()}>
            {t('phone.battery_button')}
          </button>
        )}
      </Group>
      <Group title={t('phone.notifications')}>
        <label className="check">
          <input type="checkbox" checked={settings.notifications} onChange={(e) => void toggleNotifications(e.target.checked)} />
          {t('settings.notifications')}
        </label>
        {settings.notifications && !granted && <div className="banner">{t('phone.notifications_denied')}</div>}
        <label className="check">
          <input type="checkbox" checked={settings.hide_notification_content} onChange={(e) => void updateSettings({ hide_notification_content: e.target.checked })} />
          {t('phone.hide_content')}
        </label>
      </Group>
      <NetworkGroup />
      <Group title={t('backup.title')}>
        <p className="muted">{t('backup.info')}</p>
        <label className="field-label">{t('backup.password')}</label>
        <SecretInput value={password} maxLength={128} onChange={(e) => setPassword(e.target.value)} />
        <label className="field-label">{t('backup.password_again')}</label>
        <SecretInput value={again} maxLength={128} onChange={(e) => setAgain(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} />
          {t('backup.with_files')}
        </label>
        <button type="button" className="primary" disabled={busy || !password} onClick={() => void backup()}>
          <Icon name="download" size={16} /> {busy ? t('common.working') : t('backup.create')}
        </button>
        <h3 className="subheading">{t('backup.restore')}</h3>
        <p className="muted">{t('backup.restore_info')}</p>
        <SecretInput value={restorePassword} maxLength={128} placeholder={t('backup.password')} onChange={(e) => setRestorePassword(e.target.value)} />
        <button type="button" className="danger-outline" disabled={busy || !restorePassword} onClick={() => void restore()}>
          <Icon name="upload" size={16} /> {t('backup.restore')}
        </button>
      </Group>
    </>
  )
}

function SystemTab() {
  const { t, settings, updateSettings, notify } = useApp()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => void api.getSecurityInfo().then((info) => setPath(info.storagePath)), [])

  const changePath = async (): Promise<void> => {
    const folder = await api.pickFolder()
    if (!folder) return
    setBusy(true)
    const result = await api.useStoragePath(folder, true)
    setBusy(false)
    if (result.ok) {
      notify(t('settings.storage_moved'))
      void api.getSecurityInfo().then((info) => setPath(info.storagePath))
    } else {
      notify(t(`storage.error.${result.error}`), true)
    }
  }

  return (
    <>
      <Group title={t('settings.storage')}>
        <p className="muted">{t('settings.storage_info')}</p>
        <div className="row">
          <input className="grow mono" readOnly value={path} onFocus={(e) => e.target.select()} />
          <button type="button" disabled={busy} onClick={() => void changePath()}>
            <Icon name="folder" size={16} /> {t('settings.storage_change')}
          </button>
        </div>
      </Group>
      <Group title={t('settings.system')}>
        <label className="check">
          <input type="checkbox" checked={settings.notifications} onChange={(e) => void updateSettings({ notifications: e.target.checked })} />
          {t('settings.notifications')}
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.close_to_tray} onChange={(e) => void updateSettings({ close_to_tray: e.target.checked })} />
          {t('settings.close_to_tray')}
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.autostart} onChange={(e) => void updateSettings({ autostart: e.target.checked })} />
          {t('settings.autostart')}
        </label>
      </Group>
      <NetworkGroup />
    </>
  )
}

const TAB_ICONS = ['user_plus', 'edit', 'shield', 'settings'] as const

export function SettingsPage({ visible }: { visible: boolean }) {
  const { t } = useApp()
  const phone = usePhone()
  const [tab, setTab] = useState(0)
  // The phone shows the list of sections first; a section opens full screen.
  const [section, setSection] = useState<number | null>(null)
  useBack(phone && visible && section !== null, () => setSection(null))
  const panels = [<ProfileTab key="p" />, <AppearanceTab key="a" />, <SecurityTab key="s" />, isAndroid() ? <PhoneSystemTab key="y" /> : <SystemTab key="y" />]

  if (phone) {
    return (
      <div className={`page settings-page ${visible ? '' : 'hidden'}`}>
        <div className="settings-body phone-settings">
          {section === null ? (
            <div className="section-list">
              {TABS.map((key, index) => (
                <button key={key} type="button" className="section-item" onClick={() => setSection(index)}>
                  <Icon name={TAB_ICONS[index]} size={20} />
                  <span className="grow">{t(tabLabel(key))}</span>
                  <Icon name="chevron_right" size={18} />
                </button>
              ))}
            </div>
          ) : (
            <>
              <button type="button" className="section-back" onClick={() => setSection(null)}>
                <Icon name="back" size={18} /> {t(tabLabel(TABS[section]))}
              </button>
              <div className="settings-panel">{panels[section]}</div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`page settings-page ${visible ? '' : 'hidden'}`}>
      <div className="settings-body">
        <div className="tabs" role="tablist">
          {TABS.map((key, index) => (
            <button key={key} type="button" role="tab" aria-selected={tab === index} className={`tab ${tab === index ? 'checked' : ''}`} onClick={() => setTab(index)}>
              {t(tabLabel(key))}
            </button>
          ))}
        </div>
        <div className="tab-panel settings-panel">{panels[tab]}</div>
      </div>
    </div>
  )
}
