import { useApp } from '../context'

interface Props {
  count: number
  /** False when the selection contains a message written by the other side. */
  canDeleteBoth: boolean
  onDeleteMe: () => void
  onDeleteBoth: () => void
  onCancel: () => void
}

export function SelectionBar({ count, canDeleteBoth, onDeleteMe, onDeleteBoth, onCancel }: Props) {
  const { t } = useApp()
  return (
    <div className="selection-bar">
      <span className="grow">{t('chat.selected', { n: count })}</span>
      <button type="button" disabled={count === 0} onClick={onDeleteMe}>
        {t('chat.delete_me')}
      </button>
      <button type="button" className="danger-outline" disabled={count === 0 || !canDeleteBoth} title={canDeleteBoth ? '' : t('chat.delete_both_locked')} onClick={onDeleteBoth}>
        {t('chat.delete_both')}
      </button>
      <button type="button" onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </div>
  )
}
