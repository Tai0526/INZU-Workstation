import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Upload, Download, CalendarDays, CheckCircle2, AlertTriangle, UploadCloud, FileText, FileType, Mail } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useVehicles } from '@/lib/fleet/store'
import { useDrivers } from '@/lib/drivers/store'
import { useAllocations, allocationsStore } from '@/lib/operations/store'
import { type Allocation, type AllocationInput, type TripType } from '@/lib/operations/types'
import { useMileageRoutes } from '@/lib/mileage/store'
import { routeTotal } from '@/lib/mileage/types'
import { downloadAllocTemplate, parseAllocations, exportAllocations, type AllocImportResult } from '@/lib/operations/excel'
import { exportReportWord, esc, type ReportInput } from '@/lib/reports/exporter'
import { downloadTablePdf, type PdfTable } from '@/lib/reports/pdfDoc'
import { useRecipients, recipientsStore, isValidEmail } from '@/lib/reports/recipients'

// Routes are owned by the Mileage page (the single place they're added). Bus
// Allocation reads that catalogue; a run's planned km is the route's total km.
const routeLabel = (r: any) => `${r.name} · ${r.project} (${routeTotal(r)} km)`

// Build a printable / editable daily allocation report (PDF + Word).
function allocReport(date: string, branchLabel: string, pickups: Allocation[], knockoffs: Allocation[]): ReportInput {
  const group = (label: string, runs: Allocation[]) => {
    const km = runs.reduce((s, r) => s + r.planned_km, 0)
    const pax = runs.reduce((s, r) => s + (r.passengers ?? 0), 0)
    const rows = runs.map((r) => `<tr><td>${esc(r.driver_name || '—')}</td><td>${esc(r.fleet_no)}</td><td>${esc(r.reg_no)}</td><td>${esc(r.location)}</td><td class="num">${r.planned_km ? r.planned_km + ' km' : '—'}</td><td>${esc(r.departure_time || '—')}</td><td class="num">${r.passengers ?? '—'}</td></tr>`).join('')
    const head = '<tr><th>Driver</th><th>Fleet No</th><th>Reg No</th><th>Route</th><th class="num">Mileage</th><th>Time</th><th class="num">Pax</th></tr>'
    const empty = '<tr><td colspan="7" style="text-align:center;color:#6B7280">None</td></tr>'
    const total = runs.length ? `<tr class="tot"><td colspan="4">Total</td><td class="num">${km} km</td><td></td><td class="num">${pax}</td></tr>` : ''
    return `<h2>${label} — ${runs.length} run${runs.length === 1 ? '' : 's'}</h2><table><thead>${head}</thead><tbody>${rows || empty}${total}</tbody></table>`
  }
  const totalKm = pickups.concat(knockoffs).reduce((s, r) => s + r.planned_km, 0)
  const totalPax = pickups.concat(knockoffs).reduce((s, r) => s + (r.passengers ?? 0), 0)
  return {
    title: `Daily Bus Allocation — ${branchLabel}`,
    subtitle: `${date} · ${pickups.length + knockoffs.length} runs · ${totalKm} km · ${totalPax} passengers`,
    body: group('Pickups', pickups) + group('Knock-offs', knockoffs),
    landscape: true,
    filenameBase: `Bus Allocation - ${branchLabel} - ${date}`,
  }
}

// Allocation as a real PDF file (for download / email attachment).
function allocPdf(date: string, branchLabel: string, pickups: Allocation[], knockoffs: Allocation[]) {
  const head = ['Driver', 'Fleet No', 'Reg No', 'Route', 'Mileage', 'Time', 'Pax']
  const rowsOf = (runs: Allocation[]) => runs.map((r) => [r.driver_name || '-', r.fleet_no, r.reg_no, r.location, r.planned_km ? `${r.planned_km} km` : '-', r.departure_time || '-', r.passengers ?? '-'])
  const totalKm = pickups.concat(knockoffs).reduce((s, r) => s + r.planned_km, 0)
  const totalPax = pickups.concat(knockoffs).reduce((s, r) => s + (r.passengers ?? 0), 0)
  const tables: PdfTable[] = [
    { heading: `Pickups (${pickups.length})`, head, rows: rowsOf(pickups) },
    { heading: `Knock-offs (${knockoffs.length})`, head, rows: rowsOf(knockoffs) },
  ]
  return {
    title: `Daily Bus Allocation — ${branchLabel}`,
    subtitle: `${date} · ${pickups.length + knockoffs.length} runs · ${totalKm} km · ${totalPax} passengers`,
    tables, landscape: true,
    filename: `Bus Allocation - ${branchLabel} - ${date}.pdf`,
  }
}

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

