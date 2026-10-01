// Live data of the Fetch page (contacts, groups, requests, presence) kept in sync through core events.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Requests, UiEvent } from '../../shared/ipc'
import type { ContactView, GroupView, NetStatus, ProfileView, TransferProgress } from '../../shared/model'
import { api } from './api'

const TYPING_MS = 5000

export interface FetchData {
  profile: ProfileView | null
  contacts: ContactView[]
  groups: GroupView[]
  requests: Requests
  net: NetStatus
  /** Chat ids where the other side is typing right now. */
  typingChats: ReadonlySet<string>
  /** Number of things that need an answer: incoming requests and group invitations. */
  pendingCount: number
  /** Run `listener` when messages of this chat change. */
  onChat(chatId: string, listener: () => void): () => void
  onTransfer(listener: (progress: TransferProgress) => void): () => void
  /** Chat the main process asked to open (notification click). */
  openChatRequest: string | null
  clearOpenChatRequest(): void
}

const EMPTY_REQUESTS: Requests = { incoming: [], outgoing: [], invites: [] }
const DataContext = createContext<FetchData | null>(null)

export function useData(): FetchData {
  const data = useContext(DataContext)
  if (!data) throw new Error('DataContext missing')
  return data
}

export function DataProvider({ children, onIncoming }: { children: ReactNode; onIncoming?: (event: Extract<UiEvent, { type: 'incoming' | 'request' }>) => void }) {
  const [profile, setProfile] = useState<ProfileView | null>(null)
  const [contacts, setContacts] = useState<ContactView[]>([])
  const [groups, setGroups] = useState<GroupView[]>([])
  const [requests, setRequests] = useState<Requests>(EMPTY_REQUESTS)
  const [net, setNet] = useState<NetStatus>('connecting')
  const [typing, setTyping] = useState<Record<string, number>>({})
  const [openChatRequest, setOpenChatRequest] = useState<string | null>(null)
  const chatListeners = useRef(new Map<string, Set<() => void>>())
  const transferListeners = useRef(new Set<(progress: TransferProgress) => void>())
  const incoming = useRef(onIncoming)
  incoming.current = onIncoming

  const loadContacts = useCallback(() => void api.listContacts().then(setContacts), [])
  const loadGroups = useCallback(() => void api.listGroups().then(setGroups), [])
  const loadRequests = useCallback(() => void api.listRequests().then(setRequests), [])
  const loadProfile = useCallback(() => void api.getProfile().then(setProfile), [])

  useEffect(() => {
    loadContacts()
    loadGroups()
    loadRequests()
    loadProfile()
    void api.getNetStatus().then(setNet)
    return api.onEvent((event) => {
      switch (event.type) {
        case 'contacts':
          loadContacts()
          break
        case 'groups':
          loadGroups()
          loadRequests()
          break
        case 'requests':
          loadRequests()
          loadGroups()
          break
        case 'profile':
          loadProfile()
          break
        case 'net':
          setNet(event.status)
          break
        case 'chat':
          chatListeners.current.get(event.chatId)?.forEach((listener) => listener())
          // A new message ends "is typing…" (the other side sends it again while still typing).
          setTyping((current) => {
            if (!(event.chatId in current)) return current
            const { [event.chatId]: _gone, ...rest } = current
            return rest
          })
          break
        case 'transfer':
          transferListeners.current.forEach((listener) => listener(event.progress))
          break
        case 'typing':
          setTyping((current) => ({ ...current, [event.chatId]: Date.now() + TYPING_MS }))
          break
        case 'open-chat':
          setOpenChatRequest(event.chatId)
          break
        case 'incoming':
        case 'request':
          incoming.current?.(event)
          break
        default:
          break
      }
    })
  }, [loadContacts, loadGroups, loadRequests, loadProfile])

  // Expire "typing…" indicators.
  const hasTyping = Object.keys(typing).length > 0
  useEffect(() => {
    if (!hasTyping) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      setTyping((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([, until]) => until > now))
        return Object.keys(next).length === Object.keys(current).length ? current : next
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [hasTyping])

  const onChat = useCallback((chatId: string, listener: () => void) => {
    const set = chatListeners.current.get(chatId) ?? new Set()
    set.add(listener)
    chatListeners.current.set(chatId, set)
    return () => {
      set.delete(listener)
    }
  }, [])
  const onTransfer = useCallback((listener: (progress: TransferProgress) => void) => {
    transferListeners.current.add(listener)
    return () => {
      transferListeners.current.delete(listener)
    }
  }, [])

  const value = useMemo<FetchData>(
    () => ({
      profile,
      contacts,
      groups,
      requests,
      net,
      typingChats: new Set(Object.keys(typing)),
      pendingCount: requests.incoming.length + requests.invites.length,
      onChat,
      onTransfer,
      openChatRequest,
      clearOpenChatRequest: () => setOpenChatRequest(null)
    }),
    [profile, contacts, groups, requests, net, typing, onChat, onTransfer, openChatRequest]
  )
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
