import { useEffect, useState, type ReactNode } from 'react'
import type { BiometricStatus, Settings } from '../../../shared/ipc'
import { COLOR_ROLES, FLAG_NAMES, PRESETS, lightness, resolveColors, resolveFlags, type FlagName } from '../../../shared/theme'
import { api, isMobile } from '../api'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { useApp } from '../context'
import { allowExternal, endExternal, withExternal } from '../mobile/shell'
import { signOut } from '../pages/KeyPage'
import { BackupDialog } from './BackupDialog'
import { DecoyKeyDialog } from './DecoyKeyDialog'

const THEMES: Settings['theme'][] = ['light', 'dark', 'opikula', 'custom']
const TABS = ['settings.tab.account', 'settings.tab.appearance', 'settings.tab.security', 'settings.tab.data']
// Window frame options make no sense on a phone.
const DESKTOP_ONLY: FlagName[] = ['native_titlebar', 'window_border', 'titlebar_border']
const VISIBLE_FLAGS = FLAG_NAMES.filter((name) => !(isMobile && DESKTOP_ONLY.includes(name)))

interface Props {
  email: string
  username: string
  decoySet: boolean
  onUsername: (name: string) => void
  onDecoyChange: (set: boolean) => void
  /** Saves unsaved edits; called before actions that reload or replace the vault. */
  flush: () => Promise<void>
  pendingVault: () => Parameters<typeof api.logout>[0]
  onClose: () => void
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}