export default function BusAllocation() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canPlan = canEdit(role, 'operations') || role === 'route_supervisor'

  const routes = useMileageRoutes().filter((r) => r.branch === branch)
  const allocations = useAllocations()
  const vehicles = useVehicles().filter((v) => v.branch === branch)
  const drivers = useDrivers().filter((d) => d.branch === branch)

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [multiOpen, setMultiOpen] = useState(false)
  const [runModal, setRunModal] = useState<{ open: boolean; editing: Allocation | null }>({ open: false, editing: null })
  const [importOpen, setImportOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)

  const dayRuns = useMemo(
    () => allocations.filter((a) => a.branch === branch && a.date === date).sort((a, b) => a.departure_time.localeCompare(b.departure_time)),
    [allocations, branch, date],
  )
  const totalPax = dayRuns.reduce((s, r) => s + (r.passengers ?? 0), 0)
  const pickups = dayRuns.filter((r) => r.trip_type === 'pickup')
  const knockoffs = dayRuns.filter((r) => r.trip_type === 'knockoff')

  return (
    <div className="page space-y-6">
      <p className="max-w-2xl text-sm text-status-neutral">
        The actuals report of how buses moved — one row per departure: driver, bus, location, time and <span className="font-medium text-navy">passengers carried</span>.
        (The intended movements are set in <span className="font-medium text-navy">Operations → Daily Plan</span>.)
      </p>

      {/* Daily allocation */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <CalendarDays size={16} className="text-brand" />
          <h3 className="font-display text-sm font-bold text-navy">Daily allocation</h3>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ml-2 rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-brand" />
          <span className="text-xs text-status-neutral">{dayRuns.length} runs · {totalPax} passengers</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => exportAllocations(dayRuns, branchLabel)}><Download size={15} /> Excel</Button>
            <Button variant="secondary" onClick={() => downloadTablePdf(allocPdf(date, branchLabel, pickups, knockoffs))}><FileText size={15} /> PDF</Button>
            <Button variant="secondary" onClick={() => exportReportWord(allocReport(date, branchLabel, pickups, knockoffs))}><FileType size={15} /> Word</Button>
            <Button variant="secondary" onClick={() => setEmailOpen(true)}><Mail size={15} /> Email</Button>
            {canPlan && <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Bulk upload</Button>}
            {canPlan && <Button onClick={() => setMultiOpen(true)}><Plus size={15} /> Add runs</Button>}
          </div>
        </div>
        {dayRuns.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-status-neutral">No runs logged for {date}. {canPlan && 'Add one or bulk-upload the day sheet.'}</p>
        ) : (
          <div>
            <RunGroup title="Pickups" runs={pickups} canPlan={canPlan} onEdit={(a) => setRunModal({ open: true, editing: a })} />
            <RunGroup title="Knock-offs" runs={knockoffs} canPlan={canPlan} onEdit={(a) => setRunModal({ open: true, editing: a })} />
          </div>
        )}
      </div>

      {/* Routes come from the Mileage page now */}
      <p className="text-xs text-status-neutral">
        Routes &amp; distances are managed in <span className="font-medium text-navy">Mileage → Setup → Route catalogue</span> — the single place routes are added. They appear automatically in the run editor here.
      </p>

      {/* datalists for quick entry */}
      <datalist id="dl-drivers">{drivers.map((d) => <option key={d.id} value={d.full_name} />)}</datalist>
      <datalist id="dl-fleet">{vehicles.map((v) => <option key={v.id} value={v.fleet_no} />)}</datalist>

      <MultiRunModal open={multiOpen} onClose={() => setMultiOpen(false)} branch={branch} date={date} routes={routes} vehicles={vehicles} />
      <RunModal state={runModal} onClose={() => setRunModal({ open: false, editing: null })} branch={branch} date={date} routes={routes} vehicles={vehicles} />
      <AllocImportModal open={importOpen} onClose={() => setImportOpen(false)} branch={branch} />
      <AllocEmailModal open={emailOpen} onClose={() => setEmailOpen(false)} date={date} branchLabel={branchLabel} pickups={pickups} knockoffs={knockoffs} />

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
    </div>
  )
}

