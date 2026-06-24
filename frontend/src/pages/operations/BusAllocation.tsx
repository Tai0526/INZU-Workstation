import { useMemo, useState } from 'react'
import {
  Plus, Pencil, Trash2, Upload, Download, CheckCircle2, AlertTriangle, UploadCloud, FileText, FileType, Mail,
  Clock, Users, Bus, Check, Minus, ArrowRightLeft,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useVehicles } from '@/lib/fleet/store'
import { useDrivers } from '@/lib/drivers/store'
import { useAllocations, allocationsStore, useDailyPlan } from '@/lib/operations/store'
import { type Allocation, type AllocationInput, type DailyPlanTrip, type TripType, TRIP_LABEL } from '@/lib/operations/types'
import { useLocations } from '@/lib/operations/locations'
import { downloadAllocTemplate, parseAllocations, exportAllocations, type AllocImportResult } from '@/lib/operations/excel'
import { exportReportWord, esc, type ReportInput } from '@/lib/reports/exporter'
import { downloadTablePdf, type PdfTable } from '@/lib/reports/pdfDoc'
import { useRecipients, recipientsStore, isValidEmail } from '@/lib/reports/recipients'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
// Build <select> options, keeping a current value that's no longer in the list visible.
const withCurrent = (val: string, opts: string[]) => (val && !opts.includes(val) ? [val, ...opts] : opts)
const today = () => new Date().toISOString().slice(0, 10)
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

// ── Reports (PDF + Word + email) — built from the actuals ─────────────────────
function allocReport(date: string, branchLabel: string, pickups: Allocation[], knockoffs: Allocation[]): ReportInput {
  const group = (label: string, runs: Allocation[]) => {
    const pax = runs.reduce((s, r) => s + (r.passengers ?? 0), 0)
    const rows = runs.map((r) => `<tr><td>${esc(r.driver_name || '—')}</td><td>${esc(r.fleet_no)}</td><td>${esc(r.reg_no)}</td><td>${esc(r.location)}</td><td>${esc(r.departure_time || '—')}</td><td class="num">${r.passengers ?? '—'}</td></tr>`).join('')
    const head = '<tr><th>Driver</th><th>Fleet No</th><th>Reg No</th><th>Route</th><th>Time</th><th class="num">Pax</th></tr>'
    const empty = '<tr><td colspan="6" style="text-align:center;color:#6B7280">None</td></tr>'
    const total = runs.length ? `<tr class="tot"><td colspan="5">Total passengers</td><td class="num">${pax}</td></tr>` : ''
    return `<h2>${label} — ${runs.length} run${runs.length === 1 ? '' : 's'}</h2><table><thead>${head}</thead><tbody>${rows || empty}${total}</tbody></table>`
  }
  const totalPax = pickups.concat(knockoffs).reduce((s, r) => s + (r.passengers ?? 0), 0)
  return {
    title: `Daily Bus Allocation — ${branchLabel}`,
    subtitle: `${date} · ${pickups.length + knockoffs.length} runs · ${totalPax} passengers`,
    body: group('Pickups', pickups) + group('Knock-offs', knockoffs),
    landscape: true,
    filenameBase: `Bus Allocation - ${branchLabel} - ${date}`,
  }
}
function allocPdf(date: string, branchLabel: string, pickups: Allocation[], knockoffs: Allocation[]) {
  const head = ['Driver', 'Fleet No', 'Reg No', 'Route', 'Time', 'Pax']
  const rowsOf = (runs: Allocation[]) => runs.map((r) => [r.driver_name || '-', r.fleet_no, r.reg_no, r.location, r.departure_time || '-', r.passengers ?? '-'])
  const totalPax = pickups.concat(knockoffs).reduce((s, r) => s + (r.passengers ?? 0), 0)
  const tables: PdfTable[] = [
    { heading: `Pickups (${pickups.length})`, head, rows: rowsOf(pickups) },
    { heading: `Knock-offs (${knockoffs.length})`, head, rows: rowsOf(knockoffs) },
  ]
  return {
    title: `Daily Bus Allocation — ${branchLabel}`,
    subtitle: `${date} · ${pickups.length + knockoffs.length} runs · ${totalPax} passengers`,
    tables, landscape: true,
    filename: `Bus Allocation - ${branchLabel} - ${date}.pdf`,
  }
}

