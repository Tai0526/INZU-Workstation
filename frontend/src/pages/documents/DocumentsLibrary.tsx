import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Search, Plus, Download, Folder, Globe, Lock, Clock, CheckCircle2,
  FileText, Users, FolderOpen, ShieldCheck, Check, X, Truck, User,
} from 'lucide-react'
import { PieChart, Pie, Cell } from 'recharts'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, useBranches, type RoleKey } from '@/lib/roles'
import { canEdit as canEditModule } from '@/lib/permissions'
import { useUsers } from '@/lib/auth/users'
import { useVehicles } from '@/lib/fleet/store'
import StatusBadge from '@/components/ui/StatusBadge'
import Button from '@/components/ui/Button'
import { useDocuments, documentsStore } from '@/lib/documents/store'
import { exportDocumentRegister } from '@/lib/documents/excel'
import UploadDocumentModal from '@/components/documents/UploadDocumentModal'
import DocumentDetailModal from '@/components/documents/DocumentDetailModal'
import {
  DOC_STATUS_META, docStatus, APPROVAL_STATUS_META, approvalOf, typeLabelOf, displayNameOf,
  departmentOf, visibilityOf, canAccessDoc, type DocumentRecord,
} from '@/lib/documents/types'

type Tab = 'library' | 'shared' | 'mine' | 'approvals'

// Who may approve library documents (and therefore see the Approvals area).
const APPROVER_ROLES: RoleKey[] = ['administrator', 'managing_director', 'operations_manager', 'asst_operations_manager']

const APPROVAL_COLOR: Record<'pending' | 'rejected' | 'approved', string> = {
  pending: '#e0a516', rejected: '#e5484d', approved: '#22a06b',
}

