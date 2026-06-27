import { useMemo, useState } from 'react'
import { FileWarning, Plus, Pencil, Trash2, CheckCircle2, RotateCcw, Bus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useVehicles } from '@/lib/fleet/store'
import { useRca, rcaStore } from '@/lib/workshop/store'
import { type Rca, type RcaInput, RCA_META } from '@/lib/workshop/types'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const fmt = (iso: string) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso } }

export default function RcaLog() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'workshop')

  const vehicles = useVehicles().filter((v) => v.branch === branch)
  const rca = useRca().filter((r) => r.branch === branch)
  const [form, setForm] = useState<{ open: boolean; editing: Rca | null }>({ open: false, editing: null })

  const rows = useMemo(() => [...rca].sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1) || b.date.localeCompare(a.date)), [rca])
  const open = rca.filter((r) => r.status === 'open').length

  return (
    <div className="page space-y-4">
      <p className="max-w-2xl text-sm text-status-neutral">
        Root-cause analysis for serious failures in <span className="font-medium text-navy">{branchLabel}</span> — what failed, why, and the corrective &amp; preventive actions, tracked to closure.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:max-w-xs">
        <div className={`rounded-xl border px-3 py-2 ${open ? 'border-status-warning/40 bg-status-warning/10' : 'border-black/10 bg-white'}`}><div className={`text-lg font-bold leading-none ${open ? 'text-[#8a6d10]' : 'text-navy'}`}>{open}</div><div className="mt-0.5 text-[11px] text-status-neutral">Open</div></div>
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{rca.length}</div><div className="mt-0.5 text-[11px] text-status-neutral">On record</div></div>
      </div>

      {canManage && <Button onClick={() => setForm({ open: true, editing: null })}><Plus size={15} /> New RCA</Button>}

      {rows.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center text-sm text-status-neutral">
          <FileWarning size={26} className="text-status-neutral/60" />
          No RCAs logged. {canManage && 'Open one for a serious or repeat failure.'}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-sm font-bold text-navy">{r.title}</h3>
                {r.fleet_no && <span className="inline-flex items-center gap-1 text-xs text-status-neutral"><Bus size={12} /> {r.fleet_no}</span>}
                <span className="text-xs text-status-neutral">{fmt(r.date)}</span>
                <StatusBadge tone={RCA_META[r.status].tone}>{RCA_META[r.status].label}</StatusBadge>
                {canManage && (
                  <div className="ml-auto flex gap-1">
                    <button onClick={() => rcaStore.update(r.id, { status: r.status === 'open' ? 'closed' : 'open' })} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title={r.status === 'open' ? 'Close' : 'Reopen'}>{r.status === 'open' ? <CheckCircle2 size={14} /> : <RotateCcw size={14} />}</button>
                    <button onClick={() => setForm({ open: true, editing: r })} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Edit"><Pencil size={14} /></button>
                    <button onClick={() => confirm('Remove this RCA?') && rcaStore.remove(r.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                <Field label="Failure" value={r.failure} />
                <Field label="Root cause" value={r.root_cause} />
                <Field label="Corrective action" value={r.corrective} />
                <Field label="Preventive action" value={r.preventive} />
              </div>
              {r.owner && <div className="mt-2 text-[11px] text-status-neutral">Owner: <span className="font-medium text-navy">{r.owner}</span></div>}
            </div>
          ))}
        </div>
      )}

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
      <RcaModal state={form} onClose={() => setForm({ open: false, editing: null })} branch={branch} vehicles={vehicles} />
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[11px] font-medium uppercase tracking-wide text-status-neutral">{label}</div><div className="text-navy">{value || '—'}</div></div>
}

function RcaModal({ state, onClose, branch, vehicles }: { state: { open: boolean; editing: Rca | null }; onClose: () => void; branch: BranchCode; vehicles: any[] }) {
  const e = state.editing
  const blank = (): RcaInput => ({ branch, date: new Date().toISOString().slice(0, 10), fleet_no: '', title: '', failure: '', root_cause: '', corrective: '', preventive: '', owner: '', status: 'open' })
  const [f, setF] = useState<RcaInput>(blank)
  const [key, setKey] = useState('')
  const k = (e?.id ?? 'new') + String(state.open)
  if (state.open && k !== key) { setKey(k); setF(e ? { branch: e.branch, date: e.date, fleet_no: e.fleet_no, title: e.title, failure: e.failure, root_cause: e.root_cause, corrective: e.corrective, preventive: e.preventive, owner: e.owner, status: e.status } : blank()) }
  function set<K extends keyof RcaInput>(kk: K, v: RcaInput[K]) { setF((p) => ({ ...p, [kk]: v })) }
  const ready = !!f.title.trim()
  function save() { if (!ready) return; if (e) rcaStore.update(e.id, f); else rcaStore.add(f); onClose() }
  return (
    <Modal open={state.open} onClose={onClose} size="lg" title={e ? 'Edit RCA' : 'New RCA'} subtitle="Root-cause analysis for a serious or repeat failure."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}>{e ? 'Save' : 'Create'}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Title</span><input className={inputCls} placeholder="e.g. Repeated gearbox failure" value={f.title} onChange={(ev) => set('title', ev.target.value)} autoFocus /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Bus (optional)</span>
          <SearchableSelect className={inputCls} value={f.fleet_no} onChange={(v) => set('fleet_no', v)} placeholder="Search bus…" options={vehicles.map((v) => ({ value: v.fleet_no, label: v.fleet_no, sub: v.reg_plate }))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Date</span><input type="date" className={inputCls} value={f.date} onChange={(ev) => set('date', ev.target.value)} /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">What failed</span><textarea className={inputCls} rows={2} value={f.failure} onChange={(ev) => set('failure', ev.target.value)} /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Root cause</span><textarea className={inputCls} rows={2} value={f.root_cause} onChange={(ev) => set('root_cause', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Corrective action</span><textarea className={inputCls} rows={2} value={f.corrective} onChange={(ev) => set('corrective', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Preventive action</span><textarea className={inputCls} rows={2} value={f.preventive} onChange={(ev) => set('preventive', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Owner</span><input className={inputCls} value={f.owner} onChange={(ev) => set('owner', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Status</span><select className={inputCls} value={f.status} onChange={(ev) => set('status', ev.target.value as Rca['status'])}><option value="open">Open</option><option value="closed">Closed</option></select></label>
      </div>
    </Modal>
  )
}