function RunGroup({ title, runs, canPlan, onEdit }: { title: string; runs: Allocation[]; canPlan: boolean; onEdit: (a: Allocation) => void }) {
  const km = runs.reduce((s, r) => s + r.planned_km, 0)
  const pax = runs.reduce((s, r) => s + (r.passengers ?? 0), 0)
  return (
    <div className="border-t border-black/5 first:border-0">
      <div className="flex items-center gap-2 bg-canvas/60 px-5 py-2">
        <span className="text-xs font-bold uppercase tracking-wide text-navy">{title}</span>
        <span className="text-[11px] text-status-neutral">{runs.length} runs · {km} km · {pax} pax</span>
      </div>
      {runs.length === 0 ? (
        <p className="px-5 py-4 text-xs text-status-neutral">None.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-status-neutral">
              <tr>
                <th className="px-5 py-1.5 text-xs font-medium">Driver</th><th className="px-4 py-1.5 text-xs font-medium">Fleet No</th>
                <th className="px-4 py-1.5 text-xs font-medium">Reg No</th><th className="px-4 py-1.5 text-xs font-medium">Route</th>
                <th className="px-4 py-1.5 text-xs font-medium">Mileage</th><th className="px-4 py-1.5 text-xs font-medium">Time</th>
                <th className="px-4 py-1.5 text-xs font-medium">Pax</th>{canPlan && <th className="px-4 py-1.5 text-right text-xs font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {runs.map((a) => (
                <tr key={a.id} className="border-t border-black/5 hover:bg-canvas">
                  <td className="px-5 py-2 font-medium text-navy">{a.driver_name || '—'}</td>
                  <td className="px-4 py-2 text-navy">{a.fleet_no}</td>
                  <td className="px-4 py-2 text-status-neutral">{a.reg_no}</td>
                  <td className="px-4 py-2 text-navy">{a.location}</td>
                  <td className="px-4 py-2 text-status-neutral">{a.planned_km ? `${a.planned_km} km` : '—'}</td>
                  <td className="px-4 py-2 text-status-neutral">{a.departure_time}</td>
                  <td className="px-4 py-2 text-status-neutral">{a.passengers ?? '—'}</td>
                  {canPlan && (
                    <td className="px-4 py-2"><div className="flex justify-end gap-1">
                      <button onClick={() => onEdit(a)} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy"><Pencil size={14} /></button>
                      <button onClick={() => confirm('Remove this run?') && allocationsStore.remove(a.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button>
                    </div></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface DraftRow { trip_type: TripType; driver_name: string; fleet_no: string; reg_no: string; route_id: string; departure_time: string; passengers: string }
const emptyRow = (): DraftRow => ({ trip_type: 'pickup', driver_name: '', fleet_no: '', reg_no: '', route_id: '', departure_time: '', passengers: '' })
const cellCls = 'w-full rounded-md border border-black/15 bg-white px-2 py-1 text-xs text-navy outline-none focus:border-brand'

function MultiRunModal({ open, onClose, branch, date, routes, vehicles }: { open: boolean; onClose: () => void; branch: BranchCode; date: string; routes: any[]; vehicles: any[] }) {
  const [d, setD] = useState(date)
  const [rows, setRows] = useState<DraftRow[]>([emptyRow(), emptyRow(), emptyRow()])
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setD(date); setRows([emptyRow(), emptyRow(), emptyRow()]) }
  if (!open && wasOpen) setWasOpen(false)

  function setRow(i: number, patch: Partial<DraftRow>) { setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r))) }
  function onFleet(i: number, v: string) {
    const veh = vehicles.find((x) => x.fleet_no.toLowerCase() === v.toLowerCase())
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, fleet_no: v, reg_no: veh ? veh.reg_plate : r.reg_no } : r)))
  }
  const km = (id: string) => { const r = routes.find((x) => x.id === id); return r ? routeTotal(r) : 0 }
  const readyCount = rows.filter((r) => r.fleet_no.trim() && r.route_id).length

  function save() {
    const valid = rows.filter((r) => r.fleet_no.trim() && r.route_id).map((r) => {
      const route = routes.find((x) => x.id === r.route_id)
      return {
        branch, date: d, trip_type: r.trip_type, driver_name: r.driver_name.trim(), fleet_no: r.fleet_no.trim(),
        reg_no: r.reg_no.trim(), route_id: r.route_id, location: route?.name ?? '', planned_km: route ? routeTotal(route) : 0,
        departure_time: r.departure_time, passengers: r.passengers ? Number(r.passengers) : null, notes: '',
      }
    })
    if (valid.length) allocationsStore.bulkAdd(valid)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Add runs" subtitle="Enter the day's runs like a sheet — add as many rows as you need, then save once."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={readyCount === 0}>Save {readyCount} run{readyCount === 1 ? '' : 's'}</Button></>}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-medium text-navy">Date</span>
        <input type="date" value={d} onChange={(e) => setD(e.target.value)} className="rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-brand" />
        <span className="text-[11px] text-status-neutral">applies to all rows</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-black/10">
        <table className="w-full text-left">
          <thead className="bg-canvas text-[10px] uppercase tracking-wide text-status-neutral">
            <tr>
              <th className="px-2 py-1.5 font-medium">Type</th><th className="px-2 py-1.5 font-medium">Driver</th>
              <th className="px-2 py-1.5 font-medium">Fleet No</th><th className="px-2 py-1.5 font-medium">Reg No</th>
              <th className="px-2 py-1.5 font-medium">Route</th><th className="px-2 py-1.5 font-medium">Mileage</th>
              <th className="px-2 py-1.5 font-medium">Time</th><th className="px-2 py-1.5 font-medium">Pax</th><th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-black/5">
                <td className="px-1.5 py-1"><select className={cellCls} value={r.trip_type} onChange={(e) => setRow(i, { trip_type: e.target.value as TripType })}><option value="pickup">Pickup</option><option value="knockoff">Knock-off</option></select></td>
                <td className="px-1.5 py-1"><input list="dl-drivers" className={cellCls} value={r.driver_name} onChange={(e) => setRow(i, { driver_name: e.target.value })} /></td>
                <td className="px-1.5 py-1"><input list="dl-fleet" className={cellCls} placeholder="INZ 226" value={r.fleet_no} onChange={(e) => onFleet(i, e.target.value)} /></td>
                <td className="px-1.5 py-1"><input className={cellCls} placeholder="BCG 4666" value={r.reg_no} onChange={(e) => setRow(i, { reg_no: e.target.value })} /></td>
                <td className="px-1.5 py-1"><select className={cellCls} value={r.route_id} onChange={(e) => setRow(i, { route_id: e.target.value })}><option value="">Route…</option>{routes.map((x) => <option key={x.id} value={x.id}>{routeLabel(x)}</option>)}</select></td>
                <td className="whitespace-nowrap px-2 py-1 text-xs text-status-neutral">{r.route_id ? `${km(r.route_id)} km` : '—'}</td>
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
      {routes.length === 0 && <p className="mt-2 rounded-lg bg-brand-tint/40 px-3 py-2 text-xs text-[#8a4513]">No routes yet — add them in Mileage → Setup → Route catalogue so they're selectable here.</p>}
    </Modal>
  )
}

function RunModal({ state, onClose, branch, date, routes, vehicles }: { state: { open: boolean; editing: Allocation | null }; onClose: () => void; branch: BranchCode; date: string; routes: any[]; vehicles: any[] }) {
  const e = state.editing
  const [f, setF] = useState<AllocationInput>(blank(branch, date))
  const [key, setKey] = useState('')
  const k = (e?.id ?? 'new') + String(state.open)
  if (state.open && k !== key) { setKey(k); setF(e ? { ...e } : blank(branch, date)) }
  function set<K extends keyof AllocationInput>(kk: K, v: AllocationInput[K]) { setF((p) => ({ ...p, [kk]: v })) }
  function onFleet(v: string) {
    const veh = vehicles.find((x) => x.fleet_no.toLowerCase() === v.toLowerCase())
    setF((p) => ({ ...p, fleet_no: v, reg_no: veh ? veh.reg_plate : p.reg_no }))
  }
  function onRoute(id: string) {
    const r = routes.find((x) => x.id === id)
    setF((p) => ({ ...p, route_id: id, location: r?.name ?? '', planned_km: r ? routeTotal(r) : 0 }))
  }
  function save() {
    if (!f.fleet_no.trim() || !f.route_id) return
    if (e) allocationsStore.update(e.id, f); else allocationsStore.add(f)
    onClose()
  }
  return (
    <Modal open={state.open} onClose={onClose} title={e ? 'Edit run' : 'Add run'} subtitle="One departure — pickup or knock-off. Pick the route and the mileage fills in." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Date</span><input type="date" className={inputCls} value={f.date} onChange={(ev) => set('date', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Trip type</span>
          <select className={inputCls} value={f.trip_type} onChange={(ev) => set('trip_type', ev.target.value as TripType)}>
            <option value="pickup">Pickup</option><option value="knockoff">Knock-off</option>
          </select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Driver</span><input list="dl-drivers" className={inputCls} value={f.driver_name} onChange={(ev) => set('driver_name', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Departure time</span><input type="time" className={inputCls} value={f.departure_time} onChange={(ev) => set('departure_time', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Fleet No</span><input list="dl-fleet" className={inputCls} placeholder="INZ 226" value={f.fleet_no} onChange={(ev) => onFleet(ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reg No</span><input className={inputCls} placeholder="BCG 4666" value={f.reg_no} onChange={(ev) => set('reg_no', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Route</span>
          <select className={inputCls} value={f.route_id} onChange={(ev) => onRoute(ev.target.value)}>
            <option value="">Select route…</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{routeLabel(r)}</option>)}
          </select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Mileage</span>
          <div className="flex h-[38px] items-center rounded-lg border border-black/10 bg-canvas px-3 text-sm font-medium text-navy">{f.planned_km ? `${f.planned_km} km` : '—'}</div></label>
        <label className="col-span-2 block"><span className="mb-1 block text-xs font-medium text-navy">Passengers</span><input type="number" className={inputCls} value={f.passengers ?? ''} onChange={(ev) => set('passengers', ev.target.value ? Number(ev.target.value) : null)} /></label>
      </div>
      {routes.length === 0 && <p className="mt-3 rounded-lg bg-brand-tint/40 px-3 py-2 text-xs text-[#8a4513]">No routes yet — add them in Mileage → Setup → Route catalogue so they're available here.</p>}
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
    // 1) Download the allocation PDF so it can be attached.
    downloadTablePdf(allocPdf(date, branchLabel, pickups, knockoffs))
    // 2) Open the pre-addressed email draft with a text summary.
    const to = chosen.map((r) => r.email).join(',')
    const subject = `Bus Allocation — ${branchLabel} — ${date}`
    const body = `Good day,\n\nPlease find attached the route allocation for ${date} (${branchLabel}).\n\nKind regards,`
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

        <p className="rounded-lg bg-canvas px-3 py-2 text-[11px] text-status-neutral">This downloads the allocation <b>PDF</b> and opens your email app with the recipients and a summary prefilled — then attach the downloaded PDF to the message. (Browsers can't attach files to an email automatically.)</p>
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
          {parsed.valid.length > 0 && (
            <div className="max-h-40 overflow-auto rounded-lg border border-black/10">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-navy text-white"><tr><th className="px-3 py-1.5">Date</th><th className="px-3 py-1.5">Driver</th><th className="px-3 py-1.5">Fleet</th><th className="px-3 py-1.5">Location</th><th className="px-3 py-1.5">Time</th></tr></thead>
                <tbody>{parsed.valid.slice(0, 40).map((v, i) => <tr key={i} className="border-t border-black/5"><td className="px-3 py-1.5">{v.date}</td><td className="px-3 py-1.5">{v.driver_name}</td><td className="px-3 py-1.5 font-medium text-navy">{v.fleet_no}</td><td className="px-3 py-1.5">{v.location}</td><td className="px-3 py-1.5">{v.departure_time}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {done !== null && <div className="mt-4 flex flex-col items-center gap-2 rounded-xl bg-canvas px-6 py-8 text-center"><CheckCircle2 size={26} className="text-status-good" /><div className="font-display text-base font-semibold text-navy">Imported {done} run(s)</div></div>}
    </Modal>
  )
}
