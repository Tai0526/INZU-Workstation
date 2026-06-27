import { useMemo, useState } from 'react'
import { CalendarClock, Wrench, Search } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import { useVehicles } from '@/lib/fleet/store'
import { usePm, pmStore } from '@/lib/workshop/store'
import { type PmConfig, DEFAULT_PM, pmStatus, PM_META, type PmState } from '@/lib/workshop/types'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const fmt = (iso: string) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso } }
const RANK: Record<PmState, number> = { overdue: 0, soon: 1, unset: 2, ok: 3 }

export default function PmSchedules() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'workshop')

  const vehicles = useVehicles().filter((v) => v.branch === branch)
  usePm() // reactivity
  const today = new Date().toISOString().slice(0, 10)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<{ fleet_no: string; reg_no: string } | null>(null)

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return vehicles
      .filter((v) => !term || v.fleet_no.toLowerCase().includes(term) || v.reg_plate.toLowerCase().includes(term))
      .map((v) => { const cfg = pmStore.for(v.fleet_no); return { v, cfg, ...pmStatus(cfg, today) } })
      .sort((a, b) => RANK[a.state] - RANK[b.state] || (a.dueDate || '9').localeCompare(b.dueDate || '9'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles, q, today, pmStore.get()])

  const counts = {
    overdue: rows.filter((r) => r.state === 'overdue').length,
    soon: rows.filter((r) => r.state === 'soon').length,
    unset: rows.filter((r) => r.state === 'unset').length,
  }

  return (
    <div className="page space-y-4">
      <p className="max-w-2xl text-sm text-status-neutral">
        Service schedule per bus for <span className="font-medium text-navy">{branchLabel}</span>. Set a service interval and log each service — buses due or overdue surface at the top so nothing is missed.
      </p>

      <div className="grid grid-cols-3 gap-2 sm:max-w-md">
        <div className={`rounded-xl border px-3 py-2 ${counts.overdue ? 'border-status-critical/40 bg-status-critical/5' : 'border-black/10 bg-white'}`}><div className={`text-lg font-bold leading-none ${counts.overdue ? 'text-status-critical' : 'text-navy'}`}>{counts.overdue}</div><div className="mt-0.5 text-[11px] text-status-neutral">Overdue</div></div>
        <div className={`rounded-xl border px-3 py-2 ${counts.soon ? 'border-status-warning/40 bg-status-warning/10' : 'border-black/10 bg-white'}`}><div className={`text-lg font-bold leading-none ${counts.soon ? 'text-[#8a6d10]' : 'text-navy'}`}>{counts.soon}</div><div className="mt-0.5 text-[11px] text-status-neutral">Due soon</div></div>
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{counts.unset}</div><div className="mt-0.5 text-[11px] text-status-neutral">Not scheduled</div></div>
      </div>

      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-status-neutral" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bus…" className="w-60 rounded-lg border border-black/15 bg-white py-2 pl-8 pr-3 text-sm text-navy outline-none focus:border-brand" />
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white">
              <tr>
                <th className="px-3 py-2.5 font-medium">Bus</th><th className="px-3 py-2.5 font-medium">Interval</th>
                <th className="px-3 py-2.5 font-medium">Last service</th><th className="px-3 py-2.5 font-medium">Next due</th>
                <th className="px-3 py-2.5 font-medium">Status</th>{canManage && <th className="px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ v, cfg, state, dueDate, daysLeft }, i) => (
                <tr key={v.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-3 py-2 font-medium text-navy">{v.fleet_no}<div className="text-[11px] font-normal text-status-neutral">{v.reg_plate}</div></td>
                  <td className="px-3 py-2 text-status-neutral">{cfg.interval_days ? `${cfg.interval_days} days` : '—'}</td>
                  <td className="px-3 py-2 text-status-neutral">{cfg.last_service_date ? fmt(cfg.last_service_date) : '—'}</td>
                  <td className="px-3 py-2 text-status-neutral">{dueDate ? fmt(dueDate) : '—'}{daysLeft != null && state !== 'ok' && <span className={clsx('ml-1 text-[11px]', state === 'overdue' ? 'text-status-critical' : 'text-[#8a6d10]')}>({daysLeft < 0 ? `${-daysLeft}d ago` : `in ${daysLeft}d`})</span>}</td>
                  <td className="px-3 py-2"><StatusBadge tone={PM_META[state].tone}>{PM_META[state].label}</StatusBadge></td>
                  {canManage && <td className="px-3 py-2 text-right"><button onClick={() => setEditing({ fleet_no: v.fleet_no, reg_no: v.reg_plate })} className="inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-xs font-medium text-navy hover:bg-canvas"><Wrench size={12} /> Service</button></td>}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={canManage ? 6 : 5} className="px-4 py-12 text-center text-sm text-status-neutral"><CalendarClock size={22} className="mx-auto mb-2 text-status-neutral/60" />No buses.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
      <ServiceModal target={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function ServiceModal({ target, onClose }: { target: { fleet_no: string; reg_no: string } | null; onClose: () => void }) {
  const [f, setF] = useState<PmConfig>(DEFAULT_PM)
  const [key, setKey] = useState('')
  if (target && key !== target.fleet_no) { setKey(target.fleet_no); setF(pmStore.for(target.fleet_no)) }
  if (!target) return null
  function set<K extends keyof PmConfig>(k: K, v: PmConfig[K]) { setF((p) => ({ ...p, [k]: v })) }
  function serviceToday() { setF((p) => ({ ...p, last_service_date: new Date().toISOString().slice(0, 10) })) }
  function save() { pmStore.set(target!.fleet_no, { ...f, interval_days: Number(f.interval_days) || 0, last_service_odo: Number(f.last_service_odo) || 0 }); onClose() }
  const preview = pmStatus({ ...f, interval_days: Number(f.interval_days) || 0 }, new Date().toISOString().slice(0, 10))
  return (
    <Modal open={!!target} onClose={onClose} title={`Service — ${target.fleet_no}`} subtitle="Set the service interval and record the last service done."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Service interval (days)</span><input type="number" className={inputCls} value={f.interval_days || ''} onChange={(e) => set('interval_days', Number(e.target.value))} /></label>
        <div />
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Last service date</span><input type="date" className={inputCls} value={f.last_service_date} onChange={(e) => set('last_service_date', e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Odometer at service</span><input type="number" className={inputCls} value={f.last_service_odo || ''} onChange={(e) => set('last_service_odo', Number(e.target.value))} /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Notes</span><input className={inputCls} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" type="button" onClick={serviceToday}><Wrench size={14} /> Serviced today</Button>
        {preview.dueDate && <span className="text-[11px] text-status-neutral">Next due <b className="text-navy">{fmt(preview.dueDate)}</b> ({PM_META[preview.state].label}).</span>}
      </div>
    </Modal>
  )
}
