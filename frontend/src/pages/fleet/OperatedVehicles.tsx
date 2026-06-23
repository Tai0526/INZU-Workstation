import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Search, Handshake, Wrench, Eye } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { SECTIONS } from '@/lib/org/sections'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import StatChips from '@/components/ui/StatChips'
import { useOperatedVehicles, operatedVehiclesStore, OPERATED_STATUS_LABEL, type OperatedStatus, type OperatedVehicle, type OperatedVehicleInput } from '@/lib/fleet/operated'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const STATUS_TONE: Record<OperatedStatus, 'good' | 'warning' | 'critical'> = { active: 'good', under_repair: 'warning', grounded: 'critical' }
type Filter = 'all' | OperatedStatus

export default function OperatedVehicles() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const editable = canEdit(role, 'fleet')

  const all = useOperatedVehicles()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [secFilter, setSecFilter] = useState('all')
  const [modal, setModal] = useState<{ open: boolean; editing: OperatedVehicle | null }>({ open: false, editing: null })

  const list = useMemo(() => all.filter((v) => v.branch === branch), [all, branch])
  const counts = useMemo(() => ({
    all: list.length,
    active: list.filter((v) => v.status === 'active').length,
    under_repair: list.filter((v) => v.status === 'under_repair').length,
    grounded: list.filter((v) => v.status === 'grounded').length,
  }), [list])
  const bySection = useMemo(() => {
    const m = new Map<string, number>()
    list.forEach((v) => m.set(v.section, (m.get(v.section) ?? 0) + 1))
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [list])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return list
      .filter((v) => filter === 'all' || v.status === filter)
      .filter((v) => secFilter === 'all' || v.section === secFilter)
      .filter((v) => !term || [v.fleet_no, v.reg_plate, v.owner, v.section].some((f) => f.toLowerCase().includes(term)))
      .sort((a, b) => a.section.localeCompare(b.section) || a.fleet_no.localeCompare(b.fleet_no, undefined, { numeric: true }))
  }, [list, q, filter, secFilter])

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          Vehicles we <span className="font-medium text-navy">operate but don't own</span> — we provide the drivers under contract (Pit, Security, Dewatering).
          No licensing documents are kept here; just availability and the owner. These are planned in <span className="font-medium text-navy">Operations → Weekly Plan</span>.
        </p>
        {!editable && <span className="inline-flex items-center gap-1.5 rounded-full bg-navy/5 px-3 py-1 text-xs font-medium text-navy"><Eye size={13} /> View only</span>}
      </div>

      <StatChips
        active={filter}
        onPick={(v) => setFilter(v)}
        stats={[
          { value: 'all', label: 'All operated', count: counts.all, tone: 'neutral' },
          { value: 'active', label: 'Active', count: counts.active, tone: 'good' },
          { value: 'under_repair', label: 'In workshop', count: counts.under_repair, tone: 'warning' },
          { value: 'grounded', label: 'Grounded', count: counts.grounded, tone: 'critical' },
        ]}
      />

      {/* By section (where we operate) */}
      {bySection.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {bySection.map(([s, n]) => (
            <button key={s} onClick={() => setSecFilter(secFilter === s ? 'all' : s)}
              className={clsx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium', secFilter === s ? 'border-brand bg-brand-tint/60 text-navy' : 'border-black/15 bg-white text-status-neutral hover:border-brand/40')}>
              {s} <span className="rounded-full bg-navy/5 px-1.5 font-bold text-navy">{n}</span>
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fleet, reg, owner, section…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        {editable && <Button onClick={() => setModal({ open: true, editing: null })}><Plus size={15} /> Register vehicle</Button>}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 font-medium">Fleet No</th>
                <th className="px-4 py-2.5 font-medium">Reg No</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 font-medium">Section</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                {editable && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-t border-black/5 hover:bg-canvas">
                  <td className="px-4 py-2.5 font-semibold text-navy">{v.fleet_no}</td>
                  <td className="px-4 py-2.5 text-status-neutral">{v.reg_plate || '—'}</td>
                  <td className="px-4 py-2.5 text-navy"><span className="inline-flex items-center gap-1.5"><Handshake size={13} className="text-brand" /> {v.owner || '—'}</span></td>
                  <td className="px-4 py-2.5 text-navy">{v.section}</td>
                  <td className="px-4 py-2.5"><StatusBadge tone={STATUS_TONE[v.status]}>{OPERATED_STATUS_LABEL[v.status]}</StatusBadge></td>
                  {editable && (
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setModal({ open: true, editing: v })} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy"><Pencil size={14} /></button>
                        <button onClick={() => confirm(`Remove ${v.fleet_no}?`) && operatedVehiclesStore.remove(v.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={editable ? 6 : 5} className="px-4 py-12 text-center text-sm text-status-neutral">
                  {list.length === 0 ? `No operated vehicles registered for ${branchLabel}.` : 'No vehicles match.'}{editable && list.length === 0 && ' Register the first one.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <OperatedModal state={modal} onClose={() => setModal({ open: false, editing: null })} branch={branch} />
    </div>
  )
}

function OperatedModal({ state, onClose, branch }: { state: { open: boolean; editing: OperatedVehicle | null }; onClose: () => void; branch: BranchCode }) {
  const e = state.editing
  const sections = SECTIONS[branch] ?? []
  const blank = (): OperatedVehicleInput => ({ branch, fleet_no: '', reg_plate: '', owner: '', section: sections[0] ?? '', status: 'active', notes: '' })
  const [f, setF] = useState<OperatedVehicleInput>(blank())
  const [error, setError] = useState('')
  const [key, setKey] = useState('')
  const k = (e?.id ?? 'new') + String(state.open)
  if (state.open && k !== key) { setKey(k); setF(e ? { branch: e.branch, fleet_no: e.fleet_no, reg_plate: e.reg_plate, owner: e.owner, section: e.section, status: e.status, notes: e.notes } : blank()); setError('') }

  function set<K extends keyof OperatedVehicleInput>(kk: K, v: OperatedVehicleInput[K]) { setF((p) => ({ ...p, [kk]: v })); setError('') }
  function save() {
    if (!f.fleet_no.trim()) return setError('Fleet number is required.')
    if (operatedVehiclesStore.conflict(f.fleet_no, e?.id)) return setError('That fleet number is already registered.')
    if (!f.section) return setError('Pick the section it operates in.')
    const payload: OperatedVehicleInput = { ...f, fleet_no: f.fleet_no.trim(), reg_plate: f.reg_plate.trim(), owner: f.owner.trim() }
    if (e) operatedVehiclesStore.update(e.id, payload); else operatedVehiclesStore.add(payload)
    onClose()
  }

  return (
    <Modal open={state.open} onClose={onClose} title={e ? 'Edit operated vehicle' : 'Register operated vehicle'}
      subtitle="A vehicle we drive but don't own — no documents needed."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>{e ? 'Save' : 'Register'}</Button></>}>
      {error && <div className="mb-3 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Fleet number *</span><input className={inputCls} value={f.fleet_no} onChange={(ev) => set('fleet_no', ev.target.value)} placeholder="HT-101" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Registration number</span><input className={inputCls} value={f.reg_plate} onChange={(ev) => set('reg_plate', ev.target.value)} placeholder="BCK 1201 ZM" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Owner (company)</span><input className={inputCls} value={f.owner} onChange={(ev) => set('owner', ev.target.value)} placeholder="FQM Trident" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Section *</span>
          <select className={inputCls} value={f.section} onChange={(ev) => set('section', ev.target.value)}>
            {sections.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Status</span>
          <select className={inputCls} value={f.status} onChange={(ev) => set('status', ev.target.value as OperatedStatus)}>
            <option value="active">Active</option>
            <option value="under_repair">In workshop</option>
            <option value="grounded">Grounded</option>
          </select>
        </label>
      </div>
      <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-status-neutral"><Wrench size={13} className="text-brand" /> Mark it In workshop or Grounded to take it out of weekly planning.</p>
    </Modal>
  )
}
