import { useState } from 'react'
import type { ContactView, GroupView } from '../../../shared/model'
import { api } from '../api'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { useApp } from '../context'

/** Anyone in the group may rename it or add contacts; the last change wins. */
export function GroupSettingsDialog({ group, contacts, onClose }: { group: GroupView; contacts: ContactView[]; onClose: () => void }) {
  const { t, notify } = useApp()
  const [name, setName] = useState(group.name)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const candidates = contacts.filter((c) => !c.blocked && !group.members.some((m) => m.pub === c.pub))

  const toggle = (pub: string): void =>
    setAdded((current) => {
      const next = new Set(current)
      if (!next.delete(pub)) next.add(pub)
      return next
    })

  const save = async (): Promise<void> => {
    const ok = await api.updateGroup(group.id, { name: name.trim() !== group.name ? name : undefined, add: [...added] })
    if (ok) onClose()
    else notify(t('group.update_failed'), true)
  }

  return (
    <Modal
      title={t('group.settings')}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" disabled={!name.trim()} onClick={() => void save()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <label className="field-label">{t('group.name')}</label>
      <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} data-autofocus />
      <p className="muted">
        <Icon name={group.type === 'enc' ? 'lock' : 'unlock'} size={13} /> {t(group.type === 'enc' ? 'group.type_enc' : 'group.type_plain')}
      </p>
      <label className="field-label">{t('group.members')}</label>
      <div className="pick-list">
        {group.members.map((member) => (
          <div key={member.pub} className="pick-row">
            <Avatar name={member.name} online={member.online} size={26} />
            <span className="grow">{member.name}</span>
            {member.me && <span className="muted">{t('group.me')}</span>}
          </div>
        ))}
      </div>
      {candidates.length > 0 && (
        <>
          <label className="field-label">{t('group.add_members')}</label>
          <div className="pick-list">
            {candidates.map((contact) => (
              <label key={contact.pub} className="check pick-row">
                <input type="checkbox" checked={added.has(contact.pub)} onChange={() => toggle(contact.pub)} />
                <Avatar name={contact.name} src={contact.avatar} online={contact.online} size={26} />
                <span>{contact.name}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
