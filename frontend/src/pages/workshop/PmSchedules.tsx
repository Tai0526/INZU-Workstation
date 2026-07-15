import { useMemo, useState } from 'react'
import { CalendarClock, Wrench, Search, Download, Gauge } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import { useVehicles } from '@/lib/fleet/store'
import { useIssuances } from '@/lib/fuel/store'
import { latestOdometer } from '@/lib/fuel/types'
import { usePm, pmStore } from '@/lib/workshop/store'
import { type PmConfig, DEFAULT_PM, pmService, PM_META, type PmState } from '@/lib/workshop/types'
import { downloadTablePdf } from '@/lib/reports/pdfDoc'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const selectCls = 'rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const fmt = (iso: string) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso } }
const km = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString()} km`)
const RANK: Record<PmState, number> = { overdue: 0, soon: 1, unset: 2, ok: 3 }

export default function PmSchedules() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'workshop')

  const vehicles = useVehicles().filter((v) => v.branch === branch)
  const issuances = useIssuances().filter((i) => i.branch === branch)
  usePm() // reactivity
  const today = new Date().toISOString().slice(0, 10)
  const [q, setQ] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | PmState>('all')
  const [editing, setEditing] = useState<{ fleet_no: string; reg_no: string; latestOdo: number | null } | null>(null)

  const odoByFleet = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const v of vehicles) m.set(v.fleet_no, latestOdometer(issuances, v.fleet_no))
    return m
  }, [vehicles, issuances])

  const all = useMemo(() => {
    const term = q.trim().toLowerCase()
    return vehicles
      .filter((v) => !term || v.fleet_no.toLowerCase().includes(term) || v.reg_plate.toLowerCase().includes(term))
      .map((v) => { const cfg = pmStore.for(v.fleet_no); return { v, cfg, ...pmService(cfg, odoByFleet.get(v.fleet_no) ?? null, today) } })
      .sort((a, b) => RANK[a.state] - RANK[b.state] || b.progress - a.progress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles, q, today, odoByFleet, pmStore.get()])

  const rows = all.filter((r) => stateFilter === 'all' || r.state === stateFilter)
  const counts = {
    overdue: all.filter((r) => r.state === 'overdue').length,
    soon: all.filter((r) => r.state === 'soon').length,
    unset: all.filter((r) => r.state === 'unset').length,
  }

  const remaining = (r: (typeof all)[number]) =>
    r.kmLeft != null ? (r.kmLeft < 0 ? `${km(-r.kmLeft)} over` : `${km(r.kmLeft)} left`)
      : r.daysLeft != null ? (r.daysLeft < 0 ? `${-r.daysLeft}d over` : `in ${r.daysLeft}d`) : '—'

  function exportPdf() {
    const pdfRows = rows.map((r) => [
      `${r.v.fleet_no}\n${r.v.reg_plate}`,
      [r.cfg.interval_km ? km(r.cfg.interval_km) : '', r.cfg.interval_days ? `${r.cfg.interval_days} d` : ''].filter(Boolean).join(' / ') || '—',
      r.cfg.last_service_date ? [r.cfg.last_service_odo ? km(r.cfg.last_service_odo) : '', fmt(r.cfg.last_service_date)].filter(Boolean).join(' · ') : '—',
      km(r.latestOdo),
      [r.dueOdo != null ? km(r.dueOdo) : '', r.dueDate ? fmt(r.dueDate) : ''].filter(Boolean).join(' · ') || '—',
      remaining(r),
      PM_META[r.state].label,
    ])
    downloadTablePdf({
      title: `PM / Service Schedule — ${branchLabel}`,
      subtitle: `${counts.overdue} overdue · ${counts.soon} due soon · generated ${today}`,
      tables: [{ head: ['Bus', 'Interval', 'Last service', 'Latest odo', 'Next due', 'Remaining', 'Status'], rows: pdfRows.length ? pdfRows : [['—', '—', '—', '—', '—', '—', '—']], columnStyles: { 0: { cellWidth: 72, fontStyle: 'bold' } } }],
      landscape: true, dense: true,
      filename: `PM Schedule - ${branchLabel} - ${today}.pdf`,
    })
  }

  return (
    <div className="page space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          Service schedule per bus for <span className="font-medium text-navy">{branchLabel}</span>. Set a distance interval (e.g. every 10,000 km) and/or a time interval — the live odometer is read from <span className="font-medium text-navy">Fuel</span>, so the bar counts down as buses are refuelled. Due &amp; overdue rise to the top.
        </p>
        <Button variant="secondary" onClick={exportPdf}><Download size={15} /> Export</Button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:max-w-md">
        <div className={`rounded-xl border px-3 py-2 ${counts.overdue ? 'border-status-critical/40 bg-status-critical/5' : 'border-black/10 bg-white'}`}><div className={`text-lg font-bold leading-none ${counts.overdue ? 'text-status-critical' : 'text-navy'}`}>{counts.overdue}</div><div className="mt-0.5 text-[11px] text-status-neutral">Overdue</div></div>
        <div className={`rounded-xl border px-3 py-2 ${counts.soon ? 'border-status-warning/40 bg-status-warning/10' : 'border-black/10 bg-white'}`}><div className={`text-lg font-bold leading-none ${counts.soon ? 'text-[#8a6d10]' : 'text-navy'}`}>{counts.soon}</div><div className="mt-0.5 text-[11px] text-status-neutral">Due soon</div></div>
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{counts.unset}</div><div className="mt-0.5 text-[11px] text-status-neutral">Not scheduled</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bus…" className="w-52 rounded-lg border border-black/15 bg-white py-2 pl-8 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as any)} className={selectCls}>
          <option value="all">All statuses</option>
          <option value="overdue">Overdue</option>
          <option value="soon">Due soon</option>
          <option value="ok">On schedule</option>
          <option value="unset">Not scheduled</option>
        </select>
        <span className="text-[11px] text-status-neutral">{rows.length} shown</span>
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white">
              <tr>
                <th className="px-3 py-2.5 font-medium">Bus</th><th className="px-3 py-2.5 font-medium">Interval</th>
                <th className="px-3 py-2.5 font-medium">Last service</th><th className="px-3 py-2.5 font-medium">Latest odo</th>
                <th className="px-3 py-2.5 font-medium">Next due</th><th className="px-3 py-2.5 font-medium">To next service</th>
                <th className="px-3 py-2.5 font-medium">Status</th>{canManage && <th className="px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.v.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-3 py-2 font-medium text-navy">{r.v.fleet_no}<div className="text-[11px] font-normal text-status-neutral">{r.v.reg_plate}</div></td>
                  <td className="px-3 py-2 text-status-neutral">{[r.cfg.interval_km ? km(r.cfg.interval_km) : '', r.cfg.interval_days ? `${r.cfg.interval_days} d` : ''].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="px-3 py-2 text-status-neutral">{r.cfg.last_service_date ? <>{r.cfg.last_service_odo ? <span>{km(r.cfg.last_service_odo)}<br /></span> : ''}{fmt(r.cfg.last_service_date)}</> : '—'}</td>
                  <td className="px-3 py-2 text-navy">{r.latestOdo != null ? <span className="inline-flex items-center gap-1"><Gauge size={12} className="text-status-neutral" /> {km(r.latestOdo)}</span> : <span className="text-status-neutral">no fuel data</span>}</td>
                  <td className="px-3 py-2 text-status-neutral">{[r.dueOdo != null ? km(r.dueOdo) : '', r.dueDate ? fmt(r.dueDate) : ''].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2">
                    {r.state === 'unset' ? <span className="text-[11px] text-status-neutral">—</span> : (
                      <div className="min-w-[7rem]">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-black/10">
                          <div className={clsx('h-full rounded-full', r.state === 'overdue' ? 'bg-status-critical' : r.state === 'soon' ? 'bg-status-warning' : 'bg-status-good')} style={{ width: `${Math.min(100, Math.round(r.progress * 100))}%` }} />
                        </div>
                        <div className={clsx('mt-0.5 text-[10px]', r.state === 'overdue' ? 'text-status-critical' : r.state === 'soon' ? 'text-[#8a6d10]' : 'text-status-neutral')}>{remaining(r)}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2"><StatusBadge tone={PM_META[r.state].tone}>{PM_META[r.state].label}</StatusBadge></td>
                  {canManage && <td className="px-3 py-2 text-right"><button onClick={() => setEditing({ fleet_no: r.v.fleet_no, reg_no: r.v.reg_plate, latestOdo: r.latestOdo })} className="inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-xs font-medium text-navy hover:bg-canvas"><Wrench size={12} /> Service</button></td>}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={canManage ? 8 : 7} className="px-4 py-12 text-center text-sm text-status-neutral"><CalendarClock size={22} className="mx-auto mb-2 text-status-neutral/60" />No buses match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
      <ServiceModal target={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function ServiceModal({ target, onClose }: { target: { fleet_no: string; reg_no: string; latestOdo: number | null } | null; onClose: () => void }) {
  const [f, setF] = useState<PmConfig>(DEFAULT_PM)
  const [key, setKey] = useState('')
  if (target && key !== target.fleet_no) { setKey(target.fleet_no); setF({ ...DEFAULT_PM, ...pmStore.for(target.fleet_no) }) }
  if (!target) return null
  function set<K extends keyof PmConfig>(k: K, v: PmConfig[K]) { setF((p) => ({ ...p, [k]: v })) }
  function serviceToday() { setF((p) => ({ ...p, last_service_date: new Date().toISOString().slice(0, 10), last_service_odo: target!.latestOdo ?? p.last_service_odo })) }
  function save() { pmStore.set(target!.fleet_no, { ...f, interval_days: Number(f.interval_days) || 0, interval_km: Number(f.interval_km) || 0, last_service_odo: Number(f.last_service_odo) || 0 }); onClose() }
  const preview = pmService({ ...f, interval_days: Number(f.interval_days) || 0, interval_km: Number(f.interval_km) || 0, last_service_odo: Number(f.last_service_odo) || 0 }, target.latestOdo, new Date().toISOString().slice(0, 10))
  return (
    <Modal open={!!target} onClose={onClose} title={`Service — ${target.fleet_no}`} subtitle="Set the service interval (by distance and/or time) and record the last service. The odometer is read live from Fuel."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Interval — distance (km)</span><input type="number" className={inputCls} placeholder="e.g. 10000" value={f.interval_km || ''} onChange={(e) => set('interval_km', Number(e.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Interval — time (days, optional)</span><input type="number" className={inputCls} placeholder="e.g. 90" value={f.interval_days || ''} onChange={(e) => set('interval_days', Number(e.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Last service date</span><input type="date" className={inputCls} value={f.last_service_date} onChange={(e) => set('last_service_date', e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Odometer at last service (km)</span><input type="number" className={inputCls} value={f.last_service_odo || ''} onChange={(e) => set('last_service_odo', Number(e.target.value))} /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Notes</span><input className={inputCls} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" type="button" onClick={serviceToday}><Wrench size={14} /> Serviced today{target.latestOdo != null ? ` at ${km(target.latestOdo)}` : ''}</Button>
        {target.latestOdo != null && <span className="text-[11px] text-status-neutral">Latest odo from Fuel: <b className="text-navy">{km(target.latestOdo)}</b></span>}
      </div>
      {preview.state !== 'unset' && (
        <p className="mt-2 text-[11px] text-status-neutral">
          Next service {preview.dueOdo != null ? <>at <b className="text-navy">{km(preview.dueOdo)}</b></> : ''}{preview.dueOdo != null && preview.dueDate ? ' or ' : ''}{preview.dueDate ? <>by <b className="text-navy">{fmt(preview.dueDate)}</b></> : ''} — <b className={preview.state === 'overdue' ? 'text-status-critical' : preview.state === 'soon' ? 'text-[#8a6d10]' : 'text-status-good'}>{PM_META[preview.state].label}</b>{preview.kmLeft != null ? ` (${preview.kmLeft < 0 ? `${km(-preview.kmLeft)} over` : `${km(preview.kmLeft)} left`})` : ''}.
        </p>
      )}
    </Modal>
  )
}
