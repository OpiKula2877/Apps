import { useEffect, useState, type ReactNode } from 'react'
import type { AccountInfo, Prefs, Quota, Settings, SortBy, StorageMode } from '../../../shared/ipc'
import { THUMB_MAX, THUMB_MIN } from '../../../shared/prefs'
import { COLOR_ROLES, FLAG_NAMES, PRESETS, lightness, resolveColors, resolveFlags, type FlagName } from '../../../shared/theme'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { useApp } from '../context'
import { formatSize } from '../i18n'

const THEMES: Settings['theme'][] = ['light', 'dark', 'opikula', 'custom']
const TABS = ['account', 'appearance', 'viewing', 'storage', 'data'] as const
const SORTS: SortBy[] = ['date', 'name', 'format', 'size']

interface Props {
  mode: StorageMode
  account: AccountInfo
  username: string
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

/** Sign out (Drive) or close the folder (local), asking first about changes not uploaded yet. */
export async function leaveLibrary(mode: StorageMode, confirm: ReturnType<typeof useApp>['confirm'], t: ReturnType<typeof useApp>['t']): Promise<void> {
  const ok = await confirm({
    title: t(mode === 'drive' ? 'settings.logout' : 'settings.close_library'),
    text: t(mode === 'drive' ? 'settings.logout_confirm' : 'settings.close_confirm'),
    confirmText: t(mode === 'drive' ? 'settings.logout' : 'settings.close_library'),
    danger: mode === 'drive'
  })
  if (!ok) return
  if ((await api.leave()) === 'pending') {
    const force = await confirm({ title: t('settings.logout'), text: t('logout.pending_confirm'), confirmText: t('settings.logout'), danger: true })
    if (force) await api.leave(true)
  }
}

export function SettingsDialog({ mode, account, username: initialName, onClose }: Props) {
  const { t, settings, updateSettings, confirm, notify } = useApp()
  const [tab, setTab] = useState<(typeof TABS)[number]>('account')
  const [username, setUsername] = useState(initialName)
  const [base, setBase] = useState<keyof typeof PRESETS>(settings.theme === 'custom' ? 'opikula' : settings.theme)
  const [quota, setQuota] = useState<Quota | null | undefined>(undefined)
  const [cache, setCache] = useState<number | null>(null)
  const size = (bytes: number): string => formatSize(bytes, settings.language)

  useEffect(() => {
    if (tab !== 'storage') return
    void api.quota().then(setQuota)
    void api.cacheSize().then(setCache)
  }, [tab])

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

  const saveName = (): void => {
    void api.mutate({ type: 'profile', username: username.trim() })
    notify(t('settings.username_saved'))
  }

  const leave = async (): Promise<void> => {
    onClose()
    await leaveLibrary(mode, confirm, t)
  }

  const switchFolder = async (): Promise<void> => {
    onClose()
    await api.openLocal(true)
  }

  const importSettings = async (): Promise<void> => {
    const result = await api.importSettings()
    if (result === 'invalid') notify(t('settings.import_invalid'), true)
  }

  const account_ = (
    <>
      {mode === 'drive' ? (
        <Group title={t('settings.google')}>
          <p>{account.email}</p>
          <p className="muted">{t('settings.drive_folder_info')}</p>
          <div>
            <button type="button" className="danger-outline" onClick={() => void leave()}>
              <Icon name="logout" size={16} /> {t('settings.logout')}
            </button>
          </div>
        </Group>
      ) : (
        <Group title={t('settings.local_folder')}>
          <p className="mono-path">{account.email}</p>
          <p className="muted">{t('settings.local_folder_info')}</p>
          <div className="row wrap">
            <button type="button" onClick={() => void switchFolder()}>
              <Icon name="folder" size={16} /> {t('settings.change_folder')}
            </button>
            <button type="button" onClick={() => void leave()}>
              <Icon name="logout" size={16} /> {t('settings.close_library')}
            </button>
          </div>
        </Group>
      )}
      <Group title={t('settings.username')}>
        <p className="muted">{t('settings.username_info')}</p>
        <div className="row">
          <input className="grow" value={username} maxLength={64} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveName()} />
          <button type="button" className="primary" onClick={saveName}>
            {t('common.save')}
          </button>
        </div>
      </Group>
      <Group title={t('settings.storage_kind')}>
        <p>{t(mode === 'drive' ? 'settings.storage_drive' : 'settings.storage_local')}</p>
        <p className="muted">{t('settings.storage_switch_info')}</p>
        <div>
          <button type="button" onClick={() => void leave()}>
            {t('settings.storage_switch')}
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
        <div className="form-row">
          <span>{t('settings.thumb_size')}</span>
          <div className="row">
            <input type="range" min={THUMB_MIN} max={THUMB_MAX} step={2} value={settings.thumb_size} onChange={(e) => void updateSettings({ thumb_size: Number(e.target.value) })} />
            <span className="muted">{settings.thumb_size} px</span>
          </div>
        </div>
        <div className="form-row">
          <span>{t('settings.view')}</span>
          <select value={settings.view} onChange={(e) => void updateSettings({ view: e.target.value as Prefs['view'] })}>
            <option value="grid">{t('media.view_grid')}</option>
            <option value="list">{t('media.view_list')}</option>
          </select>
        </div>
      </Group>
      <Group title={t('settings.theme')}>
        {THEMES.map((theme) => (
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
              <span>{t(`role.${role}`)}</span>
              <span className="swatch" style={{ background: colors[role], color: lightness(colors[role]) > 0.55 ? '#000000' : '#FFFFFF' }}>
                {colors[role]}
                <input type="color" value={colors[role].toLowerCase()} onChange={(e) => void setColor(role, e.target.value)} />
              </span>
            </label>
          ))}
        </div>
        <h3 className="subheading">{t('settings.elements')}</h3>
        {FLAG_NAMES.map((name) => (
          <label key={name} className="check">
            <input type="checkbox" checked={flags[name]} onChange={(e) => void setFlag(name, e.target.checked)} />
            {t(`flag.${name}`)}
          </label>
        ))}
      </fieldset>
    </>
  )

