import { useEffect, useMemo, useRef, useState } from 'react'
import { groupChatId, parseChatId, type ContactView, type GroupView } from '../../../shared/model'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { useApp } from '../context'
import { useData } from '../data'
import { AddContactDialog } from '../dialogs/AddContactDialog'
import { CreateGroupDialog } from '../dialogs/CreateGroupDialog'
import { GroupSettingsDialog } from '../dialogs/GroupSettingsDialog'
import { PromptDialog } from '../dialogs/PromptDialog'
import { VerifyContactDialog } from '../dialogs/VerifyContactDialog'
import { ChatTabs, type TabInfo } from '../fetch/ChatTabs'
import { ChatView } from '../fetch/ChatView'
import { ContactList } from '../fetch/ContactList'
import { RequestsPanel } from '../fetch/RequestsPanel'
import { toAvatarPng } from '../util/image'

type Dialog =
  | { name: 'add' }
  | { name: 'group' }
  | { name: 'group_settings'; group: GroupView }
  | { name: 'verify'; contact: ContactView }
  | { name: 'rename'; contact: ContactView }

export function FetchPage({ visible }: { visible: boolean }) {
  const { t, confirm, notify } = useApp()
  const data = useData()
  const [openChats, setOpenChats] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const iconTarget = useRef<ContactView | null>(null)
  const iconInput = useRef<HTMLInputElement>(null)

  const openChat = (chatId: string): void => {
    setOpenChats((current) => (current.includes(chatId) ? current : [...current, chatId]))
    setActive(chatId)
  }

  // A notification click asks to open a chat.
  useEffect(() => {
    if (data.openChatRequest) {
      openChat(data.openChatRequest)
      data.clearOpenChatRequest()
    }
  }, [data.openChatRequest, data])

  // Tabs of contacts or groups that no longer exist are closed.
  useEffect(() => {
    if (data.contacts.length === 0 && data.groups.length === 0 && openChats.length === 0) return
    const exists = (chatId: string): boolean => {
      const parsed = parseChatId(chatId)
      if (!parsed) return false
      if (parsed.type === 'contact') return data.contacts.some((c) => c.pub === parsed.pub && !c.blocked)
      return data.groups.some((g) => g.id === parsed.id && g.state === 'active')
    }
    const remaining = openChats.filter(exists)
    if (remaining.length !== openChats.length) {
      setOpenChats(remaining)
      setActive((current) => (current && remaining.includes(current) ? current : (remaining[remaining.length - 1] ?? null)))
    }
  }, [data.contacts, data.groups, openChats])

  const tabs = useMemo<TabInfo[]>(
    () =>
      openChats.map((chatId) => {
        const parsed = parseChatId(chatId)
        if (parsed?.type === 'contact') {
          const contact = data.contacts.find((c) => c.pub === parsed.pub)
          return { chatId, title: contact?.name ?? '…', encrypted: parsed.kind === 'enc', unread: contact?.unread[parsed.kind] ?? 0 }
        }
        const group = data.groups.find((g) => parsed?.type === 'group' && g.id === parsed.id)
        return { chatId, title: group?.name ?? '…', encrypted: group?.type === 'enc', unread: group?.unread ?? 0 }
      }),
    [openChats, data.contacts, data.groups]
  )

  const closeChat = (chatId: string): void => {
    const index = openChats.indexOf(chatId)
    const remaining = openChats.filter((id) => id !== chatId)
    setOpenChats(remaining)
    if (active === chatId) setActive(remaining[Math.min(index, remaining.length - 1)] ?? null)
  }

  const pickIcon = (contact: ContactView): void => {
    iconTarget.current = contact
    iconInput.current?.click()
  }
  const onIconPicked = async (file: File | undefined): Promise<void> => {
    const contact = iconTarget.current
    if (!file || !contact) return
    try {
      await api.setContactIcon(contact.pub, await toAvatarPng(file))
    } catch {
      notify(t('settings.avatar_failed'), true)
    }
  }

  const block = async (contact: ContactView): Promise<void> => {
    const ok = await confirm({ title: t('contact.block'), text: t('contact.block_text', { name: contact.name }), confirmText: t('contact.block'), danger: true })
    if (ok) void api.blockPeer(contact.pub, contact.name)
  }
  const remove = async (contact: ContactView): Promise<void> => {
    const ok = await confirm({ title: t('contact.remove'), text: t('contact.remove_text', { name: contact.name }), confirmText: t('contact.remove'), danger: true })
    if (ok) void api.removeContact(contact.pub)
  }
  const leave = async (group: GroupView): Promise<void> => {
    const ok = await confirm({ title: t('group.leave'), text: t('group.leave_text', { name: group.name }), confirmText: t('group.leave'), danger: true })
    if (ok) void api.leaveGroup(group.id)
  }

  return (
    <div className={`page fetch-page ${visible ? '' : 'hidden'}`}>
      <div className="split">
        <aside className="side">
          <div className="row">
            <button type="button" className="primary grow" onClick={() => setDialog({ name: 'add' })}>
              <Icon name="user_plus" size={16} /> {t('list.add_contact')}
            </button>
            <button type="button" className="grow" onClick={() => setDialog({ name: 'group' })}>
              <Icon name="users" size={16} /> {t('list.new_group')}
            </button>
          </div>
          <div className="search">
            <Icon name="search" size={16} />
            <input type="search" value={query} placeholder={t('list.search')} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="side-scroll">
            <RequestsPanel />
            <ContactList
              contacts={data.contacts}
              groups={data.groups}
              query={query}
              activeChat={active}
              onOpen={openChat}
              onRename={(contact) => setDialog({ name: 'rename', contact })}
              onIcon={pickIcon}
              onIconRemove={(contact) => void api.setContactIcon(contact.pub, null)}
              onVerify={(contact) => setDialog({ name: 'verify', contact })}
              onBlock={(contact) => void block(contact)}
              onUnblock={(contact) => void api.unblockPeer(contact.pub)}
              onRemove={(contact) => void remove(contact)}
              onGroupSettings={(group) => setDialog({ name: 'group_settings', group })}
              onLeaveGroup={(group) => void leave(group)}
            />
          </div>
        </aside>
        <section className="main-panel chat-panel">
          <ChatTabs tabs={tabs} active={active} onSelect={setActive} onClose={closeChat} onCloseAll={() => { setOpenChats([]); setActive(null) }} />
          {openChats.length === 0 && <div className="empty muted">{t('chat.none_open')}</div>}
          {openChats.map((chatId) => (
            <div key={chatId} className={`chat-slot ${chatId === active ? '' : 'hidden'}`}>
              <ChatView chatId={chatId} active={visible && chatId === active} />
            </div>
          ))}
        </section>
      </div>
      <input ref={iconInput} type="file" accept="image/png,image/jpeg,image/x-icon,image/vnd.microsoft.icon,.ico" hidden onChange={(e) => { void onIconPicked(e.target.files?.[0]); e.target.value = '' }} />
      {dialog?.name === 'add' && <AddContactDialog onClose={() => setDialog(null)} />}
      {dialog?.name === 'group' && (
        <CreateGroupDialog
          contacts={data.contacts}
          onClose={() => setDialog(null)}
          onCreated={(id) => {
            setDialog(null)
            openChat(groupChatId(id))
          }}
        />
      )}
      {dialog?.name === 'group_settings' && <GroupSettingsDialog group={data.groups.find((g) => g.id === dialog.group.id) ?? dialog.group} contacts={data.contacts} onClose={() => setDialog(null)} />}
      {dialog?.name === 'verify' && <VerifyContactDialog contact={dialog.contact} onClose={() => setDialog(null)} />}
      {dialog?.name === 'rename' && (
        <PromptDialog
          title={t('contact.rename')}
          label={t('contact.rename_label')}
          initial={dialog.contact.name}
          onClose={() => setDialog(null)}
          onConfirm={(name) => {
            void api.renameContact(dialog.contact.pub, name)
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}