export default function BusAllocation() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canPlan = canEdit(role, 'operations') || role === 'route_supervisor'

  const allocations = useAllocations()
  const dailyPlan = useDailyPlan()
  const vehicles = useVehicles().filter((v) => v.branch === branch)
  const drivers = useDrivers().filter((d) => d.branch === branch)
  const locations = useLocations(branch)

  const [date, setDate] = useState(today)
  const [multiOpen, setMultiOpen] = useState(false)
  const [runModal, setRunModal] = useState<{ open: boolean; editing: Allocation | null }>({ open: false, editing: null })
  const [importOpen, setImportOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)

  const dayRuns = useMemo(
    () => allocations.filter((a) => a.branch === branch && a.date === date).sort((a, b) => (a.departure_time || '').localeCompare(b.departure_time || '')),
    [allocations, branch, date],
  )
  const dayPlan = useMemo(
    () => dailyPlan.filter((t) => t.branch === branch && t.date === date).sort((a, b) => (a.departure_time || '').localeCompare(b.departure_time || '')),
    [dailyPlan, branch, date],
  )
  const actualByPlan = useMemo(() => {
    const m = new Map<string, Allocation>()
    for (const a of dayRuns) if (a.plan_trip_id) m.set(a.plan_trip_id, a)
    return m
  }, [dayRuns])
  const planIds = new Set(dayPlan.map((t) => t.id))
  const unplanned = dayRuns.filter((a) => !a.plan_trip_id || !planIds.has(a.plan_trip_id))
  const pickups = dayRuns.filter((r) => r.trip_type === 'pickup')
  const knockoffs = dayRuns.filter((r) => r.trip_type === 'knockoff')
  const totalPax = dayRuns.reduce((s, r) => s + (r.passengers ?? 0), 0)
  const loggedCount = dayPlan.filter((t) => actualByPlan.has(t.id)).length
  const missingCount = dayPlan.length - loggedCount

  const stat = (label: string, value: number | string, tone: 'neutral' | 'good' | 'warning' = 'neutral') => (
    <div className={`rounded-xl border px-3 py-2 ${tone === 'warning' ? 'border-status-warning/40 bg-status-warning/10' : tone === 'good' ? 'border-status-good/30 bg-status-good/5' : 'border-black/10 bg-white'}`}>
      <div className={`text-lg font-bold leading-none ${tone === 'warning' ? 'text-[#8a6d10]' : tone === 'good' ? 'text-status-good' : 'text-navy'}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-status-neutral">{label}</div>
    </div>
  )

  return (
    <div className="page space-y-4">
      <p className="max-w-2xl text-sm text-status-neutral">
        Log each run <span className="font-medium text-navy">as it happens</span> — tap a planned trip and enter the passenger count.
        It's the live result of <span className="font-medium text-navy">Daily Plan</span>, so you can see at a glance what ran, what didn't, and any changes.
      </p>

      {/* Date + summary */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand" />
        {date === today() && <span className="rounded-full bg-status-good/10 px-2 py-0.5 text-xs font-medium text-status-good">Today</span>}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {stat('Planned', dayPlan.length)}
        {stat('Logged', loggedCount, loggedCount > 0 ? 'good' : 'neutral')}
        {stat('Not yet run', missingCount, missingCount > 0 ? 'warning' : 'neutral')}
        {stat('Unplanned', unplanned.length, unplanned.length > 0 ? 'warning' : 'neutral')}
        {stat('Passengers', totalPax, 'good')}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {canPlan && <Button onClick={() => setRunModal({ open: true, editing: null })}><Plus size={15} /> Add run</Button>}
        {canPlan && <Button variant="secondary" onClick={() => setMultiOpen(true)}><Plus size={15} /> Add many</Button>}
        {canPlan && <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Upload</Button>}
        <Button variant="secondary" onClick={() => exportAllocations(dayRuns, branchLabel)}><Download size={15} /> Excel</Button>
        <Button variant="secondary" onClick={() => downloadTablePdf(allocPdf(date, branchLabel, pickups, knockoffs))}><FileText size={15} /> PDF</Button>
        <Button variant="secondary" onClick={() => exportReportWord(allocReport(date, branchLabel, pickups, knockoffs))}><FileType size={15} /> Word</Button>
        <Button variant="secondary" onClick={() => setEmailOpen(true)}><Mail size={15} /> Email</Button>
      </div>

      {/* Plan-driven live board */}
      {dayPlan.length === 0 && unplanned.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center text-sm text-status-neutral">
          <Bus size={26} className="text-status-neutral/60" />
          No plan for {date}. Set the day's intended trips in <span className="font-medium text-navy">Operations → Daily Plan</span>, then log them here as buses move
          {canPlan && ' — or just "Add run" for ad-hoc trips'}.
        </div>
      ) : (
        <div className="space-y-5">
          {dayPlan.length > 0 && (
            <Section title="Planned runs" hint={`${loggedCount}/${dayPlan.length} logged`}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {dayPlan.map((t) => <PlanCard key={t.id} trip={t} actual={actualByPlan.get(t.id)} canPlan={canPlan} branch={branch} date={date} vehicles={vehicles} drivers={drivers} />)}
              </div>
            </Section>
          )}

          <Section title="Unplanned runs" hint={unplanned.length ? `${unplanned.length} extra` : 'none'}>
            {unplanned.length === 0 ? (
              <p className="text-sm text-status-neutral">Every logged run matched the plan. {canPlan && 'Use "Add run" if a bus runs that wasn\'t planned.'}</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {unplanned.map((a) => <ActualCard key={a.id} run={a} canPlan={canPlan} onEdit={() => setRunModal({ open: true, editing: a })} />)}
              </div>
            )}
          </Section>
        </div>
      )}

      <MultiRunModal open={multiOpen} onClose={() => setMultiOpen(false)} branch={branch} date={date} vehicles={vehicles} drivers={drivers} locations={locations} />
      <RunModal state={runModal} onClose={() => setRunModal({ open: false, editing: null })} branch={branch} date={date} vehicles={vehicles} drivers={drivers} locations={locations} />
      <AllocImportModal open={importOpen} onClose={() => setImportOpen(false)} branch={branch} />
      <AllocEmailModal open={emailOpen} onClose={() => setEmailOpen(false)} date={date} branchLabel={branchLabel} pickups={pickups} knockoffs={knockoffs} />

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy">{title}{hint && <span className="text-xs font-normal text-status-neutral">· {hint}</span>}</h3>
      {children}
    </div>
  )
}

function TypePill({ type }: { type: TripType }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${type === 'pickup' ? 'bg-brand-tint text-brand' : 'bg-status-warning/15 text-[#8a6d10]'}`}>{TRIP_LABEL[type]}</span>
}