function fmtSize(b: number): string {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1_048_576) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1_048_576).toFixed(1)} MB`
}
function initials(name: string): string {
  return (name || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}
function extOf(d: DocumentRecord): { label: string; cls: string } {
  const n = (d.file_name || '').toLowerCase()
  const m = (d.mime_type || '').toLowerCase()
  if (n.endsWith('.pdf') || m.includes('pdf')) return { label: 'PDF', cls: 'bg-status-critical/10 text-status-critical' }
  if (/\.(docx?|odt)$/.test(n) || m.includes('word')) return { label: 'DOC', cls: 'bg-brand-tint text-brand' }
  if (/\.(xlsx?|csv|ods)$/.test(n) || m.includes('sheet') || m.includes('excel')) return { label: 'XLS', cls: 'bg-status-good/10 text-status-good' }
  if (/\.(pptx?|odp)$/.test(n) || m.includes('presentation') || m.includes('powerpoint')) return { label: 'PPT', cls: 'bg-status-warning/10 text-[#8a6d10]' }
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n) || m.startsWith('image/')) return { label: 'IMG', cls: 'bg-brand-tint text-brand' }
  return { label: 'FILE', cls: 'bg-canvas text-status-neutral' }
}

export default function DocumentsLibrary() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const userId = user!.id
  const branches = useBranches()
  const users = useUsers()
  const vehicles = useVehicles()
  const canEdit = canEditModule(role, 'documents')
  const canApprove = canEdit && APPROVER_ROLES.includes(role)
  const canToggle = ROLES[role].canToggleBranch
  const all = useDocuments()

  const [tab, setTab] = useState<Tab>('library')
  const [q, setQ] = useState('')
  const [folder, setFolder] = useState<string>('all')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [detail, setDetail] = useState<DocumentRecord | null>(null)

  useEffect(() => { setFolder('all') }, [tab])

  const ctx = { userId, role, branch, canToggle }
  const ownerNameOf = (d: DocumentRecord) =>
    (d.owner_id && users.find((u) => u.id === d.owner_id)?.full_name) || d.uploaded_by
  const branchShortOf = (d: DocumentRecord) =>
    d.all_branches ? 'Company-wide' : (branches.find((b) => b.code === d.branch)?.short ?? d.branch)
  // Registration plate for a vehicle document (matched by id or fleet number).
  const regOf = (d: DocumentRecord) => {
    if (d.entity_type !== 'vehicle') return ''
    return vehicles.find((v) => v.id === d.entity_id || v.fleet_no === d.entity_label)?.reg_plate ?? ''
  }
  // What the document is about: the vehicle/driver for licensing docs, else its name.
  const subjectOf = (d: DocumentRecord) => (d.entity_type !== 'general' ? d.entity_label : displayNameOf(d))

  // Everything the user is allowed to see (current versions only).
  const accessible = useMemo(() => all.filter((d) => !d.superseded && canAccessDoc(d, ctx)), [all, userId, role, branch, canToggle])
  // The public library is the authoritative set — approved documents only. Work
  // in progress (draft / pending / rejected) lives in "My documents" and the
  // approvals queue, not the shared library.
  const libraryDocs = useMemo(() => accessible.filter((d) => visibilityOf(d) === 'public' && approvalOf(d) === 'approved'), [accessible])
  const sharedDocs = useMemo(() => accessible.filter((d) => visibilityOf(d) === 'private' && d.owner_id !== userId), [accessible, userId])
  const myDocs = useMemo(() => all.filter((d) => !d.superseded && d.owner_id === userId), [all, userId])

  // Approver scope: every current document in the branches they oversee, so they
  // can clear private items too (the one place private docs surface to a non-recipient).
  const apprScope = useMemo(
    () => all.filter((d) => !d.superseded && (canToggle || d.branch === branch || d.all_branches)),
    [all, branch, canToggle],
  )
  const pendingDocs = useMemo(() => apprScope.filter((d) => approvalOf(d) === 'pending'), [apprScope])
  const approvedCount = apprScope.filter((d) => approvalOf(d) === 'approved').length
  const rejectedCount = apprScope.filter((d) => approvalOf(d) === 'rejected').length

  // Documents the user can actually open across their tabs (deduped).
  const visibleCount = useMemo(() => {
    const ids = new Set<string>()
    for (const d of libraryDocs) ids.add(d.id)
    for (const d of sharedDocs) ids.add(d.id)
    for (const d of myDocs) ids.add(d.id)
    if (canApprove) for (const d of pendingDocs) ids.add(d.id)
    return ids.size
  }, [libraryDocs, sharedDocs, myDocs, pendingDocs, canApprove])

  const tabSet = tab === 'library' ? libraryDocs : tab === 'shared' ? sharedDocs : tab === 'mine' ? myDocs : pendingDocs

  const searched = useMemo(() => {
    const term = q.trim().toLowerCase()
    const base = [...tabSet].sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''))
    if (!term) return base
    return base.filter((d) => [
      displayNameOf(d), typeLabelOf(d), d.entity_label, d.reference_no, d.issuer,
      d.file_name, d.owner, ownerNameOf(d), departmentOf(d), (d.tags ?? []).join(' '), d.notes,
    ].some((f) => (f || '').toLowerCase().includes(term)))
  }, [tabSet, q])

  // Department "folders" for the current tab.
  const folders = useMemo(() => {
    const map = new Map<string, { count: number; size: number }>()
    for (const d of searched) {
      const dep = departmentOf(d)
      const e = map.get(dep) ?? { count: 0, size: 0 }
      e.count++; e.size += d.file_size || 0
      map.set(dep, e)
    }
    return [...map.entries()].map(([dep, v]) => ({ dep, ...v })).sort((a, b) => b.count - a.count)
  }, [searched])

  const shown = folder === 'all' ? searched : searched.filter((d) => departmentOf(d) === folder)

  const TABS: { key: Tab; label: string; count: number; show: boolean }[] = [
    { key: 'library', label: 'Public library', count: libraryDocs.length, show: true },
    { key: 'shared', label: 'Shared with me', count: sharedDocs.length, show: true },
    { key: 'mine', label: 'My documents', count: myDocs.length, show: true },
    { key: 'approvals', label: 'Approvals', count: pendingDocs.length, show: canApprove },
  ]

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          The shared library opens on the <span className="font-medium text-navy">public</span> documents everyone can use.
          Anything private is visible only to its owner and the people they choose. Managers get an approvals queue.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={() => exportDocumentRegister(shown, branches.find((b) => b.code === branch)?.short ?? branch)}><Download size={14} /> Export</Button>
          {canEdit && <Button onClick={() => setUploadOpen(true)}><Plus size={14} /> New document</Button>}
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<FileText size={16} />} label="Documents" value={visibleCount} />
        <StatCard icon={<Globe size={16} />} label="Public" value={libraryDocs.length} />
        <StatCard icon={<Users size={16} />} label="Shared with me" value={sharedDocs.length} />
        <StatCard icon={<Clock size={16} />} label={canApprove ? 'Awaiting approval' : 'My documents'} value={canApprove ? pendingDocs.length : myDocs.length} tone={canApprove && pendingDocs.length ? 'warning' : 'neutral'} />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.filter((t) => t.show).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${tab === t.key ? 'bg-navy text-white' : 'border border-black/10 bg-white text-navy hover:bg-canvas'}`}
          >
            {t.label}
            <span className={`rounded-full px-1.5 text-xs ${tab === t.key ? 'bg-white/20' : 'bg-canvas text-status-neutral'}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {tab === 'approvals' ? (
        <ApprovalsView
          pending={pendingDocs} approved={approvedCount} rejected={rejectedCount}
          ownerNameOf={ownerNameOf} onOpen={setDetail}
        />
      ) : (
        <>
          {/* Search */}
          <div className="relative max-w-md">
            <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search documents…"
              className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand"
            />
          </div>

          {/* Folders (by department) */}
          {folders.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-navy">Folders</h3>
              <div className="flex flex-wrap gap-3">
                <FolderCard active={folder === 'all'} onClick={() => setFolder('all')} name="All" count={searched.length} size={searched.reduce((s, d) => s + (d.file_size || 0), 0)} />
                {folders.map((f) => (
                  <FolderCard key={f.dep} active={folder === f.dep} onClick={() => setFolder(f.dep)} name={f.dep} count={f.count} size={f.size} />
                ))}
              </div>
            </div>
          )}

          {/* File cards */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-navy">{folder === 'all' ? 'All files' : folder} <span className="text-status-neutral">· {shown.length}</span></h3>
            {shown.length === 0 ? (
              <div className="card flex flex-col items-center gap-2 py-12 text-center text-sm text-status-neutral">
                <FolderOpen size={28} className="text-status-neutral/60" />
                {tab === 'mine' ? 'You have not added any documents yet.' : tab === 'shared' ? 'Nothing has been shared privately with you.' : 'No documents here yet.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {shown.map((d) => {
                  const ext = extOf(d)
                  const st = docStatus(d)
                  const ap = approvalOf(d)
                  const vis = visibilityOf(d)
                  const isEntity = d.entity_type !== 'general'
                  const reg = regOf(d)
                  // Licensing docs lead with the vehicle/driver they belong to; the
                  // doc type sits underneath. General docs lead with their title.
                  const title = subjectOf(d)
                  const subtitle = d.entity_type === 'vehicle'
                    ? `${typeLabelOf(d)}${reg ? ` · ${reg}` : ''}`
                    : d.entity_type === 'driver'
                      ? typeLabelOf(d)
                      : `${typeLabelOf(d)} · ${departmentOf(d)}`
                  return (
                    <button
                      key={d.id}
                      onClick={() => setDetail(d)}
                      className="group flex flex-col rounded-xl border border-black/10 bg-white p-3 text-left shadow-card transition-shadow hover:shadow-cardhover"
                    >
                      <div className="flex items-start gap-2">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${ext.cls}`}>{ext.label}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 truncate text-sm font-semibold text-navy" title={title}>
                            {isEntity && (d.entity_type === 'vehicle' ? <Truck size={13} className="shrink-0 text-status-neutral" /> : <User size={13} className="shrink-0 text-status-neutral" />)}
                            <span className="truncate">{title}</span>
                          </div>
                          <div className="truncate text-xs text-status-neutral">{subtitle}</div>
                        </div>
                        {vis === 'private' ? <Lock size={13} className="shrink-0 text-status-neutral" /> : <Globe size={13} className="shrink-0 text-status-neutral" />}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <StatusBadge tone={APPROVAL_STATUS_META[ap].tone}>{APPROVAL_STATUS_META[ap].label}</StatusBadge>
                        {st !== 'none' && <StatusBadge tone={DOC_STATUS_META[st].tone}>{DOC_STATUS_META[st].label}</StatusBadge>}
                      </div>

                      <div className="mt-3 flex items-center gap-2 border-t border-black/5 pt-2.5">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-tint text-[10px] font-semibold text-navy">{initials(ownerNameOf(d))}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-status-neutral">Filed by {ownerNameOf(d)}</span>
                        <span className="shrink-0 text-xs text-status-neutral">{d.uploaded_at?.slice(0, 10)}</span>
                      </div>
                      {canToggle && <div className="mt-1 text-[11px] text-status-neutral">{branchShortOf(d)}{d.file_size ? ` · ${fmtSize(d.file_size)}` : ''}</div>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      <UploadDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} branch={branch} role={role} />
      <DocumentDetailModal
        doc={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        canApprove={canApprove}
        role={role}
        userId={userId}
        branch={branch}
        canToggle={canToggle}
      />
    </div>
  )
}

