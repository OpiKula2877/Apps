import { useEffect, useState } from 'react'
import type { BackupItem } from '../../../shared/ipc'
import { api } from '../api'
import { Modal } from '../components/Modal'
import { useApp } from '../context'

const formatBackup = (item: BackupItem): string => {
  const d = new Date(item.created)
  if (Number.isNaN(d.getTime())) return item.name
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

export function BackupDialog({ onClose, beforeRestore }: { onClose: () => void; beforeRestore: () => Promise<void> }) {
  const { t, confirm } = useApp()
  const [items, setItems] = useState<BackupItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .listBackups()
      .then((list) => alive && setItems(list))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  const label = (item: BackupItem): string => formatBackup(item) + (item.name.includes('conflict') ? `  (${t('backups.conflict')})` : '')

  const restore = async (): Promise<void> => {
    const item = items?.find((i) => i.id === selected)
    if (!item) return
    const ok = await confirm({ title: t('backups.restore'), text: t('backups.restore_confirm', { name: label(item) }), confirmText: t('backups.restore'), danger: true })
    if (!ok) return
    onClose()
    await beforeRestore()
    await api.restoreBackup(item.id)
  }

  const status = failed ? t('backups.failed') : items === null ? t('backups.loading') : items.length ? t('backups.count', { count: items.length }) : t('backups.none')

  return (
    <Modal
      title={t('backups.title')}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="button" className="primary" disabled={!selected} onClick={restore}>
            {t('backups.restore')}
          </button>
        </>
      }
    >
      <p className="muted">{t('backups.info')}</p>
      <ul className="list backup-list" role="listbox">
        {(items ?? []).map((item) => (
          <li key={item.id} role="option" aria-selected={item.id === selected} className={item.id === selected ? 'selected' : ''} onClick={() => setSelected(item.id)}>
            {label(item)}
          </li>
        ))}
      </ul>
      <p className="muted">{status}</p>
    </Modal>
  )
}
