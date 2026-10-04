import { contactChatId, groupChatId, type ContactView, type GroupView } from '../../../shared/model'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { useApp } from '../context'
import { formatSize } from '../util/format'

export interface SharedItem {
  text?: string
  files: { path: string; name: string; size: number }[]
}

interface Props {
  item: SharedItem
  contacts: ContactView[]
  groups: GroupView[]
  onPick: (chatId: string) => void
  onClose: () => void
}

/** "Share to OKfetch": choose the chat. Files go only to chats with a contact (groups carry messages only). */
export function ShareDialog({ item, contacts, groups, onPick, onClose }: Props) {
  const { t } = useApp()
  const hasFiles = item.files.length > 0
  const people = contacts.filter((c) => !c.blocked)
  const activeGroups = hasFiles ? [] : groups.filter((g) => g.state === 'active')

  return (
    <Modal
      title={t('share.title')}
      onClose={onClose}
      className="share-dialog"
      footer={
        <button type="button" onClick={onClose}>
          {t('common.cancel')}
        </button>
      }
    >
      <div className="share-what muted">
        {item.files.map((file) => (
          <div key={file.path} className="row">
            <Icon name="file" size={16} /> <span className="grow ellipsis">{file.name}</span> {formatSize(file.size)}
          </div>
        ))}
        {item.text && <div className="share-text">„{item.text.length > 140 ? `${item.text.slice(0, 140)}…` : item.text}“</div>}
      </div>
      {hasFiles && <p className="muted">{t('share.files_only_contacts')}</p>}
      {people.length === 0 && activeGroups.length === 0 && <p className="muted">{t('share.no_chats')}</p>}
      <div className="share-list">
        {people.map((contact) => (
          <div key={contact.pub} className="share-contact">
            <div className="contact-head">
              <Avatar name={contact.name} src={contact.avatar} online={contact.online} />
              <span className="item-title grow">{contact.name}</span>
            </div>
            <div className="row">
              <button type="button" className="grow" onClick={() => onPick(contactChatId(contact.pub, 'enc'))}>
                <Icon name="lock" size={14} /> {t('contact.chat_enc')}
              </button>
              <button type="button" className="grow" onClick={() => onPick(contactChatId(contact.pub, 'plain'))}>
                <Icon name="unlock" size={14} /> {t('contact.chat_plain')}
              </button>
            </div>
          </div>
        ))}
        {activeGroups.map((group) => (
          <button key={group.id} type="button" className="share-group" onClick={() => onPick(groupChatId(group.id))}>
            <Avatar name={group.name} group size={34} />
            <span className="item-title grow">
              {group.type === 'enc' && <Icon name="lock" size={13} />} {group.name}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