// A planned trip with inline passenger logging — the core mobile action.
function PlanCard({ trip, actual, canPlan, branch, date, vehicles, drivers }: { trip: DailyPlanTrip; actual?: Allocation; canPlan: boolean; branch: BranchCode; date: string; vehicles: any[]; drivers: any[] }) {
  const [open, setOpen] = useState(false)
  const [pax, setPax] = useState('')
  const [time, setTime] = useState('')
  const [fleet, setFleet] = useState('')
  const [driver, setDriver] = useState('')
  const [showChange, setShowChange] = useState(false)

  function begin() {
    setPax(actual?.passengers != null ? String(actual.passengers) : '')
    setTime(actual?.departure_time || nowHM())
    setFleet(actual?.fleet_no || trip.fleet_no)
    setDriver(actual?.driver_name || trip.driver_name)
    setShowChange(false)
    setOpen(true)
  }
  function save() {
    const veh = vehicles.find((v) => v.fleet_no === fleet.trim())
    const payload = {
      branch, date, trip_type: trip.trip_type, driver_name: driver.trim(), fleet_no: fleet.trim(), reg_no: veh ? veh.reg_plate : trip.reg_no,
      route_id: '', location: trip.from_location || trip.to_location || '', planned_km: 0,
      departure_time: time, passengers: pax === '' ? null : Number(pax), notes: '', plan_trip_id: trip.id,
    }
    if (actual) allocationsStore.update(actual.id, payload)
    else allocationsStore.add(payload)
    setOpen(false)
  }

  const busChanged = actual && actual.fleet_no && actual.fleet_no !== trip.fleet_no
  const driverChanged = actual && actual.driver_name && trip.driver_name && actual.driver_name !== trip.driver_name

  return (
    <div className={`rounded-xl border p-3 ${actual ? 'border-status-good/40 bg-status-good/[0.04]' : 'border-black/10 bg-white'}`}>
      <div className="flex items-center gap-2">
        <TypePill type={trip.trip_type} />
        <span className="inline-flex items-center gap-1 text-xs text-status-neutral"><Clock size={12} /> {trip.departure_time || '—'}</span>
        {actual && <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-status-good"><CheckCircle2 size={13} /> Logged</span>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="inline-flex items-center gap-1 font-semibold text-navy"><Bus size={14} className="text-status-neutral" /> {trip.fleet_no || '—'}</span>
        <span className="truncate text-sm text-status-neutral">{trip.driver_name || 'No driver'}</span>
      </div>
      <div className="mt-0.5 text-xs text-status-neutral">{trip.from_location || '—'} → {trip.to_location || '—'}</div>

      {actual && !open && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-black/5 pt-2 text-sm">
          <span className="inline-flex items-center gap-1 font-semibold text-navy"><Users size={14} className="text-status-neutral" /> {actual.passengers ?? '—'} pax</span>
          <span className="inline-flex items-center gap-1 text-status-neutral"><Clock size={12} /> {actual.departure_time || '—'}</span>
          {busChanged && <span className="inline-flex items-center gap-1 rounded bg-status-warning/15 px-1.5 py-0.5 text-[11px] text-[#8a6d10]"><ArrowRightLeft size={11} /> bus {actual.fleet_no} (planned {trip.fleet_no})</span>}
          {driverChanged && <span className="rounded bg-status-warning/15 px-1.5 py-0.5 text-[11px] text-[#8a6d10]">driver changed</span>}
          {canPlan && <button onClick={begin} className="ml-auto text-xs font-medium text-brand hover:underline">Edit</button>}
        </div>
      )}

      {!actual && !open && canPlan && (
        <button onClick={begin} className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-navy-secondary">
          <Users size={15} /> Log run
        </button>
      )}

      {open && (
        <div className="mt-2.5 space-y-2 border-t border-black/5 pt-2.5">
          <div>
            <span className="mb-1 block text-xs font-medium text-navy">Passengers</span>
            <div className="flex items-stretch gap-2">
              <button onClick={() => setPax((p) => String(Math.max(0, (Number(p) || 0) - 1)))} className="flex h-11 w-11 items-center justify-center rounded-lg border border-black/15 text-navy hover:bg-canvas"><Minus size={18} /></button>
              <input type="number" inputMode="numeric" value={pax} onChange={(e) => setPax(e.target.value)} placeholder="0" className="h-11 flex-1 rounded-lg border border-black/15 bg-white text-center text-lg font-bold text-navy outline-none focus:border-brand" autoFocus />
              <button onClick={() => setPax((p) => String((Number(p) || 0) + 1))} className="flex h-11 w-11 items-center justify-center rounded-lg border border-black/15 text-navy hover:bg-canvas"><Plus size={18} /></button>
            </div>
          </div>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Departure time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} /></label>
          {!showChange ? (
            <button onClick={() => setShowChange(true)} className="text-xs font-medium text-brand hover:underline">Different bus or driver?</button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Bus</span><select value={fleet} onChange={(e) => setFleet(e.target.value)} className={inputCls}>{withCurrent(fleet, vehicles.map((v) => v.fleet_no)).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
              <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Driver</span><select value={driver} onChange={(e) => setDriver(e.target.value)} className={inputCls}><option value="">—</option>{withCurrent(driver, drivers.map((d) => d.full_name)).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            </div>
          )}
          <div className="flex gap-2 pt-0.5">
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={save}><Check size={15} /> Save</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// An unplanned (ad-hoc) actual run.
function ActualCard({ run, canPlan, onEdit }: { run: Allocation; canPlan: boolean; onEdit: () => void }) {
  return (
    <div className="rounded-xl border border-status-warning/30 bg-status-warning/[0.04] p-3">
      <div className="flex items-center gap-2">
        <TypePill type={run.trip_type} />
        <span className="inline-flex items-center gap-1 text-xs text-status-neutral"><Clock size={12} /> {run.departure_time || '—'}</span>
        <span className="ml-auto rounded bg-status-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-[#8a6d10]">Unplanned</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="inline-flex items-center gap-1 font-semibold text-navy"><Bus size={14} className="text-status-neutral" /> {run.fleet_no || '—'}</span>
        <span className="truncate text-sm text-status-neutral">{run.driver_name || 'No driver'}</span>
      </div>
      <div className="mt-0.5 text-xs text-status-neutral">{run.location || '—'}</div>
      <div className="mt-2 flex items-center gap-3 border-t border-black/5 pt-2 text-sm">
        <span className="inline-flex items-center gap-1 font-semibold text-navy"><Users size={14} className="text-status-neutral" /> {run.passengers ?? '—'} pax</span>
        {canPlan && <button onClick={onEdit} className="text-xs font-medium text-brand hover:underline"><Pencil size={12} className="mr-1 inline" />Edit</button>}
        {canPlan && <button onClick={() => confirm('Remove this run?') && allocationsStore.remove(run.id)} className="ml-auto text-xs font-medium text-status-critical hover:underline"><Trash2 size={12} className="mr-1 inline" />Remove</button>}
      </div>
    </div>
  )
}

// ── Power-user bulk entry (kept for the office) ───────────────────────────────
interface DraftRow { trip_type: TripType; driver_name: string; fleet_no: string; reg_no: string; location: string; departure_time: string; passengers: string }
const emptyRow = (): DraftRow => ({ trip_type: 'pickup', driver_name: '', fleet_no: '', reg_no: '', location: '', departure_time: '', passengers: '' })
const cellCls = 'w-full rounded-md border border-black/15 bg-white px-2 py-1 text-xs text-navy outline-none focus:border-brand'

function MultiRunModal({ open, onClose, branch, date, vehicles, drivers, locations }: { open: boolean; onClose: () => void; branch: BranchCode; date: string; vehicles: any[]; drivers: any[]; locations: string[] }) {
  const [d, setD] = useState(date)
  const [rows, setRows] = useState<DraftRow[]>([emptyRow(), emptyRow(), emptyRow()])
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setD(date); setRows([emptyRow(), emptyRow(), emptyRow()]) }
  if (!open && wasOpen) setWasOpen(false)

  function setRow(i: number, patch: Partial<DraftRow>) { setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r))) }
  function onFleet(i: number, v: string) {
    const veh = vehicles.find((x) => x.fleet_no === v)
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, fleet_no: v, reg_no: veh ? veh.reg_plate : '' } : r)))
  }
  const readyCount = rows.filter((r) => r.fleet_no.trim() && r.location.trim()).length

  function save() {
    const valid = rows.filter((r) => r.fleet_no.trim() && r.location.trim()).map((r) => ({
      branch, date: d, trip_type: r.trip_type, driver_name: r.driver_name.trim(), fleet_no: r.fleet_no.trim(),
      reg_no: r.reg_no.trim(), route_id: '', location: r.location.trim(), planned_km: 0,
      departure_time: r.departure_time, passengers: r.passengers ? Number(r.passengers) : null, notes: '',
    }))
    if (valid.length) allocationsStore.bulkAdd(valid)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Add many runs" subtitle="Enter the day's runs like a sheet — bus, driver and location are picked from your lists. Save once."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={readyCount === 0}>Save {readyCount} run{readyCount === 1 ? '' : 's'}</Button></>}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-medium text-navy">Date</span>
        <input type="date" value={d} onChange={(e) => setD(e.target.value)} className="rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-brand" />
      </div>
      <div className="overflow-x-auto rounded-lg border border-black/10">
        <table className="w-full min-w-[760px] text-left">
          <thead className="bg-canvas text-[10px] uppercase tracking-wide text-status-neutral">
            <tr>
              <th className="px-2 py-1.5 font-medium">Type</th><th className="px-2 py-1.5 font-medium">Bus</th>
              <th className="px-2 py-1.5 font-medium">Reg</th><th className="px-2 py-1.5 font-medium">Driver</th>
              <th className="px-2 py-1.5 font-medium">Location</th><th className="px-2 py-1.5 font-medium">Time</th>
              <th className="px-2 py-1.5 font-medium">Pax</th><th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-black/5">
                <td className="px-1.5 py-1"><select className={cellCls} value={r.trip_type} onChange={(e) => setRow(i, { trip_type: e.target.value as TripType })}><option value="pickup">Pickup</option><option value="knockoff">Knock-off</option></select></td>
                <td className="px-1.5 py-1"><select className={cellCls} value={r.fleet_no} onChange={(e) => onFleet(i, e.target.value)}><option value="">Bus…</option>{vehicles.map((v) => <option key={v.id} value={v.fleet_no}>{v.fleet_no}</option>)}</select></td>
                <td className="whitespace-nowrap px-2 py-1 text-xs text-status-neutral">{r.reg_no || '—'}</td>
                <td className="px-1.5 py-1"><select className={cellCls} value={r.driver_name} onChange={(e) => setRow(i, { driver_name: e.target.value })}><option value="">Driver…</option>{drivers.map((dr) => <option key={dr.id} value={dr.full_name}>{dr.full_name}</option>)}</select></td>
                <td className="px-1.5 py-1"><select className={cellCls} value={r.location} onChange={(e) => setRow(i, { location: e.target.value })}><option value="">Location…</option>{locations.map((n) => <option key={n} value={n}>{n}</option>)}</select></td>
                <td className="px-1.5 py-1"><input type="time" className={cellCls} value={r.departure_time} onChange={(e) => setRow(i, { departure_time: e.target.value })} /></td>
                <td className="px-1.5 py-1"><input type="number" className={cellCls} value={r.passengers} onChange={(e) => setRow(i, { passengers: e.target.value })} /></td>
                <td className="px-1.5 py-1"><button onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => setRows((rs) => [...rs, emptyRow()])} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs font-medium text-brand hover:border-brand">
        <Plus size={14} /> Add row
      </button>
    </Modal>
  )
}

