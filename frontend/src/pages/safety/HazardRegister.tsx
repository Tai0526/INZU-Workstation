import { useMemo, useState } from 'react'
import { Plus, Search, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { useDeepLink } from '@/lib/ui/deeplink'
import StatusBadge from '@/components/ui/StatusBadge'
import KpiCard from '@/components/ui/KpiCard'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import {
  useHazards, hazardsStore, HAZARD_TYPE_META, HAZARD_STATUS_META, riskScore, riskBand,
  type Hazard, type HazardStatus,
} from '@/lib/safety/registers'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const today = () => new Date().toISOString().slice(0, 10)

type Draft = Omit<Hazard, keyof import('@/lib/safety/registers').Audited | 'branch'>

const blank = (): Draft => ({
  date_identified: today(),
  location: '',
  type: 'near_miss',
  description: '',
  severity: 3,
  likelihood: 3,
  controls: '',
  owner: '',
  target_date: '',
  status: 'open',
  notes: '',
})

export default function HazardRegister() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[role].canToggleBranch
  const editable = canEdit(role, 'safety')

  const all = useHazards()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | HazardStatus>('all')
  useDeepLink(['status'], (p) => { const s = p.get('status'); if (s) setStatus(s as HazardStatus) })
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState('')

  const mine = useMemo(() => all.filter((h) => h.branch === branch), [all, branch])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return mine
      .filter((h) => status === 'all' || h.status === status)
      .filter((h) => !term || [h.location, h.description, h.owner].some((f) => f.toLowerCase().includes(term)))
      .sort((a, b) => b.date_identified.localeCompare(a.date_identified))
  }, [mine, q, status])

  const counts = useMemo(() => ({
    all: mine.length,
    open: mine.filter((h) => h.status === 'open').length,
    in_progress: mine.filter((h) => h.status === 'in_progress').length,
    closed: mine.filter((h) => h.status === 'closed').length,
    highRisk: mine.filter((h) => riskScore(h) >= 10 && h.status !== 'closed').length,
  }), [mine])

  function openNew() {
    setEditId(null)
    setDraft(blank())
    setErr('')
  }
  function openEdit(h: Hazard) {
    setEditId(h.id)
    setDraft({
      date_identified: h.date_identified,
      location: h.location,
      type: h.type,
      description: h.description,
      severity: h.severity,
      likelihood: h.likelihood,
      controls: h.controls,
      owner: h.owner,
      target_date: h.target_date,
      status: h.status,
      notes: h.notes,
    })
    setErr('')
  }
  function close() {
    setDraft(null)
    setEditId(null)
    setErr('')
  }
  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }
  function save() {
    if (!draft) return
    if (!draft.description.trim() || !draft.location.trim()) {
      setErr('Location and description are required.')
      return
    }
    if (editId) hazardsStore.update(editId, draft)
    else hazardsStore.add({ ...draft, branch })
    close()
  }
  function del() {
    if (editId && window.confirm('Delete this hazard record? This cannot be undone.')) {
      hazardsStore.remove(editId)
      close()
    }
  }

  const previewBand = draft ? riskBand(draft.severity * draft.likelihood) : null

  return (
    <div className="page space-y-5">
      <p className="max-w-2xl text-sm text-status-neutral">
        Log near misses, unsafe acts or conditions and environmental hazards; rate the risk as severity × likelihood,
        then track each item through to close-out.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Open" value={counts.open} tone="critical" />
        <KpiCard label="In progress" value={counts.in_progress} tone="warning" />
        <KpiCard label="High / extreme risk" value={counts.highRisk} tone="critical" />
        <KpiCard label="Closed" value={counts.closed} tone="good" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search location, description, owner…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All statuses ({counts.all})</option>
          <option value="open">Open ({counts.open})</option>
          <option value="in_progress">In progress ({counts.in_progress})</option>
          <option value="closed">Closed ({counts.closed})</option>
        </select>
        {editable && <Button onClick={openNew}><Plus size={15} /> Log hazard</Button>}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Location</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Description</th>
                <th className="px-4 py-2.5 font-medium">Risk</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 font-medium">Target</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h, i) => {
                const score = riskScore(h)
                const band = riskBand(score)
                return (
                  <tr key={h.id} className={`cursor-pointer ${i % 2 ? 'bg-canvas/40' : ''} hover:bg-canvas`} onClick={() => openEdit(h)}>
                    <td className="px-4 py-2.5 text-status-neutral">{h.date_identified}</td>
                    <td className="px-4 py-2.5 text-navy">{h.location}</td>
                    <td className="px-4 py-2.5 text-status-neutral">{HAZARD_TYPE_META[h.type]}</td>
                    <td className="px-4 py-2.5 text-status-neutral"><div className="max-w-[18rem] truncate">{h.description}</div></td>
                    <td className="px-4 py-2.5"><StatusBadge tone={band.tone}>{band.label} · {score}</StatusBadge></td>
                    <td className="px-4 py-2.5 text-navy">{h.owner}</td>
                    <td className="px-4 py-2.5 text-status-neutral">{h.target_date}</td>
                    <td className="px-4 py-2.5"><StatusBadge tone={HAZARD_STATUS_META[h.status].tone}>{HAZARD_STATUS_META[h.status].label}</StatusBadge></td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-status-neutral">
                  <AlertTriangle size={22} className="mx-auto mb-2 text-status-neutral" />
                  No hazards logged yet. Capture a near miss or unsafe condition to start the register.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <Modal
        open={!!draft}
        onClose={close}
        title={editId ? 'Edit hazard' : 'Log hazard'}
        subtitle="Near-miss & hazard log with risk rating"
        footer={draft && (
          <>
            {editId && editable && <Button variant="danger" className="mr-auto" onClick={del}>Delete</Button>}
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </>
        )}
      >
        {draft && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-navy">Date identified</span>
                <input type="date" className={inputCls} value={draft.date_identified} onChange={(e) => set('date_identified', e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-navy">Location</span>
                <input className={inputCls} value={draft.location} onChange={(e) => set('location', e.target.value)} placeholder="Where was it identified?" />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Type</span>
              <select className={inputCls} value={draft.type} onChange={(e) => set('type', e.target.value)}>
                {Object.entries(HAZARD_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Description</span>
              <textarea className={inputCls} rows={3} value={draft.description} onChange={(e) => set('description', e.target.value)} placeholder="What happened or what was observed?" />
            </label>

            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-navy">Severity</span>
                <select className={inputCls} value={draft.severity} onChange={(e) => set('severity', Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-navy">Likelihood</span>
                <select className={inputCls} value={draft.likelihood} onChange={(e) => set('likelihood', Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <div className="block">
                <span className="mb-1 block text-xs font-medium text-navy">Risk rating</span>
                {previewBand && <StatusBadge tone={previewBand.tone}>{previewBand.label} · {draft.severity * draft.likelihood}</StatusBadge>}
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Control measures</span>
              <textarea className={inputCls} rows={2} value={draft.controls} onChange={(e) => set('controls', e.target.value)} placeholder="Actions taken or planned to control the risk" />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-navy">Owner</span>
                <input className={inputCls} value={draft.owner} onChange={(e) => set('owner', e.target.value)} placeholder="Responsible person" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-navy">Target date</span>
                <input type="date" className={inputCls} value={draft.target_date} onChange={(e) => set('target_date', e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-navy">Status</span>
                <select className={inputCls} value={draft.status} onChange={(e) => set('status', e.target.value as HazardStatus)}>
                  {Object.entries(HAZARD_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Notes</span>
              <textarea className={inputCls} rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
            </label>

            {err && <p className="text-xs font-medium text-status-critical">{err}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}
