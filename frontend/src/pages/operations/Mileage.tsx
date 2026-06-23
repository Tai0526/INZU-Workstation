import { Fragment, useMemo, useState } from 'react'
import { Plus, Upload, Download, Trash2, Pencil, FileSpreadsheet, FileText, Settings, Lock, CheckCircle2, AlertTriangle, UploadCloud, Route as RouteIcon } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import KpiCard from '@/components/ui/KpiCard'
import { useVehicles } from '@/lib/fleet/store'
import { useFuelRate } from '@/lib/fuel/store'
import { type Currency, money as fmtMoney } from '@/lib/fuel/types'
import {
  useMileageTrips, useMileageRoutes, useMileageRates, useSignatories,
  tripsStore, mileageRoutesStore, editTrip, setMileageRates, setSignatories,
} from '@/lib/mileage/store'
import {
  type MileageTrip, type SeatClass, type Shift, type MileageRates, type Signatories,
  PROJECTS_BY_BRANCH, SEAT_CLASSES, SEAT_LABEL, SHIFTS, classFromCapacity, summarise, vehicleSheet, tripKm, routeTotal,
} from '@/lib/mileage/types'
import { exportWorkbook, printSummaryPDF, exportTrips, downloadTripTemplate, parseTrips, type TripImport } from '@/lib/mileage/excel'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const cellCls = 'w-full rounded-md border border-black/15 bg-white px-2 py-1 text-xs text-navy outline-none focus:border-brand'
// Compact, content-width select for the page filters (month / vehicle).
const selCls = 'rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-brand'
const monthKey = (d: string) => d.slice(0, 7)
const monthLabel = (k: string) => { if (!k) return '—'; const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short', year: 'numeric' }) }
const dayShort = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en', { day: '2-digit', month: 'short' })

type Tab = 'log' | 'vehicle' | 'summary' | 'setup'

export default function Mileage() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchShort = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'operations')

  const projects = PROJECTS_BY_BRANCH[branch]
  const [project, setProject] = useState(projects[0])
  const [tab, setTab] = useState<Tab>('log')

  const allTrips = useMileageTrips()
  const routes = useMileageRoutes().filter((r) => r.branch === branch && r.project === project)
  const rates = useMileageRates(branch)
  const vehicles = useVehicles().filter((v) => v.branch === branch)

  const trips = useMemo(
    () => allTrips.filter((t) => t.branch === branch && t.project === project),
    [allTrips, branch, project],
  )

  // Route Supervisors cannot see mileage totals (spec §4.3.3 / §4.5.4) — guard AFTER hooks.
  if (role === 'route_supervisor') {
    return (
      <div className="page">
        <div className="card flex flex-col items-center gap-2 px-6 py-16 text-center text-status-neutral">
          <Lock size={26} /><p className="text-sm">Mileage totals aren't part of the Route Supervisor view.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-xl text-sm text-status-neutral">
          Daily bus movements split into internal &amp; external kilometres, rolled up into a costed monthly reconciliation for FQM {branchShort} billing.
        </p>
        {projects.length > 1 && (
          <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-black/15">
            {projects.map((p) => (
              <button key={p} onClick={() => setProject(p)} className={clsx('px-3 py-1.5 text-sm font-medium', project === p ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas')}>{p}</button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-black/10">
        {([['log', 'Daily log'], ['vehicle', 'Vehicle movements'], ['summary', 'Billing summary'], ...(canManage ? [['setup', 'Setup'] as [Tab, string]] : [])] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={clsx('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === k ? 'border-brand text-navy' : 'border-transparent text-status-neutral hover:text-navy')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'log' && <LogTab trips={trips} branch={branch} project={project} routes={routes} vehicles={vehicles} canManage={canManage} />}
      {tab === 'vehicle' && <VehicleTab trips={trips} project={project} />}
      {tab === 'summary' && <SummaryTab trips={trips} rates={rates} branch={branch} branchShort={branchShort} project={project} />}
      {tab === 'setup' && canManage && <SetupTab branch={branch} project={project} rates={rates} routes={routes} />}

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchShort} · {project}.</p>}
    </div>
  )
}

// ── Daily log tab ──────────────────────────────────────────────────────
function LogTab({ trips, branch, project, routes, vehicles, canManage }: { trips: MileageTrip[]; branch: BranchCode; project: string; routes: any[]; vehicles: any[]; canManage: boolean }) {
  const curMonth = new Date().toISOString().slice(0, 7)
  const months = useMemo(() => [...new Set([curMonth, ...trips.map((t) => monthKey(t.date))])].sort().reverse(), [trips])
  const [month, setMonth] = useState('')
  const effMonth = months.includes(month) ? month : curMonth
  const [vehicleFilter, setVehicleFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editing, setEditing] = useState<MileageTrip | null>(null)

  const rows = useMemo(
    () => trips
      .filter((t) => (effMonth ? monthKey(t.date) === effMonth : true))
      .filter((t) => vehicleFilter === 'all' || t.fleet_no === vehicleFilter)
      .sort((a, b) => b.date.localeCompare(a.date) || a.fleet_no.localeCompare(b.fleet_no, undefined, { numeric: true }) || SHIFTS.indexOf(a.shift) - SHIFTS.indexOf(b.shift)),
    [trips, effMonth, vehicleFilter],
  )
  const fleets = [...new Set(trips.map((t) => t.fleet_no))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={effMonth} onChange={(e) => setMonth(e.target.value)} className={selCls}>
          {months.length === 0 && <option value="">—</option>}
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)} className={selCls}>
          <option value="all">All buses</option>
          {fleets.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => exportTrips(rows, project)}><Download size={15} /> Export</Button>
          {canManage && <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Bulk upload</Button>}
          {canManage && <Button onClick={() => setAddOpen(true)}><Plus size={15} /> Log movements</Button>}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-3 py-2.5 font-medium">Date</th><th className="px-3 py-2.5 font-medium">Bus</th>
                <th className="px-3 py-2.5 font-medium">Class</th><th className="px-3 py-2.5 font-medium">Shift</th>
                <th className="px-3 py-2.5 font-medium">Route</th><th className="px-3 py-2.5 text-right font-medium">Internal</th>
                <th className="px-3 py-2.5 text-right font-medium">External</th><th className="px-3 py-2.5 text-right font-medium">Total</th>
                {canManage && <th className="px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={t.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-3 py-2 text-navy">
                    <div className="flex items-center gap-1.5">{dayShort(t.date)}
                      {t.edited_at && <span title={`Edited by ${t.edited_by} on ${new Date(t.edited_at).toLocaleString()}`} className="rounded-full bg-status-warning/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#8a6d10]">edited</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-medium text-navy">{t.fleet_no}<span className="ml-1 text-[11px] text-status-neutral">{t.vehicle_reg}</span></td>
                  <td className="px-3 py-2 text-status-neutral">{SEAT_LABEL[t.seat_class]}</td>
                  <td className="px-3 py-2 text-status-neutral">{t.shift}</td>
                  <td className="px-3 py-2 text-navy">{t.route || '—'}</td>
                  <td className="px-3 py-2 text-right text-status-neutral">{t.internal_km || '—'}</td>
                  <td className="px-3 py-2 text-right text-status-neutral">{t.external_km || '—'}</td>
                  <td className="px-3 py-2 text-right font-medium text-navy">{tripKm(t)}</td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setEditing(t)} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Edit"><Pencil size={14} /></button>
                        <button onClick={() => confirm('Remove this movement?') && tripsStore.remove(t.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={canManage ? 9 : 8} className="px-4 py-12 text-center text-sm text-status-neutral">No movements logged. {canManage && 'Log movements or bulk-upload a vehicle sheet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <AddTripsModal open={addOpen} onClose={() => setAddOpen(false)} branch={branch} project={project} routes={routes} vehicles={vehicles} />
      <EditTripModal editing={editing} onClose={() => setEditing(null)} routes={routes} vehicles={vehicles} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} branch={branch} project={project} />
    </div>
  )
}

// ── Log movements (multi-row) ──────────────────────────────────────────
interface Draft { date: string; shift: Shift; route: string; internal_km: string; external_km: string }
const draft = (date = '', shift: Shift = 'Morning'): Draft => ({ date, shift, route: '', internal_km: '', external_km: '' })

function AddTripsModal({ open, onClose, branch, project, routes, vehicles }: { open: boolean; onClose: () => void; branch: BranchCode; project: string; routes: any[]; vehicles: any[] }) {
  const [fleet, setFleet] = useState(''); const [reg, setReg] = useState(''); const [seat, setSeat] = useState<SeatClass>('40')
  const [rows, setRows] = useState<Draft[]>([draft('2026-06-01', 'Morning'), draft('2026-06-01', 'Evening')])
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setFleet(''); setReg(''); setSeat('40'); setRows([draft('2026-06-01', 'Morning'), draft('2026-06-01', 'Evening')]) }
  if (!open && wasOpen) setWasOpen(false)

  function onFleet(v: string) { setFleet(v); const veh = vehicles.find((x: any) => x.fleet_no.toLowerCase() === v.toLowerCase()); if (veh) { setReg(veh.reg_plate); setSeat(classFromCapacity(veh.capacity)) } }
  function setRow(i: number, patch: Partial<Draft>) { setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r))) }
  function onRoute(i: number, name: string) {
    const r = routes.find((x: any) => x.name === name)
    setRow(i, { route: name, ...(r ? { internal_km: String(r.internal_km), external_km: String(r.external_km) } : {}) })
  }
  const ready = rows.filter((r) => r.date && (Number(r.internal_km) > 0 || Number(r.external_km) > 0))

  function save() {
    ready.forEach((r) => tripsStore.add({
      branch, project, date: r.date, fleet_no: fleet.trim(), vehicle_reg: reg.trim(), seat_class: seat, shift: r.shift,
      route: r.route.trim(), internal_km: Number(r.internal_km) || 0, external_km: Number(r.external_km) || 0,
    }))
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} size="xl" title={`Log bus movements — ${project}`}
      subtitle="One row per run/shift. Pick a route to auto-fill the internal/external split (editable)."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={ready.length === 0 || !fleet.trim()}>Save {ready.length} run{ready.length === 1 ? '' : 's'}</Button></>}>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Fleet No</span><input list="dl-mil-fleet" className={inputCls} placeholder="INZ 121" value={fleet} onChange={(e) => onFleet(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reg No</span><input className={inputCls} placeholder="BCG 4271" value={reg} onChange={(e) => setReg(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Bus class</span>
          <select className={inputCls} value={seat} onChange={(e) => setSeat(e.target.value as SeatClass)}>{SEAT_CLASSES.map((s) => <option key={s} value={s}>{SEAT_LABEL[s]}</option>)}</select></label>
      </div>
      <datalist id="dl-mil-fleet">{vehicles.map((v: any) => <option key={v.id} value={v.fleet_no} />)}</datalist>

      <div className="overflow-x-auto rounded-lg border border-black/10">
        <table className="w-full text-left">
          <thead className="bg-canvas text-[10px] uppercase tracking-wide text-status-neutral">
            <tr>
              <th className="px-2 py-1.5 font-medium">Date</th><th className="px-2 py-1.5 font-medium">Shift</th><th className="px-2 py-1.5 font-medium">Route</th>
              <th className="px-2 py-1.5 font-medium">Internal km</th><th className="px-2 py-1.5 font-medium">External km</th><th className="px-2 py-1.5 font-medium">Total</th><th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-black/5">
                <td className="px-1.5 py-1"><input type="date" className={cellCls} value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} /></td>
                <td className="px-1.5 py-1"><select className={cellCls} value={r.shift} onChange={(e) => setRow(i, { shift: e.target.value as Shift })}>{SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                <td className="px-1.5 py-1"><select className={cellCls} value={r.route} onChange={(e) => onRoute(i, e.target.value)}><option value="">Route…</option>{routes.map((x: any) => <option key={x.id} value={x.name}>{x.name}</option>)}</select></td>
                <td className="px-1.5 py-1"><input type="number" className={cellCls} value={r.internal_km} onChange={(e) => setRow(i, { internal_km: e.target.value })} /></td>
                <td className="px-1.5 py-1"><input type="number" className={cellCls} value={r.external_km} onChange={(e) => setRow(i, { external_km: e.target.value })} /></td>
                <td className="px-2 py-1 text-xs font-medium text-navy">{(Number(r.internal_km) || 0) + (Number(r.external_km) || 0)}</td>
                <td className="px-1.5 py-1"><button onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => setRows((rs) => [...rs, draft(rs[rs.length - 1]?.date ?? '')])} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs font-medium text-brand hover:border-brand"><Plus size={14} /> Add row</button>
      {routes.length === 0 && <p className="mt-1 rounded-lg bg-brand-tint/40 px-3 py-2 text-[11px] text-[#8a4513]">No routes for {project} yet — add them under Setup → Route catalogue to auto-fill the internal/external split.</p>}
    </Modal>
  )
}

function EditTripModal({ editing, onClose, routes, vehicles }: { editing: MileageTrip | null; onClose: () => void; routes: any[]; vehicles: any[] }) {
  const [f, setF] = useState<MileageTrip | null>(null)
  const [lastKey, setLastKey] = useState('')
  const key = editing?.id ?? ''
  if (key !== lastKey) { setLastKey(key); setF(editing ? { ...editing } : null) }
  if (!editing || !f) return null

  function set<K extends keyof MileageTrip>(k: K, v: MileageTrip[K]) { setF((p) => (p ? { ...p, [k]: v } : p)) }
  function onFleet(v: string) { const veh = vehicles.find((x: any) => x.fleet_no.toLowerCase() === v.toLowerCase()); setF((p) => (p ? { ...p, fleet_no: v, vehicle_reg: veh ? veh.reg_plate : p.vehicle_reg } : p)) }
  function onRoute(name: string) { const r = routes.find((x: any) => x.name === name); setF((p) => (p ? { ...p, route: name, ...(r ? { internal_km: r.internal_km, external_km: r.external_km } : {}) } : p)) }
  function save() {
    editTrip(editing!.id, {
      date: f!.date, fleet_no: f!.fleet_no.trim(), vehicle_reg: f!.vehicle_reg.trim(), seat_class: f!.seat_class, shift: f!.shift,
      route: f!.route, internal_km: Number(f!.internal_km) || 0, external_km: Number(f!.external_km) || 0,
    })
    onClose()
  }
  return (
    <Modal open={!!editing} onClose={onClose} size="lg" title={`Edit movement — ${f.fleet_no}`} subtitle="Changes are stamped with who edited and when."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save changes</Button></>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Date</span><input type="date" className={inputCls} value={f.date} onChange={(e) => set('date', e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Fleet No</span><input list="dl-mil-fleet-e" className={inputCls} value={f.fleet_no} onChange={(e) => onFleet(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reg No</span><input className={inputCls} value={f.vehicle_reg} onChange={(e) => set('vehicle_reg', e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Bus class</span><select className={inputCls} value={f.seat_class} onChange={(e) => set('seat_class', e.target.value as SeatClass)}>{SEAT_CLASSES.map((s) => <option key={s} value={s}>{SEAT_LABEL[s]}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Shift</span><select className={inputCls} value={f.shift} onChange={(e) => set('shift', e.target.value as Shift)}>{SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Route</span><select className={inputCls} value={f.route} onChange={(e) => onRoute(e.target.value)}><option value="">—</option>{routes.map((x: any) => <option key={x.id} value={x.name}>{x.name}</option>)}{f.route && !routes.some((x: any) => x.name === f.route) && <option value={f.route}>{f.route}</option>}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Internal km</span><input type="number" className={inputCls} value={f.internal_km || ''} onChange={(e) => set('internal_km', Number(e.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">External km</span><input type="number" className={inputCls} value={f.external_km || ''} onChange={(e) => set('external_km', Number(e.target.value))} /></label>
      </div>
      {f.edited_at && <p className="mt-3 text-[11px] text-status-neutral">Last edited by {f.edited_by} on {new Date(f.edited_at).toLocaleString()}</p>}
    </Modal>
  )
}

function ImportModal({ open, onClose, branch, project }: { open: boolean; onClose: () => void; branch: BranchCode; project: string }) {
  const [parsed, setParsed] = useState<TripImport | null>(null)
  const [done, setDone] = useState<number | null>(null)
  function close() { setParsed(null); setDone(null); onClose() }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    try { setParsed(await parseTrips(file, branch, project)) } catch { setParsed({ valid: [], errors: [{ row: 0, reason: 'Could not read file. Use the template.' }] }) }
    e.target.value = ''
  }
  function commit() { if (!parsed) return; tripsStore.bulkAdd(parsed.valid); setDone(parsed.valid.length); setParsed(null) }
  return (
    <Modal open={open} onClose={close} title={`Bulk upload movements — ${project}`} subtitle="Upload a sheet of daily runs. Columns: Date, Fleet, Reg, Seat class, Shift, Route, Internal km, External km."
      footer={done !== null ? <Button onClick={close}>Done</Button> : <><Button variant="secondary" onClick={close}>Cancel</Button><Button onClick={commit} disabled={!parsed || parsed.valid.length === 0}>Import {parsed?.valid.length ?? 0}</Button></>}>
      <div className="mb-3 flex items-center justify-between rounded-lg bg-canvas px-4 py-3">
        <div className="text-sm text-navy"><div className="font-medium">Template</div><div className="text-xs text-status-neutral">Internal/external split per run.</div></div>
        <Button variant="secondary" onClick={downloadTripTemplate}><Download size={15} /> Template</Button>
      </div>
      {done === null && (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-navy/20 bg-white px-6 py-8 text-center hover:border-brand">
          <UploadCloud size={26} className="text-brand" /><span className="text-sm font-medium text-navy">Choose an .xlsx file</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
        </label>
      )}
      {parsed && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-status-good/30 bg-status-good/5 px-3 py-2 text-sm text-status-good"><CheckCircle2 size={16} /> {parsed.valid.length} movement(s) ready</div>
          {parsed.errors.length > 0 && <div className="rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-xs text-status-critical"><AlertTriangle size={14} className="mr-1 inline" />{parsed.errors.length} row(s) skipped</div>}
        </div>
      )}
      {done !== null && <div className="mt-4 flex flex-col items-center gap-2 rounded-xl bg-canvas px-6 py-8 text-center"><CheckCircle2 size={26} className="text-status-good" /><div className="font-display text-base font-semibold text-navy">Imported {done}</div></div>}
    </Modal>
  )
}

// ── Vehicle movements tab ──────────────────────────────────────────────
function VehicleTab({ trips, project }: { trips: MileageTrip[]; project: string }) {
  const curMonth = new Date().toISOString().slice(0, 7)
  const months = useMemo(() => [...new Set([curMonth, ...trips.map((t) => monthKey(t.date))])].sort().reverse(), [trips])
  const [month, setMonth] = useState('')
  const effMonth = months.includes(month) ? month : curMonth
  const monthTrips = useMemo(() => trips.filter((t) => monthKey(t.date) === effMonth), [trips, effMonth])
  const fleets = useMemo(() => [...new Map(monthTrips.map((t) => [t.fleet_no, t])).values()].map((t) => ({ fleet_no: t.fleet_no, vehicle_reg: t.vehicle_reg, seat_class: t.seat_class })).sort((a, b) => a.fleet_no.localeCompare(b.fleet_no, undefined, { numeric: true })), [monthTrips])
  const [fleet, setFleet] = useState('')
  const effFleet = fleets.some((f) => f.fleet_no === fleet) ? fleet : (fleets[0]?.fleet_no ?? '')
  const meta = fleets.find((f) => f.fleet_no === effFleet)
  const sheet = useMemo(() => vehicleSheet(monthTrips, effFleet), [monthTrips, effFleet])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={effMonth} onChange={(e) => setMonth(e.target.value)} className={selCls}>
          {months.length === 0 && <option value="">—</option>}
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select value={effFleet} onChange={(e) => setFleet(e.target.value)} className={selCls}>
          {fleets.length === 0 && <option value="">—</option>}
          {fleets.map((f) => <option key={f.fleet_no} value={f.fleet_no}>{f.fleet_no} · {f.vehicle_reg}</option>)}
        </select>
      </div>

      {meta && (
        <div className="grid grid-cols-3 gap-3">
          <KpiCard label="Internal total" value={`${sheet.internal.toLocaleString()} km`} />
          <KpiCard label="External total" value={`${sheet.external.toLocaleString()} km`} />
          <KpiCard label="Combined total" value={`${sheet.total.toLocaleString()} km`} highlight sub={`${SEAT_LABEL[meta.seat_class]} · ${monthLabel(effMonth)}`} />
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">{effFleet || '—'} — daily movements</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-navy text-white">
                <th rowSpan={2} className="px-3 py-2 align-bottom font-medium">Date</th>
                {SHIFTS.map((s) => <th key={s} colSpan={3} className="border-l border-white/15 px-3 py-1.5 text-center font-medium">{s}</th>)}
                <th rowSpan={2} className="border-l border-white/15 px-3 py-2 text-right align-bottom font-medium">Daily total</th>
              </tr>
              <tr className="bg-navy-secondary text-[11px] text-white/80">
                {SHIFTS.map((s) => (
                  <Fragment key={s}>
                    <th className="border-l border-white/15 px-3 py-1 font-medium">Route</th>
                    <th className="px-2 py-1 text-right font-medium">Int</th>
                    <th className="px-2 py-1 text-right font-medium">Ext</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.days.map((d, i) => (
                <tr key={d.date} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-3 py-2 font-medium text-navy">{dayShort(d.date)}</td>
                  {SHIFTS.map((s) => {
                    const x = d.shifts[s]
                    return (
                      <Fragment key={s}>
                        <td className="border-l border-black/5 px-3 py-2 text-status-neutral">{x?.route ?? '—'}</td>
                        <td className="px-2 py-2 text-right text-status-neutral">{x?.internal || ''}</td>
                        <td className="px-2 py-2 text-right text-status-neutral">{x?.external || ''}</td>
                      </Fragment>
                    )
                  })}
                  <td className="border-l border-black/5 px-3 py-2 text-right font-medium text-navy">{d.total}</td>
                </tr>
              ))}
              {sheet.days.length === 0 && <tr><td colSpan={SHIFTS.length * 3 + 2} className="px-4 py-12 text-center text-sm text-status-neutral">No movements for this bus.</td></tr>}
            </tbody>
            {sheet.days.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-navy/20 bg-canvas font-medium text-navy">
                  <td className="px-3 py-2">Total</td>
                  <td colSpan={SHIFTS.length * 3} className="px-3 py-2 text-right text-status-neutral">Internal {sheet.internal.toLocaleString()} · External {sheet.external.toLocaleString()}</td>
                  <td className="border-l border-black/5 px-3 py-2 text-right">{sheet.total.toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Billing summary tab ────────────────────────────────────────────────
function SummaryTab({ trips, rates, branch, branchShort, project }: { trips: MileageTrip[]; rates: MileageRates; branch: BranchCode; branchShort: string; project: string }) {
  const curMonth = new Date().toISOString().slice(0, 7)
  const months = useMemo(() => [...new Set([curMonth, ...trips.map((t) => monthKey(t.date))])].sort().reverse(), [trips])
  const [month, setMonth] = useState('')
  const effMonth = months.includes(month) ? month : curMonth
  const [cur, setCur] = useState<Currency>('USD')
  const fuelRate = useFuelRate(branch, effMonth)
  const sig = useSignatories(branch, project)

  const monthTrips = useMemo(() => trips.filter((t) => monthKey(t.date) === effMonth), [trips, effMonth])
  const summary = useMemo(() => summarise(monthTrips, rates), [monthTrips, rates])

  const fx = cur === 'ZMW' ? (fuelRate.fx_zmw_per_usd || 27) : 1
  const conv = (usd: number) => usd * fx
  const money = (usd: number) => fmtMoney(conv(usd), cur)

  const extSub = summary.classes.reduce((s, c) => s + c.external_amt, 0)
  const intSub = summary.classes.reduce((s, c) => s + c.internal_amt, 0)
  const cols = summary.classes

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={effMonth} onChange={(e) => setMonth(e.target.value)} className={clsx(selCls, 'font-medium')}>
          {months.length === 0 && <option value="">—</option>}
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
          {(['USD', 'ZMW'] as Currency[]).map((c) => (
            <button key={c} onClick={() => setCur(c)} className={clsx('px-3 py-2 text-sm font-medium', cur === c ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas')}>{c === 'USD' ? 'USD ($)' : 'ZMW (K)'}</button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => printSummaryPDF({ summary, signatories: sig, project, monthLabel: monthLabel(effMonth), branchShort })} disabled={!effMonth}><FileText size={15} /> PDF summary</Button>
          <Button onClick={() => exportWorkbook({ trips: monthTrips, rates, signatories: sig, project, monthLabel: monthLabel(effMonth), branchShort })} disabled={!effMonth}><FileSpreadsheet size={15} /> Export workbook</Button>
        </div>
      </div>

      {cur === 'ZMW' && <p className="text-[11px] text-status-neutral">Converted at K{fx.toFixed(2)}/USD (Bank of Zambia, {monthLabel(effMonth)}). FQM is invoiced in USD.</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Claimable km" value={summary.total_km.toLocaleString()} highlight sub={monthLabel(effMonth)} />
        <KpiCard label="Internal km" value={summary.internal_km.toLocaleString()} />
        <KpiCard label="External km" value={summary.external_km.toLocaleString()} />
        <KpiCard label="Sub-total" value={money(summary.subtotal)} />
        <KpiCard label={`VAT @${summary.vat_pct}%`} value={money(summary.vat)} tone="warning" />
        <KpiCard label="Total (VAT incl)" value={money(summary.total)} tone="good" />
      </div>

      {/* Billing reconciliation block */}
      <div className="card overflow-hidden">
        <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">Reconciliation — {project} · {monthLabel(effMonth)}</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium"> </th>
                {cols.map((c) => <th key={c.seat_class} className="px-4 py-2.5 font-medium">{SEAT_LABEL[c.seat_class]}</th>)}
                <th className="px-4 py-2.5 font-medium">Sub-Total</th><th className="px-4 py-2.5 font-medium">VAT @{summary.vat_pct}%</th><th className="px-4 py-2.5 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-black/5">
                <td className="px-4 py-2 text-left font-medium text-navy">Qty (buses)</td>
                {cols.map((c) => <td key={c.seat_class} className="px-4 py-2 text-status-neutral">{c.qty}</td>)}
                <td colSpan={3} />
              </tr>
              <tr className="border-t border-black/5">
                <td className="px-4 py-2 text-left font-medium text-navy">External mileage (km)</td>
                {cols.map((c) => <td key={c.seat_class} className="px-4 py-2 text-status-neutral">{c.external_km.toLocaleString()}</td>)}
                <td colSpan={3} />
              </tr>
              <tr className="border-t border-black/5">
                <td className="px-4 py-2 text-left font-medium text-navy">External amount</td>
                {cols.map((c) => <td key={c.seat_class} className="px-4 py-2 text-status-neutral">{money(c.external_amt)}</td>)}
                <td className="px-4 py-2 text-navy">{money(extSub)}</td><td className="px-4 py-2 text-status-neutral">{money(extSub * summary.vat_pct / 100)}</td><td className="px-4 py-2 text-navy">{money(extSub * (1 + summary.vat_pct / 100))}</td>
              </tr>
              {summary.hasInternal && <>
                <tr className="border-t border-black/5">
                  <td className="px-4 py-2 text-left font-medium text-navy">Internal mileage (km)</td>
                  {cols.map((c) => <td key={c.seat_class} className="px-4 py-2 text-status-neutral">{c.internal_km.toLocaleString()}</td>)}
                  <td colSpan={3} />
                </tr>
                <tr className="border-t border-black/5">
                  <td className="px-4 py-2 text-left font-medium text-navy">Internal amount</td>
                  {cols.map((c) => <td key={c.seat_class} className="px-4 py-2 text-status-neutral">{money(c.internal_amt)}</td>)}
                  <td className="px-4 py-2 text-navy">{money(intSub)}</td><td className="px-4 py-2 text-status-neutral">{money(intSub * summary.vat_pct / 100)}</td><td className="px-4 py-2 text-navy">{money(intSub * (1 + summary.vat_pct / 100))}</td>
                </tr>
              </>}
              <tr className="border-t-2 border-navy/20 bg-brand-tint/40 font-bold text-navy">
                <td className="px-4 py-2.5 text-left">Grand Total</td>
                {cols.map((c) => <td key={c.seat_class} />)}
                <td className="px-4 py-2.5">{money(summary.subtotal)}</td><td className="px-4 py-2.5">{money(summary.vat)}</td><td className="px-4 py-2.5">{money(summary.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily breakdown by bus class — mileage + cost */}
      <div className="card overflow-hidden">
        <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">Daily claimable &amp; cost by bus class</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th rowSpan={2} className="px-3 py-2 text-left align-bottom font-medium">Date</th>
                <th colSpan={cols.length * (summary.hasInternal ? 2 : 1)} className="border-l border-white/15 px-3 py-1.5 text-center font-medium">Mileage (km)</th>
                <th rowSpan={2} className="border-l border-white/15 px-3 py-2 align-bottom font-medium">Claimable km</th>
                <th colSpan={cols.length} className="border-l border-white/15 px-3 py-1.5 text-center font-medium">Cost ({cur})</th>
                <th rowSpan={2} className="border-l border-white/15 px-3 py-2 align-bottom font-medium">Day total</th>
              </tr>
              <tr className="bg-navy-secondary text-[11px] text-white/80">
                {cols.map((c) => summary.hasInternal ? (
                  <Fragment key={'hk' + c.seat_class}>
                    <th className="border-l border-white/15 px-2 py-1 font-medium">{SEAT_LABEL[c.seat_class]} Int</th>
                    <th className="px-2 py-1 font-medium">Ext</th>
                  </Fragment>
                ) : (
                  <th key={'hk' + c.seat_class} className="border-l border-white/15 px-2 py-1 font-medium">{SEAT_LABEL[c.seat_class]} Ext</th>
                ))}
                {cols.map((c) => <th key={'ha' + c.seat_class} className="border-l border-white/15 px-2 py-1 font-medium">{SEAT_LABEL[c.seat_class]}</th>)}
              </tr>
            </thead>
            <tbody>
              {summary.dailyByClass.map((row, i) => (
                <tr key={row.date} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-3 py-1.5 text-left font-medium text-navy">{dayShort(row.date)}</td>
                  {cols.map((c) => {
                    const cell = row.byClass[c.seat_class]
                    return summary.hasInternal ? (
                      <Fragment key={'k' + c.seat_class}>
                        <td className="border-l border-black/5 px-2 py-1.5 text-status-neutral">{cell?.internal || ''}</td>
                        <td className="px-2 py-1.5 text-status-neutral">{cell?.external || ''}</td>
                      </Fragment>
                    ) : (
                      <td key={'k' + c.seat_class} className="border-l border-black/5 px-2 py-1.5 text-status-neutral">{cell?.external || ''}</td>
                    )
                  })}
                  <td className="border-l border-black/5 px-3 py-1.5 font-medium text-navy">{row.claimable.toLocaleString()}</td>
                  {cols.map((c) => <td key={'a' + c.seat_class} className="border-l border-black/5 px-2 py-1.5 text-status-neutral">{money(row.byClass[c.seat_class]?.amount ?? 0)}</td>)}
                  <td className="border-l border-black/5 px-3 py-1.5 font-medium text-navy">{money(row.amount)}</td>
                </tr>
              ))}
              {summary.dailyByClass.length === 0 && <tr><td colSpan={cols.length * (summary.hasInternal ? 2 : 1) + cols.length + 3} className="px-4 py-12 text-center text-sm text-status-neutral">No movements for this month.</td></tr>}
            </tbody>
            {summary.dailyByClass.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-navy/20 bg-brand-tint/40 font-bold text-navy">
                  <td className="px-3 py-2 text-left">Month total</td>
                  {cols.map((c) => summary.hasInternal ? (
                    <Fragment key={'tk' + c.seat_class}>
                      <td className="border-l border-black/5 px-2 py-2">{c.internal_km.toLocaleString()}</td>
                      <td className="px-2 py-2">{c.external_km.toLocaleString()}</td>
                    </Fragment>
                  ) : (
                    <td key={'tk' + c.seat_class} className="border-l border-black/5 px-2 py-2">{c.external_km.toLocaleString()}</td>
                  ))}
                  <td className="border-l border-black/5 px-3 py-2">{summary.total_km.toLocaleString()}</td>
                  {cols.map((c) => <td key={'ta' + c.seat_class} className="border-l border-black/5 px-2 py-2">{money(c.subtotal)}</td>)}
                  <td className="border-l border-black/5 px-3 py-2">{money(summary.subtotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Daily claimable grid (per bus) */}
      <div className="card overflow-hidden">
        <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">Daily claimable kilometres — by bus</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Date</th>
                {summary.fleets.map((f) => <th key={f.fleet_no} className="px-3 py-2.5 font-medium" title={f.vehicle_reg}>{f.fleet_no}</th>)}
                <th className="border-l border-white/15 px-3 py-2.5 font-medium">Int</th><th className="px-3 py-2.5 font-medium">Ext</th>
                <th className="px-3 py-2.5 font-medium">Claimable</th><th className="px-3 py-2.5 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {summary.days.map((d, i) => (
                <tr key={d.date} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-3 py-1.5 text-left font-medium text-navy">{dayShort(d.date)}</td>
                  {summary.fleets.map((f) => <td key={f.fleet_no} className="px-3 py-1.5 text-status-neutral">{d.perFleet[f.fleet_no] || ''}</td>)}
                  <td className="border-l border-black/5 px-3 py-1.5 text-status-neutral">{d.internal.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-status-neutral">{d.external.toLocaleString()}</td>
                  <td className="px-3 py-1.5 font-medium text-navy">{d.claimable.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-status-neutral">{money(d.amount)}</td>
                </tr>
              ))}
              {summary.days.length === 0 && <tr><td colSpan={summary.fleets.length + 5} className="px-4 py-12 text-center text-sm text-status-neutral">No movements for this month.</td></tr>}
            </tbody>
            {summary.days.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-navy/20 bg-canvas font-medium text-navy">
                  <td className="px-3 py-2 text-left">Total</td>
                  {summary.fleets.map((f) => <td key={f.fleet_no} className="px-3 py-2">{summary.days.reduce((s, d) => s + (d.perFleet[f.fleet_no] || 0), 0).toLocaleString()}</td>)}
                  <td className="border-l border-black/5 px-3 py-2">{summary.internal_km.toLocaleString()}</td>
                  <td className="px-3 py-2">{summary.external_km.toLocaleString()}</td>
                  <td className="px-3 py-2">{summary.total_km.toLocaleString()}</td>
                  <td className="px-3 py-2">{money(summary.subtotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Signatures */}
      <div className="card grid grid-cols-1 gap-6 p-5 sm:grid-cols-2">
        <SignBlock title="INZU MCS Limited" rows={[['Prepared By', sig.inzu_prepared], ['Checked By', sig.inzu_checked], ['Authorised By', sig.inzu_authorised], ['Approved By', sig.inzu_approved]]} />
        <SignBlock title={`FQM ${branchShort}`} rows={[['Checked By', sig.fqm_checked], ['Approved By', sig.fqm_approved]]} />
      </div>
    </div>
  )
}

function SignBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand">{title}</h4>
      <div className="space-y-3">
        {rows.map(([label, name]) => (
          <div key={label} className="flex items-end gap-2 text-sm">
            <span className="w-24 shrink-0 text-status-neutral">{label}</span>
            <span className="flex-1 border-b border-navy/30 pb-0.5 font-medium text-navy">{name || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Setup tab (rates, routes, signatories) ─────────────────────────────
function SetupTab({ branch, project, rates, routes }: { branch: BranchCode; project: string; rates: MileageRates; routes: any[] }) {
  return (
    <div className="space-y-5">
      <RatesCard branch={branch} rates={rates} />
      <RoutesCard branch={branch} project={project} routes={routes} />
      <SignatoriesCard branch={branch} project={project} />
    </div>
  )
}

function RatesCard({ branch, rates }: { branch: BranchCode; rates: MileageRates }) {
  const [f, setF] = useState<MileageRates>(rates)
  const [savedAt, setSavedAt] = useState(0)
  const set = (k: keyof MileageRates, v: number) => setF((p) => ({ ...p, [k]: v }))
  function save() { setMileageRates(branch, { rate60: +f.rate60 || 0, rate40: +f.rate40 || 0, rate28: +f.rate28 || 0, vat_pct: +f.vat_pct || 0 }); setSavedAt(Date.now()) }
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center gap-2"><Settings size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Contract rates (USD/km) &amp; VAT</h3></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">60 Seater</span><input type="number" step="0.01" className={inputCls} value={f.rate60} onChange={(e) => set('rate60', Number(e.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">40 Seater</span><input type="number" step="0.01" className={inputCls} value={f.rate40} onChange={(e) => set('rate40', Number(e.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">15–28 Seater</span><input type="number" step="0.01" className={inputCls} value={f.rate28} onChange={(e) => set('rate28', Number(e.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">VAT %</span><input type="number" step="0.5" className={inputCls} value={f.vat_pct} onChange={(e) => set('vat_pct', Number(e.target.value))} /></label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save}>Save rates</Button>
        {savedAt > 0 && <span className="text-xs text-status-good">Saved.</span>}
      </div>
    </div>
  )
}

function RoutesCard({ branch, project, routes }: { branch: BranchCode; project: string; routes: any[] }) {
  const [name, setName] = useState(''); const [internal, setInternal] = useState(''); const [external, setExternal] = useState('')
  function add() { if (!name.trim()) return; mileageRoutesStore.add({ branch, project, name: name.trim(), internal_km: Number(internal) || 0, external_km: Number(external) || 0 }); setName(''); setInternal(''); setExternal('') }
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><RouteIcon size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Route catalogue — {project}</h3><span className="text-xs text-status-neutral">internal / external split auto-fills when logging</span></div>
      <div className="flex flex-wrap items-end gap-2 border-b border-black/5 bg-canvas/40 px-5 py-3">
        <label className="block flex-1"><span className="mb-1 block text-xs font-medium text-navy">Route name</span><input className={inputCls} placeholder="Resettlement - Housing" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block w-28"><span className="mb-1 block text-xs font-medium text-navy">Internal km</span><input type="number" className={inputCls} value={internal} onChange={(e) => setInternal(e.target.value)} /></label>
        <label className="block w-28"><span className="mb-1 block text-xs font-medium text-navy">External km</span><input type="number" className={inputCls} value={external} onChange={(e) => setExternal(e.target.value)} /></label>
        <Button onClick={add}><Plus size={15} /> Add</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-canvas text-status-neutral"><tr><th className="px-5 py-2 font-medium">Route</th><th className="px-4 py-2 text-right font-medium">Internal</th><th className="px-4 py-2 text-right font-medium">External</th><th className="px-4 py-2 text-right font-medium">Total</th><th className="px-4 py-2" /></tr></thead>
          <tbody>
            {routes.map((r: any) => (
              <tr key={r.id} className="border-t border-black/5">
                <td className="px-5 py-2 font-medium text-navy">{r.name}</td>
                <td className="px-4 py-2 text-right text-status-neutral">{r.internal_km}</td>
                <td className="px-4 py-2 text-right text-status-neutral">{r.external_km}</td>
                <td className="px-4 py-2 text-right font-medium text-navy">{routeTotal(r)}</td>
                <td className="px-4 py-2 text-right"><button onClick={() => confirm('Remove this route?') && mileageRoutesStore.remove(r.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button></td>
              </tr>
            ))}
            {routes.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-status-neutral">No routes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SignatoriesCard({ branch, project }: { branch: BranchCode; project: string }) {
  const current = useSignatories(branch, project)
  const [f, setF] = useState<Signatories>(current)
  const [lastKey, setLastKey] = useState('')
  const key = `${branch}:${project}`
  if (key !== lastKey) { setLastKey(key); setF(current) }
  const [savedAt, setSavedAt] = useState(0)
  const set = (k: keyof Signatories, v: string) => setF((p) => ({ ...p, [k]: v }))
  function save() { setSignatories(branch, project, f); setSavedAt(Date.now()) }
  const field = (label: string, k: keyof Signatories) => (
    <label className="block"><span className="mb-1 block text-xs font-medium text-navy">{label}</span><input className={inputCls} value={f[k]} onChange={(e) => set(k, e.target.value)} /></label>
  )
  return (
    <div className="card p-5">
      <h3 className="mb-3 font-display text-sm font-bold text-navy">Signatories — {project}</h3>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-brand">INZU MCS Limited</h4>
          {field('Prepared By', 'inzu_prepared')}{field('Checked By', 'inzu_checked')}{field('Authorised By', 'inzu_authorised')}{field('Approved By', 'inzu_approved')}
        </div>
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-brand">FQM</h4>
          {field('Checked By', 'fqm_checked')}{field('Approved By', 'fqm_approved')}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3"><Button onClick={save}>Save signatories</Button>{savedAt > 0 && <span className="text-xs text-status-good">Saved.</span>}</div>
    </div>
  )
}
