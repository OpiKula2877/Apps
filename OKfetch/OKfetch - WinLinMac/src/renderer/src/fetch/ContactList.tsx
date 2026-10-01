import { useState } from 'react'
import { contactChatId, groupChatId, type ChatKind, type ContactView, type GroupView } from '../../../shared/model'
import { Avatar } from '../components/Avatar'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { Icon } from '../components/Icon'
import { useApp } from '../context'

interface Props {
  contacts: ContactView[]
  groups: GroupView[]
  query: string
  activeChat: string | null
  onOpen: (chatId: string) => void
  onRename: (contact: ContactView) => void
  onIcon: (contact: ContactView) => void
  onIconRemove: (contact: ContactView) => void
  onVerify: (contact: ContactView) => void
  onBlock: (contact: ContactView) => void
  onUnblock: (contact: ContactView) => void
  onRemove: (contact: ContactView) => void
  onGroupSettings: (group: GroupView) => void
  onLeaveGroup: (group: GroupView) => void
}

interface Menu {
  x: number
  y: number
  items: MenuItem[]
}

export function ContactList(props: Props) {
  const { t } = useApp()
  const [menu, setMenu] = useState<Menu | null>(null)
  const needle = props.query.trim().toLocaleLowerCase()
  const contacts = props.contacts
    .filter((c) => !needle || `${c.name} ${c.username}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
  const groups = props.groups.filter((g) => g.state === 'active' && (!needle || g.name.toLocaleLowerCase().includes(needle)))

  const contactMenu = (event: React.MouseEvent, contact: ContactView): void => {
    event.preventDefault()
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: t('contact.rename'), onSelect: () => props.onRename(contact) },
        { label: t('contact.icon'), onSelect: () => props.onIcon(contact) },
        { label: t('contact.icon_remove'), onSelect: () => props.onIconRemove(contact) },
        { label: t('contact.verify'), onSelect: () => props.onVerify(contact) },
        contact.blocked ? { label: t('contact.unblock'), onSelect: () => props.onUnblock(contact), separatorBefore: true } : { label: t('contact.block'), onSelect: () => props.onBlock(contact), separatorBefore: true },
        { label: t('contact.remove'), onSelect: () => props.onRemove(contact), danger: true }
      ]
    })
  }

  const kindRow = (contact: ContactView, kind: ChatKind) => {
    const chatId = contactChatId(contact.pub, kind)
    const unread = contact.unread[kind]
    return (
      <button key={kind} type="button" className={`kind-row ${props.activeChat === chatId ? 'selected' : ''}`} onClick={() => props.onOpen(chatId)}>
        <Icon name={kind === 'enc' ? 'lock' : 'unlock'} size={13} />
        <span className="grow">{t(kind === 'enc' ? 'contact.chat_enc' : 'contact.chat_plain')}</span>
        {unread > 0 && <span className="badge">{unread}</span>}
      </button>
    )
  }

  return (
    <div className="contact-list">
      <div className="section-title muted">{t('list.contacts')}</div>
      {contacts.length === 0 && <div className="empty-hint muted">{t(needle ? 'list.no_match' : 'list.no_contacts')}</div>}
      {contacts.map((contact) => (
        <div key={contact.pub} className={`contact ${contact.blocked ? 'blocked' : ''}`} onContextMenu={(e) => contactMenu(e, contact)}>
          <div className="contact-head">
            <Avatar name={contact.name} src={contact.avatar} online={contact.online} />
            <div className="contact-names">
              <div className="item-title">
                {contact.name}
                {contact.verified && <span className="verified" title={t('contact.verified')}><Icon name="shield" size={13} /></span>}
              </div>
              <div className="item-sub">{contact.blocked ? t('contact.blocked') : t(contact.online ? 'status.online' : 'status.offline')}</div>
            </div>
          </div>
          {!contact.blocked && (
            <div className="kind-rows">
              {kindRow(contact, 'enc')}
              {kindRow(contact, 'plain')}
            </div>
          )}
        </div>
      ))}
      <div className="section-title muted">{t('list.groups')}</div>
      {groups.length === 0 && <div className="empty-hint muted">{t(needle ? 'list.no_match' : 'list.no_groups')}</div>}
      {groups.map((group) => {
        const chatId = groupChatId(group.id)
        return (
          <div
            key={group.id}
            className={`contact group-row ${props.activeChat === chatId ? 'selected' : ''}`}
            onClick={() => props.onOpen(chatId)}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({
                x: event.clientX,
                y: event.clientY,
                items: [
                  { label: t('group.settings'), onSelect: () => props.onGroupSettings(group) },
                  { label: t('group.leave'), onSelect: () => props.onLeaveGroup(group), danger: true, separatorBefore: true }
                ]
              })
            }}
          >
            <div className="contact-head">
              <Avatar name={group.name} group size={34} />
              <div className="contact-names">
                <div className="item-title">
                  {group.type === 'enc' && <Icon name="lock" size={13} />} {group.name}
                </div>
                <div className="item-sub">{t('group.members_online', { online: group.members.filter((m) => m.online).length, total: group.members.length })}</div>
              </div>
              {group.unread > 0 && <span className="badge">{group.unread}</span>}
            </div>
          </div>
        )
      })}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}
