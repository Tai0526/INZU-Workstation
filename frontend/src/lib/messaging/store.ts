import { useSyncExternalStore } from 'react'
import { ROLES, type RoleKey } from '@/lib/roles'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * In-app messaging between USER ACCOUNTS. The directory lists the real users on
 * the system (created in Admin → Users); each conversation is between two user
 * ids and the UI shows the other person's role + branch. Messages carry text
 * and/or attachments (images shown inline, other files as chips). Files live in
 * the IndexedDB file store; only metadata is persisted here.
 */

export interface Attachment {
  file_id: string
  file_name: string
  mime: string
  size: number
  kind: 'image' | 'file'
}
export interface Message {
  id: string
  conversationId: string
  fromUserId: string
  text: string
  attachments: Attachment[]
  at: string // ISO
}
export interface Conversation {
  id: string // sorted pair of user ids
  participants: [string, string]
}

export const roleName = (r: RoleKey): string => ROLES[r]?.label ?? r
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}
/** Stable conversation id for a pair of user ids (order-independent). */
export function convId(a: string, b: string): string {
  return [a, b].sort().join('__')
}
function mkConv(a: string, b: string): Conversation {
  const [x, y] = [a, b].sort() as [string, string]
  return { id: `${x}__${y}`, participants: [x, y] }
}
export function otherParticipant(c: Conversation, me: string): string {
  return c.participants[0] === me ? c.participants[1] : c.participants[0]
}

interface State {
  conversations: Conversation[]
  messages: Message[]
  lastRead: Record<string, string> // `${convId}|${userId}` -> ISO
}

const KEY = 'inzu_messages'
const EMPTY: State = { conversations: [], messages: [], lastRead: {} }

// One combined blob (conversations + messages + lastRead). coerce() repairs the
// shape on load (and drops legacy role-based data), so it doubles as the merge.
const cfg = createSyncConfig<State>({ key: 'messaging', lsKey: KEY, default: EMPTY, merge: (saved) => coerce(saved) })
const load = (): State => cfg.get()
const commit = (next: State) => cfg.set(next)

/**
 * Repair persisted data into the current user-id-based shape. Older builds keyed
 * messaging by ROLE (fromRole + role-pair conversation ids); that can't be mapped
 * to specific accounts, so legacy data is dropped and messaging starts clean.
 * Also normalises a missing `attachments` to [] so a stray record can't crash.
 */
function coerce(parsed: any): State {
  if (!parsed || !Array.isArray(parsed.conversations) || !Array.isArray(parsed.messages) || typeof parsed.lastRead !== 'object' || parsed.lastRead === null) {
    return EMPTY
  }
  // Legacy role-based data (no user ids) → wipe and start fresh.
  if (parsed.messages.some((m: any) => m && m.fromRole && !m.fromUserId)) return EMPTY
  const conversations: Conversation[] = parsed.conversations.filter(
    (c: any) => c && typeof c.id === 'string' && Array.isArray(c.participants) && c.participants.length === 2 && c.participants.every((p: any) => typeof p === 'string'),
  )
  const ids = new Set(conversations.map((c) => c.id))
  const messages: Message[] = parsed.messages
    .filter((m: any) => m && typeof m.fromUserId === 'string' && ids.has(m.conversationId))
    .map((m: any) => ({
      id: String(m.id), conversationId: m.conversationId, fromUserId: m.fromUserId,
      text: typeof m.text === 'string' ? m.text : '',
      attachments: Array.isArray(m.attachments) ? m.attachments : [],
      at: m.at ?? new Date().toISOString(),
    }))
  return { conversations, messages, lastRead: parsed.lastRead }
}

function newId(p: string): string {
  return `${p}_${Date.now()}_${Math.round(Math.random() * 1e5)}`
}

export const messagingStore = {
  state: (): State => load(),

  ensureConversation(me: string, other: string): string {
    const s = load()
    const id = convId(me, other)
    if (!s.conversations.some((c) => c.id === id)) commit({ ...s, conversations: [...s.conversations, mkConv(me, other)] })
    return id
  },

  send(me: string, other: string, text: string, attachments: Attachment[] = []) {
    const t = text.trim()
    if (!t && attachments.length === 0) return
    const s = load()
    const id = convId(me, other)
    const conversations = s.conversations.some((c) => c.id === id) ? s.conversations : [...s.conversations, mkConv(me, other)]
    const msg: Message = { id: newId('m'), conversationId: id, fromUserId: me, text: t, attachments, at: new Date().toISOString() }
    commit({ ...s, conversations, messages: [...s.messages, msg], lastRead: { ...s.lastRead, [`${id}|${me}`]: msg.at } })
  },

  markRead(conversationId: string, me: string) {
    const s = load()
    commit({ ...s, lastRead: { ...s.lastRead, [`${conversationId}|${me}`]: new Date().toISOString() } })
  },
}

export function useMessaging(): State {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}

export function conversationsFor(s: State, me: string): Conversation[] {
  return s.conversations.filter((c) => c.participants.includes(me))
}
/** Unread = messages from the other side newer than my last read. */
export function unreadCount(s: State, conversationId: string, me: string): number {
  const last = s.lastRead[`${conversationId}|${me}`]
  return s.messages.filter((m) => m.conversationId === conversationId && m.fromUserId !== me && (!last || m.at > last)).length
}
export function totalUnread(s: State, me: string): number {
  return conversationsFor(s, me).reduce((sum, c) => sum + unreadCount(s, c.id, me), 0)
}
export function lastMessage(s: State, conversationId: string): Message | undefined {
  const list = s.messages.filter((m) => m.conversationId === conversationId).sort((a, b) => a.at.localeCompare(b.at))
  return list[list.length - 1]
}