// ── Small building blocks ────────────────────────────────────────────────
function StatCard({ icon, label, value, tone = 'neutral' }: { icon: ReactNode; label: string; value: number; tone?: 'neutral' | 'warning' }) {
  return (
    <div className="card flex items-center gap-3 p-3">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tone === 'warning' ? 'bg-status-warning/15 text-[#8a6d10]' : 'bg-brand-tint text-brand'}`}>{icon}</span>
      <div>
        <div className="text-lg font-bold leading-none text-navy">{value}</div>
        <div className="text-xs text-status-neutral">{label}</div>
      </div>
    </div>
  )
}

function FolderCard({ name, count, size, active, onClick }: { name: string; count: number; size: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-40 items-center gap-2.5 rounded-xl border p-3 text-left transition-colors ${active ? 'border-brand bg-brand-tint/40' : 'border-black/10 bg-white hover:bg-canvas'}`}
    >
      <Folder size={22} className={active ? 'text-brand' : 'text-navy/70'} />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-navy">{name}</div>
        <div className="text-xs text-status-neutral">{count} file{count === 1 ? '' : 's'}{size ? ` · ${fmtSize(size)}` : ''}</div>
      </div>
    </button>
  )
}

// ── Approvals area (managers only) ───────────────────────────────────────
function ApprovalsView({
  pending, approved, rejected, ownerNameOf, onOpen,
}: {
  pending: DocumentRecord[]
  approved: number
  rejected: number
  ownerNameOf: (d: DocumentRecord) => string
  onOpen: (d: DocumentRecord) => void
}) {
  const data = [
    { name: 'Pending', value: pending.length, fill: APPROVAL_COLOR.pending },
    { name: 'Approved', value: approved, fill: APPROVAL_COLOR.approved },
    { name: 'Rejected', value: rejected, fill: APPROVAL_COLOR.rejected },
  ]
  const total = pending.length + approved + rejected

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Summary donut */}
      <div className="card p-4 lg:col-span-1">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-status-neutral">Document summary</h3>
        <div className="relative mx-auto mt-3 flex h-[180px] w-[180px] items-center justify-center">
          {total > 0 ? (
            <PieChart width={180} height={180}>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={2} stroke="none">
                {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
              </Pie>
            </PieChart>
          ) : <div className="text-sm text-status-neutral">No documents yet</div>}
          {total > 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-navy">{total}</span>
              <span className="text-xs text-status-neutral">total</span>
            </div>
          )}
        </div>
        <div className="mt-3 space-y-1.5">
          <Legend color={APPROVAL_COLOR.pending} label="Pending" value={pending.length} />
          <Legend color={APPROVAL_COLOR.approved} label="Approved" value={approved} />
          <Legend color={APPROVAL_COLOR.rejected} label="Rejected" value={rejected} />
        </div>
      </div>

      {/* Pending queue */}
      <div className="card p-4 lg:col-span-2">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-navy">
          <ShieldCheck size={15} /> Awaiting your approval <span className="text-status-neutral">· {pending.length}</span>
        </h3>
        {pending.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-status-neutral">
            <CheckCircle2 size={26} className="text-status-good" /> Nothing is waiting — you're all caught up.
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((d) => (
              <div
                key={d.id}
                onClick={() => onOpen(d)}
                className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-black/10 bg-white px-3 py-2.5 hover:bg-canvas"
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${extOf(d).cls}`}>{extOf(d).label}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-navy">{d.entity_type !== 'general' ? `${d.entity_label} — ${typeLabelOf(d)}` : displayNameOf(d)}</div>
                  <div className="truncate text-xs text-status-neutral">{typeLabelOf(d)} · {departmentOf(d)} · {ownerNameOf(d)} · {d.uploaded_at?.slice(0, 10)}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button onClick={(e) => { e.stopPropagation(); documentsStore.approve(d.id) }}><Check size={14} /> Approve</Button>
                  <Button variant="danger" onClick={(e) => { e.stopPropagation(); documentsStore.reject(d.id) }}><X size={14} /> Reject</Button>
                </div>
              </div>
            ))}
            <p className="pt-1 text-xs text-status-neutral">Open a document to add a decision note, see its history, or review the file before deciding.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="flex-1 text-status-neutral">{label}</span>
      <span className="font-semibold text-navy">{value}</span>
    </div>
  )
}
