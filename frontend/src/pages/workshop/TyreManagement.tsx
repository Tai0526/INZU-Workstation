import { useMemo, useState } from 'react'
import { CircleDot, Plus, Pencil, Trash2, Search, Wrench } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useVehicles } from '@/lib/fleet/store'
import { useTyres, tyresStore } from '@/lib/workshop/store'
import { type TyreRecord, type TyreInput, TYRE_POSITIONS } from '@/lib/workshop/types'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const fmt = (iso: string) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso } }

export default function TyreManagement() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'workshop')

  const vehicles = useVehicles().filter((v) => v.branch === branch)
  const tyres = useTyres().filter((t) => t.branch === branch)
  const [q, setQ] = useState('')
  const [form, setForm] = useState<{ open: boolean; editing: TyreRecord | null }>({ open: false, editing: null })

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return [...tyres]
      .filter((t) => !term || t.fleet_no.toLowerCase().includes(term) || t.brand.toLowerCase().includes(term) || t.position.toLowerCase().includes(term) || t.serial.toLowerCase().includes(term))
      .sort((a, b) => (b.fitted_date || '').localeCompare(a.fitted_date || '') || b.created_at.localeCompare(a.created_at))
  }, [tyres, q])

  const ym = new Date().toISOString().slice(0, 7)
  const thisMonth = tyres.filter((t) => (t.fitted_date || '').slice(0, 7) === ym).length
  const totalCost = tyres.reduce((s, t) => s + (t.cost_usd ?? 0), 0)

  return (
    <div className="page space-y-4">
      <p className="max-w-2xl text-sm text-status-neutral">
        Per-vehicle tyre history for <span className="font-medium text-navy">{branchLabel}</span> — fittings logged here or written automatically when a tyre <span className="font-medium text-navy">job card</span> is signed off.
      </p>

      <div className="grid grid-cols-3 gap-2 sm:max-w-md">
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{tyres.length}</div><div className="mt-0.5 text-[11px] text-status-neutral">Fittings logged</div></div>
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{thisMonth}</div><div className="mt-0.5 text-[11px] text-status-neutral">This month</div></div>
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">${Math.round(totalCost).toLocaleString()}</div><div className="mt-0.5 text-[11px] text-status-neutral">Total cost</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bus, brand, position…" className="w-60 rounded-lg border border-black/15 bg-white py-2 pl-8 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        {canManage && <Button className="ml-auto" onClick={() => setForm({ open: true, editing: null })}><Plus size={15} /> Log tyre</Button>}
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white">
              <tr>
                <th className="px-3 py-2.5 font-medium">Bus</th><th className="px-3 py-2.5 font-medium">Position</th>
                <th className="px-3 py-2.5 font-medium">Brand</th><th className="px-3 py-2.5 font-medium">Serial</th>
                <th className="px-3 py-2.5 font-medium">Fitted</th><th className="px-3 py-2.5 text-right font-medium">Odometer</th>
                <th className="px-3 py-2.5 text-right font-medium">Cost</th><th className="px-3 py-2.5 font-medium">Source</th>
                {canManage && <th className="px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={t.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-3 py-2 font-medium text-navy">{t.fleet_no}<div className="text-[11px] font-normal text-status-neutral">{t.reg_no}</div></td>
                  <td className="px-3 py-2 text-navy">{t.position}</td>
                  <td className="px-3 py-2 text-navy">{t.brand || '—'}</td>
                  <td className="px-3 py-2 text-status-neutral">{t.serial || '—'}</td>
                  <td className="px-3 py-2 text-status-neutral">{t.fitted_date ? fmt(t.fitted_date) : '—'}</td>
                  <td className="px-3 py-2 text-right text-status-neutral">{t.odometer ? t.odometer.toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 text-right text-status-neutral">{t.cost_usd != null ? `$${t.cost_usd.toLocaleString()}` : '—'}</td>
                  <td className="px-3 py-2">{t.job_id ? <span className="inline-flex items-center gap-1 text-[11px] text-brand"><Wrench size={11} /> Job card</span> : <span className="text-[11px] text-status-neutral">Logged</span>}</td>
                  {canManage && (
                    <td className="px-3 py-2"><div className="flex justify-end gap-1">
                      <button onClick={() => setForm({ open: true, editing: t })} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Edit"><Pencil size={14} /></button>
                      <button onClick={() => confirm('Remove this tyre record?') && tyresStore.remove(t.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button>
                    </div></td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={canManage ? 9 : 8} className="px-4 py-12 text-center text-sm text-status-neutral">
                  <CircleDot size={22} className="mx-auto mb-2 text-status-neutral/60" />
                  No tyre records. {canManage && 'Log a fitting, or sign off a tyre job card.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
      <TyreModal state={form} onClose={() => setForm({ open: false, editing: null })} branch={branch} vehicles={vehicles} />
    </div>
  )
}

function TyreModal({ state, onClose, branch, vehicles }: { state: { open: boolean; editing: TyreRecord | null }; onClose: () => void; branch: BranchCode; vehicles: any[] }) {
  const e = state.editing
  const blank = (): TyreInput => ({ branch, fleet_no: '', reg_no: '', position: TYRE_POSITIONS[0], brand: '', serial: '', fitted_date: new Date().toISOString().slice(0, 10), odometer: 0, cost_usd: null, reason: '', job_id: '', notes: '' })
  const [f, setF] = useState<TyreInput>(blank)
  const [key, setKey] = useState('')
  const k = (e?.id ?? 'new') + String(state.open)
  if (state.open && k !== key) {
    setKey(k)
    setF(e ? { branch: e.branch, fleet_no: e.fleet_no, reg_no: e.reg_no, position: e.position, brand: e.brand, serial: e.serial, fitted_date: e.fitted_date, odometer: e.odometer, cost_usd: e.cost_usd, reason: e.reason, job_id: e.job_id, notes: e.notes } : blank())
  }
  function set<K extends keyof TyreInput>(kk: K, v: TyreInput[K]) { setF((p) => ({ ...p, [kk]: v })) }
  function onVehicle(fleet: string) { const v = vehicles.find((x) => x.fleet_no === fleet); setF((p) => ({ ...p, fleet_no: fleet, reg_no: v ? v.reg_plate : '' })) }
  const ready = !!f.fleet_no.trim() && !!f.brand.trim()
  function save() { if (!ready) return; const data = { ...f, brand: f.brand.trim(), serial: f.serial.trim() }; if (e) tyresStore.update(e.id, data); else tyresStore.add(data); onClose() }
  return (
    <Modal open={state.open} onClose={onClose} title={e ? 'Edit tyre' : 'Log tyre'} subtitle="A tyre fitting on a vehicle."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}>{e ? 'Save' : 'Log tyre'}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Bus</span>
          <SearchableSelect className={inputCls} value={f.fleet_no} onChange={onVehicle} placeholder="Search bus…" advanceOnSelect options={vehicles.map((v) => ({ value: v.fleet_no, label: v.fleet_no, sub: v.reg_plate }))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Position</span>
          <select className={inputCls} value={f.position} onChange={(ev) => set('position', ev.target.value)}>{TYRE_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Brand</span><input className={inputCls} placeholder="e.g. Bridgestone" value={f.brand} onChange={(ev) => set('brand', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Serial / DOT</span><input className={inputCls} value={f.serial} onChange={(ev) => set('serial', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Fitted date</span><input type="date" className={inputCls} value={f.fitted_date} onChange={(ev) => set('fitted_date', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Odometer</span><input type="number" className={inputCls} value={f.odometer || ''} onChange={(ev) => set('odometer', Number(ev.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Cost (USD)</span><input type="number" step="0.01" className={inputCls} value={f.cost_usd ?? ''} onChange={(ev) => set('cost_usd', ev.target.value ? Number(ev.target.value) : null)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reason</span><input className={inputCls} placeholder="e.g. Worn / puncture / burst" value={f.reason} onChange={(ev) => set('reason', ev.target.value)} /></label>
      </div>
    </Modal>
  )
}