export function SettingsDialog(props: Props) {
  const { t, settings, updateSettings, confirm, notify } = useApp()
  const [tab, setTab] = useState(0)
  const [username, setUsername] = useState(props.username)
  const [online, setOnline] = useState(true)
  const [decoyDialog, setDecoyDialog] = useState(false)
  const [backups, setBackups] = useState(false)
  const [base, setBase] = useState<keyof typeof PRESETS>(settings.theme === 'custom' ? 'opikula' : settings.theme)
  const [bio, setBio] = useState<BiometricStatus>({ available: false, enabled: false })

  useEffect(() => {
    void api.isOnline().then(setOnline)
    void api.biometricStatus().then(setBio)
  }, [])

  const toggleBiometric = async (on: boolean): Promise<void> => {
    const ok = await withExternal(() => api.setBiometric(on))
    if (!ok) return notify(t('bio.failed'), true)
    setBio(await api.biometricStatus())
    notify(t(on ? 'bio.enabled' : 'bio.disabled'))
  }

  const colors = resolveColors(settings)
  const flags = resolveFlags(settings)
  const isCustom = settings.theme === 'custom'

  const setTheme = (theme: Settings['theme']): Promise<void> =>
    updateSettings(theme === 'custom' && !Object.keys(settings.custom_colors).length ? { theme, custom_colors: { ...colors } } : { theme })

  const setColor = (role: string, value: string): Promise<void> => updateSettings({ custom_colors: { ...colors, [role]: value.toUpperCase() } })

  const setFlag = async (name: FlagName, value: boolean): Promise<void> => {
    if (name === 'native_titlebar') {
      await props.flush()
      notify(t('settings.restart_frame'))
    }
    await updateSettings({ custom_flags: { ...flags, [name]: value } })
  }

  const logout = async (): Promise<void> => {
    const ok = await confirm({ title: t('settings.logout'), text: t('settings.logout_confirm'), confirmText: t('settings.logout'), danger: true })
    if (!ok) return
    props.onClose()
    await signOut(confirm, t, props.pendingVault())
  }

  const saveDecoy = async (key: string): Promise<void> => {
    setDecoyDialog(false)
    await props.flush()
    const error = await api.setDecoy(key)
    if (error) return notify(t(`decoy.error.${error}`), true)
    props.onDecoyChange(true)
    notify(t('decoy.saved'))
  }

  const removeDecoy = async (): Promise<void> => {
    const ok = await confirm({ title: t('decoy.remove'), text: t('decoy.remove_confirm'), confirmText: t('decoy.remove'), danger: true })
    if (!ok) return
    await props.flush()
    await api.removeDecoy()
    props.onDecoyChange(false)
    notify(t('decoy.removed'))
  }

  const importVault = async (picked?: Uint8Array): Promise<void> => {
    const ok = await confirm({ title: t('settings.import'), text: t('settings.import_confirm'), confirmText: t('settings.import'), danger: true })
    if (!ok) return
    await props.flush()
    const result = await api.importVault(picked)
    if (result === 'invalid') notify(t('settings.import_invalid'), true)
    if (result === 'ok') props.onClose()
  }

  /** Phone: the file is picked first (a system screen), then confirmed. */
  const importPicked = async (file: File | undefined): Promise<void> => {
    endExternal()
    if (file) await importVault(new Uint8Array(await file.arrayBuffer()))
  }

  const exportVault = async (): Promise<void> => {
    await props.flush()
    await withExternal(() => api.exportVault())
  }

  const account = (
    <>
      <Group title={t('settings.google')}>
        <p>{props.email}</p>
        <button type="button" className="danger-outline" onClick={logout}>
          <Icon name="logout" size={16} /> {t('settings.logout')}
        </button>
      </Group>
      <Group title={t('settings.username')}>
        <p className="muted">{t('settings.username_info')}</p>
        <div className="row">
          <input
            className="grow"
            value={username}
            maxLength={64}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && props.onUsername(username.trim())}
          />
          <button type="button" className="primary" onClick={() => props.onUsername(username.trim())}>
            {t('common.save')}
          </button>
        </div>
      </Group>
    </>
  )

  const appearance = (
    <>
      <Group title={t('settings.general')}>
        <div className="form-row">
          <span>{t('settings.language')}</span>
          <select value={settings.language} onChange={(e) => updateSettings({ language: e.target.value as Settings['language'] })}>
            <option value="cs">Čeština</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="form-row">
          <span>{t('settings.font_size')}</span>
          <div className="row">
            <input
              className="number"
              type="number"
              min={8}
              max={22}
              value={settings.font_size}
              onChange={(e) => updateSettings({ font_size: Number(e.target.value) })}
            />
            <span className="muted">pt</span>
          </div>
        </div>
      </Group>
      <Group title={t('settings.theme')}>
        {THEMES.map((theme) => (
          <label key={theme} className="check">
            <input type="radio" name="theme" checked={settings.theme === theme} onChange={() => setTheme(theme)} />
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
          <button type="button" onClick={() => updateSettings({ custom_colors: { ...PRESETS[base] } })}>
            {t('settings.custom_load')}
          </button>
        </div>
        <div className="color-grid">
          {COLOR_ROLES.map((role) => (
            <label key={role} className="color-row">
              <span>{t(`color.${role}`)}</span>
              <span className="swatch" style={{ background: colors[role], color: lightness(colors[role]) > 0.55 ? '#000000' : '#FFFFFF' }}>
                {colors[role]}
                <input type="color" value={colors[role].toLowerCase()} onChange={(e) => setColor(role, e.target.value)} />
              </span>
            </label>
          ))}
        </div>
        <h3 className="subheading">{t('settings.elements')}</h3>
        {VISIBLE_FLAGS.map((name) => (
          <label key={name} className="check">
            <input type="checkbox" checked={flags[name]} onChange={(e) => setFlag(name, e.target.checked)} />
            {t(`flag.${name}`)}
          </label>
        ))}
      </fieldset>
    </>
  )

  const security = (
    <>
      <Group title={t('settings.autolock')}>
        <p className="muted">{t('settings.autolock_info')}</p>
        <div className="row">
          <input
            className="number"
            type="number"
            min={0}
            max={240}
            value={settings.autolock_minutes}
            onChange={(e) => updateSettings({ autolock_minutes: Number(e.target.value) })}
          />
          <span className="muted">{settings.autolock_minutes === 0 ? t('settings.autolock_off') : 'min'}</span>
        </div>
      </Group>
      <Group title={t('decoy.title')}>
        <p className="muted">{t('decoy.info')}</p>
        <p>{props.decoySet ? t('decoy.status_on') : t('decoy.status_off')}</p>
        <div className="row">
          {props.decoySet ? (
            <>
              <button type="button" onClick={() => setDecoyDialog(true)}>
                {t('decoy.change')}
              </button>
              <button type="button" className="danger-outline" onClick={removeDecoy}>
                {t('decoy.remove')}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setDecoyDialog(true)}>
              {t('decoy.set')}
            </button>
          )}
        </div>
      </Group>
      {bio.available && (
        <Group title={t('bio.title')}>
          <p className="muted">{t('bio.info')}</p>
          <p>{bio.enabled ? t('bio.status_on') : t('bio.status_off')}</p>
          <div>
            <button type="button" className={bio.enabled ? 'danger-outline' : ''} onClick={() => toggleBiometric(!bio.enabled)}>
              <Icon name="fingerprint" size={16} /> {t(bio.enabled ? 'bio.disable' : 'bio.enable')}
            </button>
          </div>
        </Group>
      )}
    </>
  )

  const data = (
    <>
      <Group title={t('settings.backups')}>
        <p className="muted">{t('settings.backups_info')}</p>
        <div className="row">
          <span>{t('settings.backup_count')}</span>
          <input
            className="number"
            type="number"
            min={0}
            max={50}
            value={settings.backup_count}
            onChange={(e) => updateSettings({ backup_count: Number(e.target.value) })}
          />
        </div>
        <div>
          <button type="button" disabled={!online} onClick={() => setBackups(true)}>
            <Icon name="history" size={16} /> {t('settings.restore')}
          </button>
        </div>
      </Group>
      <Group title={t('settings.transfer')}>
        <p className="muted">{t('settings.transfer_info')}</p>
        <div className="row">
          <button type="button" onClick={exportVault}>
            <Icon name="download" size={16} /> {t('settings.export')}
          </button>
          {isMobile ? (
            <label className="button" onClick={() => allowExternal()}>
              <Icon name="upload" size={16} /> {t('settings.import')}
              <input type="file" hidden onChange={(e) => importPicked(e.target.files?.[0])} />
            </label>
          ) : (
            <button type="button" onClick={() => importVault()}>
              <Icon name="upload" size={16} /> {t('settings.import')}
            </button>
          )}
        </div>
      </Group>
      {!online && <div className="banner">{t('settings.offline_note')}</div>}
    </>
  )

  return (
    <Modal
      title={t('settings.title')}
      onClose={props.onClose}
      width={720}
      height={660}
      className="settings-dialog"
      footer={
        <button type="button" className="primary" onClick={props.onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="tabs" role="tablist">
        {TABS.map((key, index) => (
          <button key={key} type="button" role="tab" aria-selected={tab === index} className={`tab ${tab === index ? 'checked' : ''}`} onClick={() => setTab(index)}>
            {t(key)}
          </button>
        ))}
      </div>
      <div className="tab-panel">{[account, appearance, security, data][tab]}</div>
      {decoyDialog && <DecoyKeyDialog onSave={saveDecoy} onClose={() => setDecoyDialog(false)} />}
      {backups && <BackupDialog onClose={() => setBackups(false)} beforeRestore={props.flush} />}
    </Modal>
  )
}