  const viewing = (
    <>
      <Group title={t('settings.sorting')}>
        <div className="form-row">
          <span>{t('settings.default_sort')}</span>
          <div className="row">
            <select value={settings.sort_by} onChange={(e) => void updateSettings({ sort_by: e.target.value as SortBy })}>
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </select>
            <select value={settings.sort_desc ? 'desc' : 'asc'} onChange={(e) => void updateSettings({ sort_desc: e.target.value === 'desc' })}>
              <option value="desc">{t('sort.desc')}</option>
              <option value="asc">{t('sort.asc')}</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <span>{t('album.sort')}</span>
          <select value={settings.album_sort} onChange={(e) => void updateSettings({ album_sort: e.target.value as Prefs['album_sort'] })}>
            <option value="manual">{t('album.sort_manual')}</option>
            <option value="name">{t('album.sort_name')}</option>
            <option value="date">{t('album.sort_date')}</option>
          </select>
        </div>
      </Group>
      <Group title={t('settings.viewer')}>
        <div className="form-row">
          <span>{t('settings.slideshow_seconds')}</span>
          <div className="row">
            <input className="number" type="number" min={1} max={60} value={settings.slideshow_seconds} onChange={(e) => void updateSettings({ slideshow_seconds: Number(e.target.value) })} />
            <span className="muted">s</span>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.video_autoplay} onChange={(e) => void updateSettings({ video_autoplay: e.target.checked })} />
          {t('settings.video_autoplay')}
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.video_loop} onChange={(e) => void updateSettings({ video_loop: e.target.checked })} />
          {t('settings.video_loop')}
        </label>
      </Group>
    </>
  )

  const usage =
    quota === undefined ? (
      <p className="muted">{t('settings.usage_loading')}</p>
    ) : quota === null ? (
      <p className="muted">{t('settings.usage_unknown')}</p>
    ) : (
      <>
        {quota.limit ? (
          <>
            <div className="progress big">
              <div className="progress-fill" style={{ width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` }} />
            </div>
            <p>{t(mode === 'drive' ? 'settings.usage_drive' : 'settings.usage_disk', { used: size(quota.used), limit: size(quota.limit), free: size(quota.limit - quota.used) })}</p>
          </>
        ) : (
          <p>{t('settings.usage_unlimited', { used: size(quota.used) })}</p>
        )}
        <p className="muted">{t('settings.usage_library', { size: size(quota.library) })}</p>
      </>
    )

  const storage = (
    <>
      <Group title={t(mode === 'drive' ? 'settings.usage_title_drive' : 'settings.usage_title_disk')}>{usage}</Group>
      <Group title={t('settings.download_folder')}>
        <p className={settings.download_folder ? 'mono-path' : 'muted'}>{settings.download_folder ?? t('settings.download_ask')}</p>
        <div className="row wrap">
          <button type="button" onClick={() => void api.pickDownloadFolder()}>
            <Icon name="folder" size={16} /> {t('settings.download_choose')}
          </button>
          {settings.download_folder && (
            <button type="button" onClick={() => void updateSettings({ download_folder: null })}>
              {t('settings.download_reset')}
            </button>
          )}
        </div>
      </Group>
      <Group title={t('settings.sync')}>
        <p className="muted">{t(mode === 'drive' ? 'settings.sync_info_drive' : 'settings.sync_info_local')}</p>
        <div className="row">
          <input className="number" type="number" min={0} max={120} value={settings.sync_minutes} onChange={(e) => void updateSettings({ sync_minutes: Number(e.target.value) })} />
          <span className="muted">{settings.sync_minutes === 0 ? t('settings.sync_off') : 'min'}</span>
          <div className="grow" />
          <button type="button" onClick={() => void api.refresh()}>
            <Icon name="refresh" size={16} /> {t('settings.sync_now')}
          </button>
        </div>
      </Group>
      <Group title={t('settings.cache')}>
        <p className="muted">{t('settings.cache_info')}</p>
        <div className="row">
          <span>{cache === null ? '…' : size(cache)}</span>
          <div className="grow" />
          <button
            type="button"
            onClick={async () => {
              await api.clearCache()
              setCache(await api.cacheSize())
            }}
          >
            <Icon name="trash" size={16} /> {t('settings.cache_clear')}
          </button>
        </div>
      </Group>
    </>
  )

  const data = (
    <>
      <Group title={t('settings.transfer')}>
        <p className="muted">{t('settings.transfer_info')}</p>
        <div className="row">
          <button type="button" onClick={() => void api.exportSettings()}>
            <Icon name="download" size={16} /> {t('settings.export')}
          </button>
          <button type="button" onClick={() => void importSettings()}>
            <Icon name="upload" size={16} /> {t('settings.import')}
          </button>
        </div>
      </Group>
      <Group title={t('settings.logs')}>
        <p className="muted">{t('settings.logs_info')}</p>
        <div>
          <button type="button" onClick={() => void api.openLogs()}>
            <Icon name="file" size={16} /> {t('settings.logs_open')}
          </button>
        </div>
      </Group>
    </>
  )

  const panels = { account: account_, appearance, viewing, storage, data }

  return (
    <Modal
      title={t('settings.title')}
      onClose={onClose}
      width={760}
      height={680}
      className="settings-dialog"
      footer={
        <button type="button" className="primary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="tabs" role="tablist">
        {TABS.map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab ${tab === key ? 'checked' : ''}`} onClick={() => setTab(key)}>
            {t(`settings.tab.${key}`)}
          </button>
        ))}
      </div>
      <div className="tab-panel">{panels[tab]}</div>
    </Modal>
  )
}
