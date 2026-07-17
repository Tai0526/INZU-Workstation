import { useSyncExternalStore } from 'react'
import { ROLES, type RoleKey } from '@/lib/roles'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * In-app messaging between USER ACCOUNTS. The directory lists the real users on
 * the system (created in Admin → Users). A conversation is either:
 *   direct — exactly two user ids; the id is the sorted pair, so messaging the
 *            same person twice always lands in the same thread.
 *   group  — a named thread with any number of members and a generated id.
 * Messages carry text and/or attachments (images shown inline, other files as
 * chips). Files live in the file store; only metadata is persisted here.
 *
 * Group membership changes are recorded as `system` messages so the thread shows
 * who added or removed whom, and when.
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
  /** A membership/rename event rather than something a person typed. */
  system?: boolean
}
export type ConvKind = 'direct' | 'group'
export interface Conversation {
  id: string          // direct: the sorted pair of user ids. group: generated.
  kind: ConvKind
  participants: string[]
  name: string        // group name ('' for direct)
  createdBy: string   // group admin — may rename, add and remove
  createdAt: string
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
  const [x, y] = [a, b].sort()
  return { id: `${x}__${y}`, kind: 'direct', participants: [x, y], name: '', createdBy: '', createdAt: new Date().toISOString() }
}
export const isGroup = (c: Conversation): boolean => c.kind === 'group'
/** The other person in a DIRECT conversation. Meaningless for a group. */
export function otherParticipant(c: Conversation, me: string): string {
  return c.participants[0] === me ? c.participants[1] : c.participants[0]
}
/** Only the creator administers a group; everyone can leave. */
export const isGroupAdmin = (c: Conversation, me: string): boolean => c.kind === 'group' && c.createdBy === me

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
 * Repair persisted data into the current shape. Older builds keyed messaging by
 * ROLE (fromRole + role-pair conversation ids); that can't be mapped to specific
 * accounts, so legacy data is dropped and messaging starts clean.
 *
 * This runs on every load, so it must accept BOTH shapes it may meet: direct
 * conversations saved before groups existed (no `kind`, no `name`, exactly two
 * participants) and groups (any member count). Requiring two participants here
 * would silently delete every group on the next reload.
 */
function coerce(parsed: any): State {
  if (!parsed || !Array.isArray(parsed.conversations) || !Array.isArray(parsed.messages) || typeof parsed.lastRead !== 'object' || parsed.lastRead === null) {
    return EMPTY
  }
  // Legacy role-based data (no user ids) → wipe and start fresh.
  if (parsed.messages.some((m: any) => m && m.fromRole && !m.fromUserId)) return EMPTY
  const conversations: Conversation[] = parsed.conversations
    .filter((c: any) => c && typeof c.id === 'string' && Array.isArray(c.participants) && c.participants.every((p: any) => typeof p === 'string'))
    .map((c: any): Conversation | null => {
      const participants: string[] = [...new Set<string>(c.participants)]
      const kind: ConvKind = c.kind === 'group' ? 'group' : 'direct'
      // A direct thread is defined by its pair; anything else is corrupt.
      if (kind === 'direct' && participants.length !== 2) return null
      return {
        id: c.id, kind, participants,
        name: typeof c.name === 'string' ? c.name : '',
        createdBy: typeof c.createdBy === 'string' ? c.createdBy : '',
        createdAt: typeof c.createdAt === 'string' ? c.createdAt : new Date().toISOString(),
      }
    })
    .filter((c: Conversation | null): c is Conversation => c !== null)
  const ids = new Set(conversations.map((c) => c.id))
  const messages: Message[] = parsed.messages
    .filter((m: any) => m && typeof m.fromUserId === 'string' && ids.has(m.conversationId))
    .map((m: any) => ({
      id: String(m.id), conversationId: m.conversationId, fromUserId: m.fromUserId,
      text: typeof m.text === 'string' ? m.text : '',
      attachments: Array.isArray(m.attachments) ? m.attachments : [],
      at: m.at ?? new Date().toISOString(),
      ...(m.system ? { system: true } : {}),
    }))
  return { conversations, messages, lastRead: parsed.lastRead }
}

function newId(p: string): string {
  return `${p}_${Date.now()}_${Math.round(Math.random() * 1e5)}`
}

/** A membership/rename note in the thread — attributed, so changes are traceable. */
function systemMsg(conversationId: string, by: string, text: string): Message {
  return { id: newId('m'), conversationId, fromUserId: by, text, attachments: [], at: new Date().toISOString(), system: true }
}

