import { useState } from 'react'
import type { ChatKind, ContactView } from '../../../shared/model'
import { api } from '../api'
import { Avatar } from '../components/Avatar'
import { Modal } from '../components/Modal'
import { useApp } from '../context'

export function CreateGroupDialog({ contacts, onCreated, onClose }: { contacts: ContactView[]; onCreated: (id: string) => void; onClose: () => void }) {
  const { t, notify } = useApp()
  const [name, setName] = useState('')
  const [type, setType] = useState<ChatKind>('enc')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const candidates = contacts.filter((c) => !c.blocked)

  const toggle = (pub: string): void =>
    setChosen((current) => {
      const next = new Set(current)
      if (!next.delete(pub)) next.add(pub)
      return next
    })

  const create = async (): Promise<void> => {
    const id = await api.createGroup(name, type, [...chosen])
    if (id) onCreated(id)
    else notify(t('group.create_failed'), true)
  }

  return (
    <Modal
      title={t('group.create')}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" disabled={!name.trim() || chosen.size === 0} onClick={() => void create()}>
            {t('group.create_button')}
          </button>
        </>
      }
    >
      <label className="field-label">{t('group.name')}</label>
      <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} data-autofocus />
      <label className="field-label">{t('group.type')}</label>
      <label className="check">
        <input type="radio" name="group-type" checked={type === 'enc'} onChange={() => setType('enc')} />
        {t('group.type_enc')}
      </label>
      <label className="check">
        <input type="radio" name="group-type" checked={type === 'plain'} onChange={() => setType('plain')} />
        {t('group.type_plain')}
      </label>
      <label className="field-label">{t('group.members')}</label>
      <div className="pick-list">
        {candidates.length === 0 && <div className="muted empty-hint">{t('group.no_contacts')}</div>}
        {candidates.map((contact) => (
          <label key={contact.pub} className="check pick-row">
            <input type="checkbox" checked={chosen.has(contact.pub)} onChange={() => toggle(contact.pub)} />
            <Avatar name={contact.name} src={contact.avatar} online={contact.online} size={26} />
            <span>{contact.name}</span>
          </label>
        ))}
      </div>
    </Modal>
  )
}