function RunModal({ state, onClose, branch, date, vehicles, drivers, locations }: { state: { open: boolean; editing: Allocation | null }; onClose: () => void; branch: BranchCode; date: string; vehicles: any[]; drivers: any[]; locations: string[] }) {
  const e = state.editing
  const [f, setF] = useState<AllocationInput>(blank(branch, date))
  const [key, setKey] = useState('')
  const k = (e?.id ?? 'new') + String(state.open)
  if (state.open && k !== key) { setKey(k); setF(e ? { ...e } : blank(branch, date)) }
  function set<K extends keyof AllocationInput>(kk: K, v: AllocationInput[K]) { setF((p) => ({ ...p, [kk]: v })) }
  function onVehicle(v: string) {
    const veh = vehicles.find((x) => x.fleet_no === v)
    setF((p) => ({ ...p, fleet_no: v, reg_no: veh ? veh.reg_plate : '' }))
  }
  function save() {
    if (!f.fleet_no.trim()) return
    if (e) allocationsStore.update(e.id, f); else allocationsStore.add(f)
    onClose()
  }
  return (
    <Modal open={state.open} onClose={onClose} title={e ? 'Edit run' : 'Add run'} subtitle="A run that isn't on the plan (or a correction). Bus, driver and place come from your lists." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Trip type</span>
          <select className={inputCls} value={f.trip_type} onChange={(ev) => set('trip_type', ev.target.value as TripType)}>
            <option value="pickup">Pickup</option><option value="knockoff">Knock-off</option>
          </select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Departure time</span><input type="time" className={inputCls} value={f.departure_time} onChange={(ev) => set('departure_time', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Bus</span>
          <select className={inputCls} value={f.fleet_no} onChange={(ev) => onVehicle(ev.target.value)}>
            <option value="">Select bus…</option>
            {withCurrent(f.fleet_no, vehicles.map((v) => v.fleet_no)).map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reg No</span><div className="flex h-[38px] items-center rounded-lg border border-black/10 bg-canvas px-3 text-sm text-navy">{f.reg_no || '—'}</div></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Driver</span>
          <select className={inputCls} value={f.driver_name} onChange={(ev) => set('driver_name', ev.target.value)}>
            <option value="">Select driver…</option>
            {withCurrent(f.driver_name, drivers.map((d) => d.full_name)).map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Passengers</span><input type="number" className={inputCls} value={f.passengers ?? ''} onChange={(ev) => set('passengers', ev.target.value ? Number(ev.target.value) : null)} /></label>
        <label className="col-span-2 block"><span className="mb-1 block text-xs font-medium text-navy">Location / route name</span>
          <select className={inputCls} value={f.location} onChange={(ev) => set('location', ev.target.value)}>
            <option value="">Select place…</option>
            {withCurrent(f.location, locations).map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
      </div>
    </Modal>
  )
}

function blank(branch: BranchCode, date: string): AllocationInput {
  return { branch, date, trip_type: 'pickup', driver_name: '', fleet_no: '', reg_no: '', route_id: '', location: '', departure_time: '', passengers: null, planned_km: 0, notes: '' }
}

function AllocEmailModal({ open, onClose, date, branchLabel, pickups, knockoffs }: { open: boolean; onClose: () => void; date: string; branchLabel: string; pickups: Allocation[]; knockoffs: Allocation[] }) {
  const recipients = useRecipients()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [name, setName] = useState(''); const [email, setEmail] = useState('')
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setSel(new Set(recipients.map((r) => r.id))) }
  if (!open && wasOpen) setWasOpen(false)

  function toggle(id: string) { setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function add() {
    if (!isValidEmail(email)) return
    const r = recipientsStore.add(name || email, email)
    setSel((s) => new Set(s).add(r.id)); setName(''); setEmail('')
  }
  function send() {
    const chosen = recipients.filter((r) => sel.has(r.id))
    if (!chosen.length) return
    downloadTablePdf(allocPdf(date, branchLabel, pickups, knockoffs))
    const to = chosen.map((r) => r.email).join(',')
    const subject = `Bus Allocation — ${branchLabel} — ${date}`
    const body = `Good day,\n\nPlease find attached the bus allocation for ${date} (${branchLabel}).\n\nKind regards,`
    const a = document.createElement('a')
    a.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    a.click()
    onClose()
  }
  const selCount = recipients.filter((r) => sel.has(r.id)).length

  return (
    <Modal open={open} onClose={onClose} title="Email allocation" subtitle={`${branchLabel} · ${date} · ${pickups.length + knockoffs.length} runs`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={send} disabled={selCount === 0}><Mail size={15} /> Download PDF &amp; open email ({selCount})</Button></>}>
      <div className="space-y-3">
        <div className="rounded-lg border border-black/10">
          {recipients.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-status-neutral">No saved recipients yet — add one below.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {recipients.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-canvas">
                  <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="accent-brand" />
                  <span className="flex-1"><span className="font-medium text-navy">{r.name || r.email}</span>{r.name && <span className="ml-1 text-status-neutral">{r.email}</span>}</span>
                  <button onClick={(e) => { e.preventDefault(); recipientsStore.remove(r.id) }} className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={13} /></button>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block flex-1"><span className="mb-1 block text-xs font-medium text-navy">Name (optional)</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block flex-1"><span className="mb-1 block text-xs font-medium text-navy">Email</span><input type="email" className={inputCls} placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
          <Button variant="secondary" onClick={add} disabled={!isValidEmail(email)}><Plus size={15} /> Add</Button>
        </div>
        <p className="rounded-lg bg-canvas px-3 py-2 text-[11px] text-status-neutral">This downloads the allocation <b>PDF</b> and opens your email app with the recipients and a summary prefilled — then attach the downloaded PDF.</p>
      </div>
    </Modal>
  )
}

function AllocImportModal({ open, onClose, branch }: { open: boolean; onClose: () => void; branch: BranchCode }) {
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<AllocImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<number | null>(null)

  function close() { setFileName(''); setParsed(null); setBusy(false); setDone(null); onClose() }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setFileName(file.name); setBusy(true); setDone(null)
    try { setParsed(await parseAllocations(file, branch)) } catch { setParsed({ valid: [], errors: [{ row: 0, reason: 'Could not read file. Use the template.' }] }) } finally { setBusy(false) }
    e.target.value = ''
  }
  function commit() { if (!parsed) return; allocationsStore.bulkAdd(parsed.valid); setDone(parsed.valid.length); setParsed(null) }

  return (
    <Modal open={open} onClose={close} title="Bulk upload daily allocation" subtitle="Upload the day sheet — Date, Driver, Fleet No, Reg No, Location, Time, Passengers."
      footer={done !== null ? <Button onClick={close}>Done</Button> : <><Button variant="secondary" onClick={close}>Cancel</Button><Button onClick={commit} disabled={!parsed || parsed.valid.length === 0}>Import {parsed?.valid.length ?? 0} run(s)</Button></>}>
      <div className="mb-4 flex items-center justify-between rounded-lg bg-canvas px-4 py-3">
        <div className="text-sm text-navy"><div className="font-medium">Match your daily format</div><div className="text-xs text-status-neutral">Section/header rows and blanks are skipped automatically.</div></div>
        <Button variant="secondary" onClick={downloadAllocTemplate}><Download size={15} /> Template</Button>
      </div>
      {done === null && (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-navy/20 bg-white px-6 py-8 text-center hover:border-brand">
          <UploadCloud size={26} className="text-brand" />
          <span className="text-sm font-medium text-navy">Click to choose an .xlsx file</span>
          <span className="text-xs text-status-neutral">{fileName || 'No file selected'}</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
        </label>
      )}
      {busy && <p className="mt-4 text-sm text-status-neutral">Reading file…</p>}
      {parsed && !busy && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-status-good/30 bg-status-good/5 px-3 py-2 text-sm text-status-good"><CheckCircle2 size={16} /> {parsed.valid.length} run(s) ready to import</div>
          {parsed.errors.length > 0 && (
            <div className="rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">
              <div className="mb-1 flex items-center gap-2 font-medium"><AlertTriangle size={16} /> {parsed.errors.length} row(s) skipped</div>
              <ul className="ml-6 list-disc space-y-0.5 text-xs">{parsed.errors.slice(0, 6).map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {done !== null && <div className="mt-4 flex flex-col items-center gap-2 rounded-xl bg-canvas px-6 py-8 text-center"><CheckCircle2 size={26} className="text-status-good" /><div className="font-display text-base font-semibold text-navy">Imported {done} run(s)</div></div>}
    </Modal>
  )
}