export const messagingStore = {
  state: (): State => load(),

  ensureConversation(me: string, other: string): string {
    const s = load()
    const id = convId(me, other)
    if (!s.conversations.some((c) => c.id === id)) commit({ ...s, conversations: [...s.conversations, mkConv(me, other)] })
    return id
  },

  /** Post to a conversation the sender belongs to. Both direct and group go through here. */
  sendTo(conversationId: string, me: string, text: string, attachments: Attachment[] = []) {
    const t = text.trim()
    if (!t && attachments.length === 0) return
    const s = load()
    // Guards against posting to a thread you were removed from in another tab.
    if (!s.conversations.some((c) => c.id === conversationId && c.participants.includes(me))) return
    const msg: Message = { id: newId('m'), conversationId, fromUserId: me, text: t, attachments, at: new Date().toISOString() }
    commit({ ...s, messages: [...s.messages, msg], lastRead: { ...s.lastRead, [`${conversationId}|${me}`]: msg.at } })
  },

  /** Create a named group. The creator is a member and its admin. */
  createGroup(me: string, name: string, memberIds: string[]): string {
    const s = load()
    const participants = [...new Set([me, ...memberIds])]
    const now = new Date().toISOString()
    const conv: Conversation = { id: newId('g'), kind: 'group', participants, name: name.trim() || 'New group', createdBy: me, createdAt: now }
    commit({
      ...s,
      conversations: [...s.conversations, conv],
      messages: [...s.messages, systemMsg(conv.id, me, `created the group "${conv.name}"`)],
      lastRead: { ...s.lastRead, [`${conv.id}|${me}`]: now },
    })
    return conv.id
  },

  renameGroup(conversationId: string, me: string, name: string) {
    const s = load()
    const c = s.conversations.find((x) => x.id === conversationId)
    const next = name.trim()
    if (!c || !isGroupAdmin(c, me) || !next || next === c.name) return
    commit({
      ...s,
      conversations: s.conversations.map((x) => (x.id === conversationId ? { ...x, name: next } : x)),
      messages: [...s.messages, systemMsg(conversationId, me, `renamed the group to "${next}"`)],
    })
  },

  addMembers(conversationId: string, me: string, ids: string[], nameOf: (id: string) => string) {
    const s = load()
    const c = s.conversations.find((x) => x.id === conversationId)
    if (!c || !isGroupAdmin(c, me)) return
    const fresh = ids.filter((id) => !c.participants.includes(id))
    if (!fresh.length) return
    commit({
      ...s,
      conversations: s.conversations.map((x) => (x.id === conversationId ? { ...x, participants: [...x.participants, ...fresh] } : x)),
      messages: [...s.messages, systemMsg(conversationId, me, `added ${fresh.map(nameOf).join(', ')}`)],
    })
  },

  removeMember(conversationId: string, me: string, userId: string, nameOf: (id: string) => string) {
    const s = load()
    const c = s.conversations.find((x) => x.id === conversationId)
    if (!c || !isGroupAdmin(c, me) || userId === me) return // the admin leaves via leaveGroup
    commit({
      ...s,
      conversations: s.conversations.map((x) => (x.id === conversationId ? { ...x, participants: x.participants.filter((p) => p !== userId) } : x)),
      messages: [...s.messages, systemMsg(conversationId, me, `removed ${nameOf(userId)}`)],
    })
  },

  /**
   * Leave a group. If the admin leaves, the longest-standing remaining member
   * inherits it — otherwise the group would be stranded with nobody able to
   * rename it or manage members.
   */
  leaveGroup(conversationId: string, me: string) {
    const s = load()
    const c = s.conversations.find((x) => x.id === conversationId)
    if (!c || c.kind !== 'group' || !c.participants.includes(me)) return
    const participants = c.participants.filter((p) => p !== me)
    const createdBy = c.createdBy === me ? (participants[0] ?? '') : c.createdBy
    commit({
      ...s,
      conversations: s.conversations.map((x) => (x.id === conversationId ? { ...x, participants, createdBy } : x)),
      messages: [...s.messages, systemMsg(conversationId, me, 'left the group')],
    })
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
/**
 * Unread = messages from someone else, newer than my last read. Membership notes
 * don't count — nobody needs a badge because someone left a group.
 */
export function unreadCount(s: State, conversationId: string, me: string): number {
  const last = s.lastRead[`${conversationId}|${me}`]
  return s.messages.filter((m) => m.conversationId === conversationId && !m.system && m.fromUserId !== me && (!last || m.at > last)).length
}
export function totalUnread(s: State, me: string): number {
  return conversationsFor(s, me).reduce((sum, c) => sum + unreadCount(s, c.id, me), 0)
}
export function lastMessage(s: State, conversationId: string): Message | undefined {
  const list = s.messages.filter((m) => m.conversationId === conversationId).sort((a, b) => a.at.localeCompare(b.at))
  return list[list.length - 1]
}
