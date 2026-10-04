import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { groupChatId, parseChatId, type ContactView, type GroupView } from '../../../shared/model'
import { parseQr } from '../../../shared/qr'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { useApp } from '../context'
import { useData } from '../data'
import { AddContactDialog } from '../dialogs/AddContactDialog'
import { CreateGroupDialog } from '../dialogs/CreateGroupDialog'
import { GroupSettingsDialog } from '../dialogs/GroupSettingsDialog'
import { PromptDialog } from '../dialogs/PromptDialog'
import { ShareDialog, type SharedItem } from '../dialogs/ShareDialog'
import { VerifyContactDialog } from '../dialogs/VerifyContactDialog'
import { ChatTabs, type TabInfo } from '../fetch/ChatTabs'
import { ChatView } from '../fetch/ChatView'
import { ContactList } from '../fetch/ContactList'
import { RequestsPanel } from '../fetch/RequestsPanel'
import { Okfetch } from '../mobile/native'
import { isAndroid, useBack, usePhone } from '../mobile/phone'
import { toAvatarPng } from '../util/image'

type Dialog =
  | { name: 'add'; id?: string; contactName?: string }
  | { name: 'group' }
  | { name: 'group_settings'; group: GroupView }
  | { name: 'verify'; contact: ContactView }
  | { name: 'rename'; contact: ContactView }
  | { name: 'share'; item: SharedItem }

export function FetchPage({ visible }: { visible: boolean }) {
  const { t, confirm, notify } = useApp()
  const data = useData()
  const phone = usePhone()
  const [openChats, setOpenChats] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [draft, setDraft] = useState<{ chatId: string; text: string } | null>(null)
  const iconTarget = useRef<ContactView | null>(null)
  const iconInput = useRef<HTMLInputElement>(null)

  const openChat = useCallback(
    (chatId: string): void => {
      // The phone shows one chat at a time, full screen.
      setOpenChats((current) => (phone ? [chatId] : current.includes(chatId) ? current : [...current, chatId]))
      setActive(chatId)
    },
    [phone]
  )

  const closeActive = (): void => {
    setOpenChats([])
    setActive(null)
  }
  useBack(phone && visible && active !== null, closeActive)

  // The "?" button would cover the send button in a full-screen chat.
  const chatOnScreen = phone && visible && active !== null
  useEffect(() => {
    document.body.dataset.chatOpen = String(chatOnScreen)
  }, [chatOnScreen])

  // A notification click asks to open a chat.
  useEffect(() => {
    if (data.openChatRequest) {
      openChat(data.openChatRequest)
      data.clearOpenChatRequest()
    }
  }, [data.openChatRequest, data, openChat])

  // Android: what the app was opened for (notification, "Share to OKfetch", okfetch: link from a QR code).
  useEffect(() => {
    if (!isAndroid()) return
    const take = async (): Promise<void> => {
      const { items } = await Okfetch.takeLaunch().catch(() => ({ items: [] }))
      for (const item of items) {
        if (item.type === 'open-chat') openChat(item.chatId)
        else if (item.type === 'add-contact') {
          const qr = parseQr(item.text)
          if (qr) setDialog({ name: 'add', id: qr.id, contactName: qr.name })
          else notify(t('qr.invalid'), true)
        } else if (item.type === 'share') setDialog({ name: 'share', item })
      }
    }
    void take()
    let disposed = false
    let remove: (() => void) | undefined
    void Okfetch.addListener('launch', () => void take()).then((handle) => {
      // Cleaned up before the listener was in place: drop it right away.
      if (disposed) void handle.remove()
      else remove = () => void handle.remove()
    })
    return () => {
      disposed = true
      remove?.()
    }
  }, [openChat, notify, t])

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

  /** "Share to OKfetch": files become offers in the chosen chat, text waits in its composer. */
  const shareTo = async (chatId: string, item: SharedItem): Promise<void> => {
    setDialog(null)
    openChat(chatId)
    let failed = 0
    for (const file of item.files) {
      const result = await api.sendPrepared(chatId, file.path)
      if (!result.ok) failed++
    }
    if (failed) notify(t('share.failed', { n: failed }), true)
    if (item.text) setDraft({ chatId, text: item.text })
  }

  return (
    <div className={`page fetch-page ${visible ? '' : 'hidden'}`}>
      <div className={`split ${phone ? (active ? 'phone-chat' : 'phone-list') : ''}`}>
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
          {!phone && <ChatTabs tabs={tabs} active={active} onSelect={setActive} onClose={closeChat} onCloseAll={() => { setOpenChats([]); setActive(null) }} />}
          {openChats.length === 0 && <div className="empty muted">{t('chat.none_open')}</div>}
          {openChats.map((chatId) => (
            <div key={chatId} className={`chat-slot ${chatId === active ? '' : 'hidden'}`}>
              <ChatView
                chatId={chatId}
                active={visible && chatId === active}
                onBack={phone ? closeActive : undefined}
                draft={draft?.chatId === chatId ? draft.text : undefined}
                onDraftUsed={() => setDraft(null)}
              />
            </div>
          ))}
        </section>
      </div>
      <input ref={iconInput} type="file" accept="image/png,image/jpeg,image/x-icon,image/vnd.microsoft.icon,.ico" hidden onChange={(e) => { void onIconPicked(e.target.files?.[0]); e.target.value = '' }} />
      {dialog?.name === 'add' && <AddContactDialog initialId={dialog.id} initialName={dialog.contactName} canScan={isAndroid()} onClose={() => setDialog(null)} />}
      {dialog?.name === 'share' && (
        <ShareDialog item={dialog.item} contacts={data.contacts} groups={data.groups} onClose={() => setDialog(null)} onPick={(chatId) => void shareTo(chatId, dialog.item)} />
      )}
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
