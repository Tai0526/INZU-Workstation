import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Send, PenSquare, ArrowLeft, X, Paperclip, FileText, ExternalLink, Users, UserPlus, Check, LogOut, Pencil, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { useUsers } from '@/lib/auth/users'
import { ROLES, BRANCHES } from '@/lib/roles'
import { putFile, viewFile, useFileUrl } from '@/lib/storage/fileStore'
import {
  useMessaging, messagingStore, conversationsFor, otherParticipant,
  initials, unreadCount, lastMessage, isGroup, isGroupAdmin,
  type Attachment, type Conversation,
} from '@/lib/messaging/store'

function timeShort(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
function fileSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}
const cleanName = (s: string) => s.replace(/\s*\(demo\)$/, '')

interface PersonInfo { name: string; role: string; branch: string; exists: boolean }

export default function Messages() {
  const { user } = useAuth()
  const me = user!.id
  const navigate = useNavigate()
  const s = useMessaging()
  const users = useUsers()

  // Resolve a user id → display name + role + branch (so every thread shows who
  // you're talking to and which branch/role they hold).
  const byId = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])
  const info = (id: string): PersonInfo => {
    const u = byId[id]
    if (!u) return { name: 'Removed user', role: '', branch: '', exists: false }
    const branch = ROLES[u.role]?.crossBranch ? 'All branches' : (BRANCHES.find((b) => b.code === u.branch)?.short ?? '')
    return { name: cleanName(u.full_name), role: ROLES[u.role]?.label ?? u.role, branch, exists: true }
  }
  const subline = (p: PersonInfo) => [p.role, p.branch].filter(Boolean).join(' · ')

  const mine = conversationsFor(s, me)

  // Close = go back to the screen you came from (fall back to the dashboard).
  const close = () => (window.history.length > 1 ? navigate(-1) : navigate('/'))

  const [activeId, setActiveId] = useState<string | null>(mine[0]?.id ?? null)
  const [q, setQ] = useState('')
  const [pickQ, setPickQ] = useState('')
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Attachment[]>([])
  const [composing, setComposing] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupInfo, setGroupInfo] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const active = mine.find((c) => c.id === activeId) ?? null
  const thread = active ? s.messages.filter((m) => m.conversationId === active.id).sort((a, b) => a.at.localeCompare(b.at)) : []

  // How a conversation reads in the list and the header — a person for a direct
  // thread, the group's name and who's in it for a group.
  const nameOf = (id: string) => info(id).name
  interface ConvView { title: string; sub: string; group: boolean; gone: boolean }
  const view = (c: Conversation): ConvView => {
    if (isGroup(c)) {
      const others = c.participants.filter((p) => p !== me).map(nameOf)
      const sub = others.length ? `${c.participants.length} members · ${others.slice(0, 3).join(', ')}${others.length > 3 ? ` +${others.length - 3}` : ''}` : 'Just you'
      return { title: c.name || 'Group', sub, group: true, gone: false }
    }
    const p = info(otherParticipant(c, me))
    return { title: p.name, sub: subline(p), group: false, gone: !p.exists }
  }

  useEffect(() => {
    if (active) messagingStore.markRead(active.id, me)
    endRef.current?.scrollIntoView({ block: 'end' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, thread.length])

  const convos = mine
    .map((c) => ({ c, v: view(c), last: lastMessage(s, c.id), unread: unreadCount(s, c.id, me) }))
    .filter(({ v }) => { const term = q.trim().toLowerCase(); return !term || `${v.title} ${v.sub}`.toLowerCase().includes(term) })
    .sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? ''))

  // "You: hi" for what someone typed; "Ann left the group" for a membership note.
  const preview = (last: ReturnType<typeof lastMessage>): string => {
    if (!last) return 'Start a conversation'
    const body = last.text || ((last.attachments ?? []).length ? '📎 Attachment' : '')
    if (last.system) return `${last.fromUserId === me ? 'You' : nameOf(last.fromUserId)} ${body}`
    return `${last.fromUserId === me ? 'You: ' : ''}${body}`
  }

  // Directory = every active user account on the system except me.
  const directory = useMemo(() => {
    const term = pickQ.trim().toLowerCase()
    return users
      .filter((u) => u.active && u.id !== me)
      .filter((u) => !term || `${cleanName(u.full_name)} ${ROLES[u.role]?.label ?? ''}`.toLowerCase().includes(term))
      .sort((a, b) => cleanName(a.full_name).localeCompare(cleanName(b.full_name)))
  }, [users, me, pickQ])

  function openUser(id: string) {
    setActiveId(messagingStore.ensureConversation(me, id))
    setComposing(false)
    setPickQ('')
  }

  async function pickFiles(files: FileList) {
    const added: Attachment[] = []
    for (const f of Array.from(files)) {
      const id = `msg_${Date.now()}_${Math.round(Math.random() * 1e5)}`
      await putFile(id, f)
      added.push({ file_id: id, file_name: f.name, mime: f.type, size: f.size, kind: f.type.startsWith('image/') ? 'image' : 'file' })
    }
    setPending((p) => [...p, ...added])
  }
  function send() {
    if (!active || (!draft.trim() && pending.length === 0)) return
    messagingStore.sendTo(active.id, me, draft, pending)
    setDraft(''); setPending([])
  }

  function createGroup(name: string, memberIds: string[]) {
    setActiveId(messagingStore.createGroup(me, name, memberIds))
    setCreatingGroup(false); setComposing(false); setPickQ('')
  }

  return (
    <div className="page space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-navy">Messages</h2>
        <button onClick={close} className="inline-flex items-center gap-1.5 rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm font-medium text-navy hover:bg-canvas">
          <X size={15} /> Close
        </button>
      </div>
      <div className="card grid h-[calc(100vh-210px)] min-h-[440px] grid-cols-1 overflow-hidden md:grid-cols-[320px_1fr]">
        {/* ── Inbox list ── */}
        <div className={clsx('flex min-h-0 flex-col border-r border-black/10', active && 'hidden md:flex')}>
          <div className="flex items-center gap-2 border-b border-black/10 px-3 py-3">
            <div className="relative flex-1">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-status-neutral" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people"
                className="w-full rounded-lg border border-black/15 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand" />
            </div>
            <button onClick={() => setComposing(true)} className="rounded-lg bg-navy p-2 text-white hover:bg-navy-secondary" title="New message"><PenSquare size={15} /></button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {convos.map(({ c, v, last, unread }) => (
              <button key={c.id} onClick={() => setActiveId(c.id)}
                className={clsx('flex w-full items-center gap-3 border-b border-black/5 px-3 py-3 text-left hover:bg-canvas', activeId === c.id && 'bg-canvas')}>
                <Avatar name={v.title} group={v.group} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-navy">{v.title}</span>
                    {last && <span className="shrink-0 text-[10px] text-status-neutral">{timeShort(last.at)}</span>}
                  </div>
                  <div className="truncate text-[11px] text-status-neutral">{v.sub}</div>
                  <div className="flex items-center gap-2">
                    <span className={clsx('truncate text-xs', unread ? 'font-medium text-navy' : 'text-status-neutral')}>{preview(last)}</span>
                    {unread > 0 && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-brand" />}
                  </div>
                </div>
              </button>
            ))}
            {convos.length === 0 && <p className="px-4 py-8 text-center text-sm text-status-neutral">No conversations yet. Tap ✎ to message someone or start a group.</p>}
          </div>
        </div>

        {/* ── Thread ── */}
        <div className={clsx('flex min-h-0 flex-col', !active && 'hidden md:flex')}>
          {active ? (
            <>
              <div className="flex shrink-0 items-center gap-3 border-b border-black/10 px-4 py-3">
                <button onClick={() => setActiveId(null)} className="rounded-md p-1 text-status-neutral hover:bg-canvas md:hidden"><ArrowLeft size={18} /></button>
                {/* A group's header opens its members; a direct thread has nothing to manage. */}
                <button
                  onClick={() => isGroup(active) && setGroupInfo(true)}
                  disabled={!isGroup(active)}
                  className={clsx('flex min-w-0 items-center gap-3 rounded-lg px-1.5 py-1 text-left', isGroup(active) && 'hover:bg-canvas')}>
                  <Avatar name={view(active).title} group={view(active).group} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-navy">{view(active).title}</div>
                    <div className="truncate text-xs text-status-neutral">
                      {view(active).gone ? 'This account no longer exists' : view(active).sub}
                    </div>
                  </div>
                </button>
                {isGroup(active) && (
                  <button onClick={() => setGroupInfo(true)} className="ml-auto rounded-lg border border-black/15 p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Group info"><Users size={15} /></button>
                )}
                {!isGroup(active) && (
                  <div className="ml-auto hidden text-right text-[11px] text-status-neutral sm:block">
                    Messaging as<br /><span className="font-medium text-navy">{cleanName(user!.fullName)}</span>
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-canvas/40 px-4 py-4">
                {thread.map((m) => {
                  const isMine = m.fromUserId === me
                  // "Ann added Ben" — a membership note, not something anyone typed.
                  if (m.system) {
                    return (
                      <div key={m.id} className="flex justify-center">
                        <span className="rounded-full bg-white/70 px-3 py-1 text-[11px] text-status-neutral">
                          <b className="font-medium text-navy">{isMine ? 'You' : nameOf(m.fromUserId)}</b> {m.text} · {timeShort(m.at)}
                        </span>
                      </div>
                    )
                  }
                  return (
                    <div key={m.id} className={clsx('flex', isMine ? 'justify-end' : 'justify-start')}>
                      <div className={clsx('max-w-[78%] rounded-2xl px-3.5 py-2 text-sm', isMine ? 'rounded-br-sm bg-navy text-white' : 'rounded-bl-sm bg-white text-navy shadow-card')}>
                        {!isMine && <div className="mb-0.5 text-[10px] font-semibold text-brand">{info(m.fromUserId).name}</div>}
                        {m.text && <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>}
                        {(m.attachments ?? []).map((a) => <AttachmentView key={a.file_id} a={a} mine={isMine} />)}
                        <div className={clsx('mt-0.5 text-[10px]', isMine ? 'text-white/55' : 'text-status-neutral')}>{timeShort(m.at)}</div>
                      </div>
                    </div>
                  )
                })}
                <div ref={endRef} />
              </div>

              {/* Pending attachments */}
              {pending.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-black/10 px-3 pt-2">
                  {pending.map((a, i) => (
                    <span key={a.file_id} className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-canvas px-2 py-1 text-xs text-navy">
                      <Paperclip size={12} /> <span className="max-w-[140px] truncate">{a.file_name}</span>
                      <button onClick={() => setPending((p) => p.filter((_, j) => j !== i))} className="text-status-neutral hover:text-status-critical"><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex shrink-0 items-center gap-2 border-t border-black/10 px-3 py-3">
                <button onClick={() => fileRef.current?.click()} className="rounded-full p-2 text-status-neutral hover:bg-canvas hover:text-navy" title="Attach photo / document"><Paperclip size={18} /></button>
                <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="hidden"
                  onChange={(e) => { if (e.target.files?.length) pickFiles(e.target.files); e.target.value = '' }} />
                <input value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
                  placeholder="Write a message…"
                  className="flex-1 rounded-full border border-black/15 bg-white px-4 py-2 text-sm outline-none focus:border-brand" />
                <button onClick={send} disabled={!draft.trim() && pending.length === 0} className="rounded-full bg-navy p-2.5 text-white hover:bg-navy-secondary disabled:opacity-40"><Send size={16} /></button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-status-neutral">Select a conversation to start messaging.</div>
          )}
        </div>
      </div>

      {/* New-message picker (real user accounts only) */}
      {composing && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-navy/40 p-4 pt-24" onClick={() => { setComposing(false); setPickQ('') }}>
          <div className="w-full max-w-md rounded-2xl bg-surface shadow-cardhover" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center border-b border-black/10 px-4 py-3">
              <h3 className="font-display text-sm font-bold text-navy">New message</h3>
              <button onClick={() => { setComposing(false); setPickQ('') }} className="ml-auto rounded-md p-1 text-status-neutral hover:bg-canvas"><X size={18} /></button>
            </div>
            <div className="border-b border-black/10 px-3 py-2.5">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-status-neutral" />
                <input autoFocus value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder="Search by name or role"
                  className="w-full rounded-lg border border-black/15 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand" />
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              <button onClick={() => { setComposing(false); setPickQ(''); setCreatingGroup(true) }}
                className="mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-canvas">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-white"><Users size={16} /></span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-navy">New group</div>
                  <div className="truncate text-[11px] text-status-neutral">Name it and pick who's in</div>
                </div>
              </button>
              <div className="mx-3 mb-1 border-t border-black/5" />
              {directory.map((u) => {
                const branch = ROLES[u.role]?.crossBranch ? 'All branches' : (BRANCHES.find((b) => b.code === u.branch)?.short ?? '')
                return (
                  <button key={u.id} onClick={() => openUser(u.id)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-canvas">
                    <Avatar name={cleanName(u.full_name)} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-navy">{cleanName(u.full_name)}</div>
                      <div className="truncate text-[11px] text-status-neutral">{[ROLES[u.role]?.label ?? u.role, branch].filter(Boolean).join(' · ')}</div>
                    </div>
                  </button>
                )
              })}
              {directory.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-status-neutral">
                  {pickQ ? 'No users match.' : 'No other user accounts yet. Create them in Admin → Users.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {creatingGroup && (
        <GroupCreateModal
          people={users.filter((u) => u.active && u.id !== me).map((u) => ({ id: u.id, name: cleanName(u.full_name), sub: subline(info(u.id)) }))}
          onCreate={createGroup}
          onClose={() => setCreatingGroup(false)}
        />
      )}

      {groupInfo && active && isGroup(active) && (
        <GroupInfoModal
          conv={active} me={me} nameOf={nameOf}
          people={users.filter((u) => u.active).map((u) => ({ id: u.id, name: cleanName(u.full_name), sub: subline(info(u.id)) }))}
          onLeave={() => { messagingStore.leaveGroup(active.id, me); setGroupInfo(false); setActiveId(null) }}
          onClose={() => setGroupInfo(false)}
        />
      )}
    </div>
  )
}

interface Pick { id: string; name: string; sub: string }

/** Shell shared by both group modals so they look and behave the same. */
function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-navy/40 p-4 pt-20" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-surface shadow-cardhover" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center border-b border-black/10 px-4 py-3">
          <h3 className="font-display text-sm font-bold text-navy">{title}</h3>
          <button onClick={onClose} className="ml-auto rounded-md p-1 text-status-neutral hover:bg-canvas"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="shrink-0 border-t border-black/10 px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

function PersonRow({ p, right, onClick }: { p: Pick; right?: React.ReactNode; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={clsx('flex w-full items-center gap-3 px-4 py-2 text-left', onClick && 'hover:bg-canvas')}>
      <Avatar name={p.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-navy">{p.name}</div>
        <div className="truncate text-[11px] text-status-neutral">{p.sub}</div>
      </div>
      {right}
    </Tag>
  )
}

/** Name the group, tick who's in it. Both are required before Create enables. */
function GroupCreateModal({ people, onCreate, onClose }: { people: Pick[]; onCreate: (name: string, ids: string[]) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const shown = people.filter((p) => { const t = q.trim().toLowerCase(); return !t || `${p.name} ${p.sub}`.toLowerCase().includes(t) })
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const ready = !!name.trim() && sel.size > 0

  return (
    <Sheet title="New group" onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-status-neutral">{sel.size} selected</span>
          <button onClick={() => ready && onCreate(name, [...sel])} disabled={!ready}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white hover:bg-navy-secondary disabled:opacity-40">
            <Check size={15} /> Create group
          </button>
        </div>
      }>
      <div className="space-y-2 border-b border-black/10 px-4 py-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-navy">Group name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Trident Workshop"
            className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-brand" />
        </label>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people to add"
            className="w-full rounded-lg border border-black/15 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand" />
        </div>
      </div>
      <div className="py-1">
        {shown.map((p) => (
          <PersonRow key={p.id} p={p} onClick={() => toggle(p.id)}
            right={<span className={clsx('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border', sel.has(p.id) ? 'border-navy bg-navy text-white' : 'border-black/25')}>
              {sel.has(p.id) && <Check size={13} />}
            </span>} />
        ))}
        {shown.length === 0 && <p className="px-4 py-8 text-center text-sm text-status-neutral">{q ? 'No users match.' : 'No other user accounts yet.'}</p>}
      </div>
    </Sheet>
  )
}

/** Members, plus rename / add / remove for the admin and Leave for everyone. */
function GroupInfoModal({ conv, me, people, nameOf, onLeave, onClose }: {
  conv: Conversation; me: string; people: Pick[]; nameOf: (id: string) => string; onLeave: () => void; onClose: () => void
}) {
  const admin = isGroupAdmin(conv, me)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(conv.name)
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')

  const byId = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people])
  const members = conv.participants.map((id) => byId[id] ?? { id, name: nameOf(id), sub: 'Removed user' })
  const candidates = people
    .filter((p) => !conv.participants.includes(p.id))
    .filter((p) => { const t = q.trim().toLowerCase(); return !t || `${p.name} ${p.sub}`.toLowerCase().includes(t) })

  function saveName() {
    messagingStore.renameGroup(conv.id, me, name)
    setRenaming(false)
  }

  if (adding) {
    return (
      <Sheet title="Add members" onClose={() => { setAdding(false); setQ('') }}>
        <div className="border-b border-black/10 px-4 py-3">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-status-neutral" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people"
              className="w-full rounded-lg border border-black/15 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand" />
          </div>
        </div>
        <div className="py-1">
          {candidates.map((p) => (
            <PersonRow key={p.id} p={p} onClick={() => { messagingStore.addMembers(conv.id, me, [p.id], nameOf); setAdding(false); setQ('') }}
              right={<UserPlus size={15} className="shrink-0 text-brand" />} />
          ))}
          {candidates.length === 0 && <p className="px-4 py-8 text-center text-sm text-status-neutral">{q ? 'No users match.' : 'Everyone is already in this group.'}</p>}
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title="Group info" onClose={onClose}
      footer={
        <button onClick={onLeave} className="inline-flex items-center gap-1.5 rounded-lg border border-status-critical/30 px-3 py-2 text-sm font-medium text-status-critical hover:bg-status-critical/5">
          <LogOut size={15} /> Leave group
        </button>
      }>
      <div className="border-b border-black/10 px-4 py-3">
        {renaming ? (
          <div className="flex items-center gap-2">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
              onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(conv.name); setRenaming(false) } }}
              className="flex-1 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-brand" />
            <button onClick={saveName} disabled={!name.trim()} className="rounded-lg bg-navy p-2 text-white hover:bg-navy-secondary disabled:opacity-40"><Check size={15} /></button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy text-white"><Users size={19} /></span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-base font-bold text-navy">{conv.name}</div>
              <div className="text-[11px] text-status-neutral">{conv.participants.length} member{conv.participants.length === 1 ? '' : 's'}</div>
            </div>
            {admin && <button onClick={() => { setName(conv.name); setRenaming(true) }} className="rounded-lg border border-black/15 p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Rename group"><Pencil size={14} /></button>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-status-neutral">
        Members
        {admin && <button onClick={() => setAdding(true)} className="ml-auto inline-flex items-center gap-1 rounded-full border border-dashed border-brand/40 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-brand hover:border-brand"><UserPlus size={12} /> Add</button>}
      </div>
      <div className="py-1">
        {members.map((p) => (
          <PersonRow key={p.id} p={p}
            right={
              <span className="flex shrink-0 items-center gap-2">
                {p.id === conv.createdBy && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">Admin</span>}
                {p.id === me && <span className="text-[10px] text-status-neutral">You</span>}
                {admin && p.id !== me && (
                  <button onClick={() => messagingStore.removeMember(conv.id, me, p.id, nameOf)} title={`Remove ${p.name}`}
                    className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={13} /></button>
                )}
              </span>
            } />
        ))}
      </div>
      {!admin && <p className="px-4 pb-3 pt-1 text-[11px] text-status-neutral">Only {nameOf(conv.createdBy) || 'the group admin'} can rename this group or change who's in it.</p>}
    </Sheet>
  )
}

function AttachmentView({ a, mine }: { a: Attachment; mine: boolean }) {
  const url = useFileUrl(a.kind === 'image' ? a.file_id : undefined)
  if (a.kind === 'image') {
    return (
      <button onClick={() => viewFile(a.file_id, a.file_name)} className="mt-1 block">
        {url
          ? <img src={url} alt={a.file_name} className="max-h-52 max-w-full rounded-lg border border-black/10 object-cover" />
          : <span className={clsx('text-xs', mine ? 'text-white/70' : 'text-status-neutral')}>Loading image…</span>}
      </button>
    )
  }
  return (
    <button onClick={() => viewFile(a.file_id, a.file_name)}
      className={clsx('mt-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs', mine ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-canvas text-navy hover:bg-black/5')}>
      <FileText size={15} />
      <span className="flex flex-col items-start">
        <span className="max-w-[180px] truncate font-medium">{a.file_name}</span>
        <span className={mine ? 'text-white/60' : 'text-status-neutral'}>{fileSize(a.size)}</span>
      </span>
      <ExternalLink size={12} className="ml-1 shrink-0" />
    </button>
  )
}

function Avatar({ name, group }: { name: string; group?: boolean }) {
  if (group) return <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-white"><Users size={16} /></div>
  return <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 font-display text-xs font-bold text-brand">{initials(name)}</div>
}
