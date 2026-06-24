import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Download, FileText, ArrowRight, Bus, Clock, Check, MapPin, X } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useVehicles } from '@/lib/fleet/store'
import { useDrivers } from '@/lib/drivers/store'
import { useDailyPlan, dailyPlanStore } from '@/lib/operations/store'
import { useLocations, locationsStore } from '@/lib/operations/locations'
import { DEFAULT_TO_LOCATION, TRIP_LABEL, type DailyPlanInput, type DailyPlanTrip, type TripType } from '@/lib/operations/types'
import { exportDailyPlan } from '@/lib/operations/excel'
import { downloadTablePdf, type PdfTable } from '@/lib/reports/pdfDoc'

const GATE = DEFAULT_TO_LOCATION
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayISO = () => iso(new Date())
const tomorrowISO = () => { const d = new Date(); d.setDate(d.getDate() + 1); return iso(d) }
const prettyDate = (s: string) => { const d = new Date(`${s}T00:00:00`); return isNaN(d.getTime()) ? s : d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) }
const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2.5 text-sm text-navy outline-none focus:border-brand'
const cellCls = 'w-full rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm text-navy outline-none focus:border-brand'

// Make a row's two ends consistent with its type (the Main Mine Gate end auto-fills).
function withGate(row: DraftRow, t: TripType): DraftRow {
  return t === 'pickup'
    ? { ...row, trip_type: t, to_location: GATE, from_location: row.from_location === GATE ? '' : row.from_location }
    : { ...row, trip_type: t, from_location: GATE, to_location: row.to_location === GATE ? '' : row.to_location }
}

interface DraftRow { trip_type: TripType; fleet_no: string; reg_no: string; from_location: string; to_location: string; departure_time: string; driver_name: string }
const blankRow = (t: TripType): DraftRow => withGate({ trip_type: t, fleet_no: '', reg_no: '', from_location: '', to_location: '', departure_time: '', driver_name: '' }, t)

function TypePill({ type }: { type: TripType }) {
  return <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold', type === 'pickup' ? 'bg-brand-tint text-brand' : 'bg-status-warning/15 text-[#8a6d10]')}>{TRIP_LABEL[type]}</span>
}

export default function DailyPlan() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canPlan = canEdit(role, 'operations') || role === 'route_supervisor'

  const vehicles = useVehicles().filter((v) => v.branch === branch && v.status === 'active')
  const drivers = useDrivers().filter((d) => d.branch === branch)
  const plan = useDailyPlan()
  const locationOptions = useLocations(branch)

  // Planning is for the NEXT day by default (done the evening before / in the office).
  const [date, setDate] = useState(tomorrowISO())
  const [defaultType, setDefaultType] = useState<TripType>('pickup')
  const [rows, setRows] = useState<DraftRow[]>([blankRow('pickup'), blankRow('pickup'), blankRow('pickup')])
  const [editing, setEditing] = useState<DailyPlanTrip | null>(null)
  const [placesOpen, setPlacesOpen] = useState(false)
  const [error, setError] = useState('')

  const trips = useMemo(
    () => plan.filter((t) => t.branch === branch && t.date === date).sort((a, b) => (a.departure_time || '').localeCompare(b.departure_time || '')),
    [plan, branch, date],
  )
  const pickups = trips.filter((t) => t.trip_type !== 'knockoff')
  const knockoffs = trips.filter((t) => t.trip_type === 'knockoff')

  function setRow(i: number, patch: Partial<DraftRow>) { setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); setError('') }
  function setRowType(i: number, t: TripType) { setRows((rs) => rs.map((r, idx) => (idx === i ? withGate(r, t) : r))) }
  function onFleet(i: number, v: string) {
    const veh = vehicles.find((x) => x.fleet_no === v)
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, fleet_no: v, reg_no: veh ? veh.reg_plate : '' } : r)))
    setError('')
  }
  function addRow() { setRows((rs) => [...rs, blankRow(defaultType)]) }
  function removeRow(i: number) { setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs)) }
  function chooseDefault(t: TripType) {
    setDefaultType(t)
    // Re-type any still-empty rows so a batch of pickups (or knock-offs) is one click.
    setRows((rs) => rs.map((r) => (!r.fleet_no.trim() && !r.from_location.replace(GATE, '').trim() && !r.to_location.replace(GATE, '').trim() ? withGate(r, t) : r)))
  }

  const readyRows = rows.filter((r) => r.fleet_no.trim() && r.from_location.trim() && r.to_location.trim())
  function saveAll() {
    if (readyRows.length === 0) return setError('Fill in at least one row — bus and both locations.')
    const payloads: DailyPlanInput[] = readyRows.map((r) => ({
      branch, date, trip_type: r.trip_type, driver_name: r.driver_name.trim(), fleet_no: r.fleet_no.trim(), reg_no: r.reg_no.trim(),
      from_location: r.from_location.trim(), to_location: r.to_location.trim(), departure_time: r.departure_time, notes: '',
    }))
    dailyPlanStore.bulkAdd(payloads)
    setRows([blankRow(defaultType), blankRow(defaultType), blankRow(defaultType)])
    setError('')
  }

  function exportPdf() {
    const head = ['Time', 'Driver', 'Bus', 'Reg No', 'From', 'To']
    const rowsOf = (list: DailyPlanTrip[]) => list.map((t) => [t.departure_time || '-', t.driver_name || '-', t.fleet_no, t.reg_no || '-', t.from_location, t.to_location])
    const tables: PdfTable[] = [
      { heading: `Pickups (${pickups.length})`, head, rows: rowsOf(pickups) },
      { heading: `Knock-offs (${knockoffs.length})`, head, rows: rowsOf(knockoffs) },
    ]
    downloadTablePdf({ title: `Daily Movement Plan — ${branchLabel}`, subtitle: `${date} · ${trips.length} trips`, tables, landscape: true, filename: `Daily Plan - ${branchLabel} - ${date}.pdf` })
  }

  const stat = (label: string, value: number) => (
    <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{value}</div><div className="mt-0.5 text-[11px] text-status-neutral">{label}</div></div>
  )

  return (
    <div className="page space-y-4">
      <p className="max-w-3xl text-sm text-status-neutral">
        Plan the day's <span className="font-medium text-navy">intended movements</span> — usually for <span className="font-medium text-navy">tomorrow</span>, from the office.
        Set each row's bus, where it goes from → to, the time, and whether it's a pickup or knock-off (the Main Mine Gate end fills in automatically).
        <span className="font-medium text-navy"> Bus Allocation</span> then records what actually ran against this plan.
      </p>

      {/* Date + summary + export */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand" />
        <button onClick={() => setDate(todayISO())} className={clsx('rounded-full px-2.5 py-1 text-xs font-medium', date === todayISO() ? 'bg-navy text-white' : 'border border-black/15 bg-white text-navy hover:bg-canvas')}>Today</button>
        <button onClick={() => setDate(tomorrowISO())} className={clsx('rounded-full px-2.5 py-1 text-xs font-medium', date === tomorrowISO() ? 'bg-navy text-white' : 'border border-black/15 bg-white text-navy hover:bg-canvas')}>Tomorrow</button>
        <span className="text-sm font-medium text-navy">{prettyDate(date)}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => exportDailyPlan(trips, branchLabel)} disabled={trips.length === 0}><Download size={15} /> Excel</Button>
          <Button variant="secondary" onClick={exportPdf} disabled={trips.length === 0}><FileText size={15} /> PDF</Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:max-w-md">
        {stat('Trips', trips.length)}
        {stat('Pickups', pickups.length)}
        {stat('Knock-offs', knockoffs.length)}
      </div>

      {/* Planner grid — desktop-first, fill a sheet of trips and save once */}
      {canPlan && (
        <div className="card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="font-display text-sm font-bold text-navy">Plan trips for {prettyDate(date)}</h3>
            <span className="text-xs text-status-neutral">New rows:</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
              {(['pickup', 'knockoff'] as TripType[]).map((t) => (
                <button key={t} onClick={() => chooseDefault(t)} className={clsx('px-3 py-1.5 text-xs font-semibold transition-colors', defaultType === t ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas')}>{TRIP_LABEL[t]}</button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => setPlacesOpen(true)}><MapPin size={14} /> Manage places</Button>
            <span className="ml-auto text-xs text-status-neutral">{readyRows.length} ready</span>
          </div>

          {error && <div className="mb-3 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>}

          <div className="overflow-x-auto rounded-lg border border-black/10">
            <table className="w-full min-w-[820px] text-left">
              <thead className="bg-canvas text-[10px] uppercase tracking-wide text-status-neutral">
                <tr>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Bus</th>
                  <th className="px-2 py-2 font-medium">Reg</th>
                  <th className="px-2 py-2 font-medium">From</th>
                  <th className="px-2 py-2 font-medium">To</th>
                  <th className="px-2 py-2 font-medium">Time</th>
                  <th className="px-2 py-2 font-medium">Driver</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-black/5">
                    <td className="px-1.5 py-1 w-28"><select className={cellCls} value={r.trip_type} onChange={(e) => setRowType(i, e.target.value as TripType)}><option value="pickup">Pickup</option><option value="knockoff">Knock-off</option></select></td>
                    <td className="px-1.5 py-1 w-28"><select className={cellCls} value={r.fleet_no} onChange={(e) => onFleet(i, e.target.value)}><option value="">Bus…</option>{vehicles.map((v) => <option key={v.id} value={v.fleet_no}>{v.fleet_no}</option>)}</select></td>
                    <td className="whitespace-nowrap px-2 py-1 text-sm text-status-neutral">{r.reg_no || '—'}</td>
                    <td className="px-1.5 py-1"><select className={clsx(cellCls, r.from_location === GATE && 'font-medium text-brand')} value={r.from_location} onChange={(e) => setRow(i, { from_location: e.target.value })}><option value="">From…</option>{locationOptions.map((n) => <option key={n} value={n}>{n}</option>)}</select></td>
                    <td className="px-1.5 py-1"><select className={clsx(cellCls, r.to_location === GATE && 'font-medium text-brand')} value={r.to_location} onChange={(e) => setRow(i, { to_location: e.target.value })}><option value="">To…</option>{locationOptions.map((n) => <option key={n} value={n}>{n}</option>)}</select></td>
                    <td className="px-1.5 py-1 w-28"><input type="time" className={cellCls} value={r.departure_time} onChange={(e) => setRow(i, { departure_time: e.target.value })} /></td>
                    <td className="px-1.5 py-1 w-40"><select className={cellCls} value={r.driver_name} onChange={(e) => setRow(i, { driver_name: e.target.value })}><option value="">Driver…</option>{drivers.map((dr) => <option key={dr.id} value={dr.full_name}>{dr.full_name}</option>)}</select></td>
                    <td className="px-1.5 py-1"><button onClick={() => removeRow(i)} className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={addRow} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs font-medium text-brand hover:border-brand"><Plus size={14} /> Add row</button>
            <Button className="ml-auto" onClick={saveAll} disabled={readyRows.length === 0}><Check size={15} /> Save {readyRows.length} trip{readyRows.length === 1 ? '' : 's'}</Button>
          </div>
          <p className="mt-2 text-[11px] text-status-neutral">Tip: choose <b>Pickup</b> or <b>Knock-off</b> for new rows, fill the bus + where it's coming from / going to, then save the whole sheet at once.</p>
        </div>
      )}

      {/* The day's plan — table on desktop, cards on mobile */}
      {trips.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center text-sm text-status-neutral">
          <Bus size={26} className="text-status-neutral/60" /> No trips planned for {prettyDate(date)}.{canPlan && ' Build the plan above.'}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-navy text-white">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Time</th><th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Bus</th><th className="px-4 py-2.5 font-medium">Route</th>
                    <th className="px-4 py-2.5 font-medium">Driver</th>{canPlan && <th className="px-4 py-2.5" />}
                  </tr>
                </thead>
                <tbody>
                  {trips.map((t, i) => (
                    <tr key={t.id} className={clsx(i % 2 && 'bg-canvas/40', editing?.id === t.id && 'ring-2 ring-inset ring-brand')}>
                      <td className="px-4 py-2.5 font-display font-bold text-navy">{t.departure_time || '—'}</td>
                      <td className="px-4 py-2.5"><TypePill type={t.trip_type} /></td>
                      <td className="px-4 py-2.5 text-navy">{t.fleet_no}{t.reg_no && <span className="text-status-neutral"> · {t.reg_no}</span>}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={clsx('font-medium', t.from_location === GATE ? 'text-brand' : 'text-navy')}>{t.from_location}</span>
                          <ArrowRight size={13} className="text-status-neutral" />
                          <span className={clsx('font-medium', t.to_location === GATE ? 'text-brand' : 'text-navy')}>{t.to_location}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-status-neutral">{t.driver_name || '—'}</td>
                      {canPlan && (
                        <td className="px-4 py-2.5"><div className="flex justify-end gap-1">
                          <button onClick={() => setEditing(t)} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => confirm('Remove this trip?') && dailyPlanStore.remove(t.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button>
                        </div></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {trips.map((t) => (
              <div key={t.id} className="card flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3.5">
                <span className="flex w-14 shrink-0 items-center gap-1 font-display text-base font-bold text-navy"><Clock size={13} className="text-brand" /> {t.departure_time || '—'}</span>
                <TypePill type={t.trip_type} />
                <div className="min-w-[140px] flex-1">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className={clsx('font-semibold', t.from_location === GATE ? 'text-brand' : 'text-navy')}>{t.from_location}</span>
                    <ArrowRight size={13} className="shrink-0 text-status-neutral" />
                    <span className={clsx('font-semibold', t.to_location === GATE ? 'text-brand' : 'text-navy')}>{t.to_location}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-status-neutral"><Bus size={11} className="mr-1 inline" />{t.fleet_no}{t.driver_name ? ` · ${t.driver_name}` : ''}</div>
                </div>
                {canPlan && (
                  <div className="ml-auto flex gap-1">
                    <button onClick={() => setEditing(t)} className="rounded-md p-2 text-status-neutral hover:bg-canvas hover:text-navy"><Pencil size={15} /></button>
                    <button onClick={() => confirm('Remove this trip?') && dailyPlanStore.remove(t.id)} className="rounded-md p-2 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={15} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <EditTripModal trip={editing} onClose={() => setEditing(null)} vehicles={vehicles} drivers={drivers} locations={locationOptions} />
      <PlacesModal open={placesOpen} onClose={() => setPlacesOpen(false)} branch={branch} />

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
      {!canPlan && <p className="text-xs text-status-neutral">View only — Bus Controllers, Route Supervisors and Operations can edit the plan.</p>}
    </div>
  )
}

function EditTripModal({ trip, onClose, vehicles, drivers, locations }: { trip: DailyPlanTrip | null; onClose: () => void; vehicles: any[]; drivers: any[]; locations: string[] }) {
  const [f, setF] = useState<DraftRow | null>(null)
  const [key, setKey] = useState('')
  const k = trip?.id ?? ''
  if (k !== key) { setKey(k); setF(trip ? { trip_type: trip.trip_type, fleet_no: trip.fleet_no, reg_no: trip.reg_no, from_location: trip.from_location, to_location: trip.to_location, departure_time: trip.departure_time, driver_name: trip.driver_name } : null) }
  if (!trip || !f) return null

  const set = (patch: Partial<DraftRow>) => setF((p) => (p ? { ...p, ...patch } : p))
  const optsFor = (val: string) => (val && !locations.includes(val) ? [val, ...locations] : locations)
  const fleetOpts = f.fleet_no && !vehicles.some((v) => v.fleet_no === f.fleet_no) ? [f.fleet_no, ...vehicles.map((v) => v.fleet_no)] : vehicles.map((v) => v.fleet_no)
  const driverOpts = f.driver_name && !drivers.some((d) => d.full_name === f.driver_name) ? [f.driver_name, ...drivers.map((d) => d.full_name)] : drivers.map((d) => d.full_name)
  function onFleet(v: string) { const veh = vehicles.find((x) => x.fleet_no === v); setF((p) => (p ? { ...p, fleet_no: v, reg_no: veh ? veh.reg_plate : '' } : p)) }
  function save() {
    if (!f!.fleet_no.trim() || !f!.from_location.trim() || !f!.to_location.trim()) return
    dailyPlanStore.update(trip!.id, {
      trip_type: f!.trip_type, fleet_no: f!.fleet_no.trim(), reg_no: f!.reg_no.trim(), driver_name: f!.driver_name.trim(),
      from_location: f!.from_location.trim(), to_location: f!.to_location.trim(), departure_time: f!.departure_time,
    })
    onClose()
  }
  return (
    <Modal open={!!trip} onClose={onClose} title="Edit trip" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Type</span><select className={inputCls} value={f.trip_type} onChange={(e) => set(withGate(f, e.target.value as TripType))}><option value="pickup">Pickup</option><option value="knockoff">Knock-off</option></select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Departure time</span><input type="time" className={inputCls} value={f.departure_time} onChange={(e) => set({ departure_time: e.target.value })} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Bus (fleet no)</span><select className={inputCls} value={f.fleet_no} onChange={(e) => onFleet(e.target.value)}><option value="">Select bus…</option>{fleetOpts.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reg No</span><div className="flex h-[42px] items-center rounded-lg border border-black/10 bg-canvas px-3 text-sm text-navy">{f.reg_no || '—'}</div></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">From</span><select className={inputCls} value={f.from_location} onChange={(e) => set({ from_location: e.target.value })}><option value="">Select…</option>{optsFor(f.from_location).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">To</span><select className={inputCls} value={f.to_location} onChange={(e) => set({ to_location: e.target.value })}><option value="">Select…</option>{optsFor(f.to_location).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="col-span-2 block"><span className="mb-1 block text-xs font-medium text-navy">Driver</span><select className={inputCls} value={f.driver_name} onChange={(e) => set({ driver_name: e.target.value })}><option value="">Select driver…</option>{driverOpts.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
    </Modal>
  )
}

// Manage the pick-up / drop-off places that fill the From / To dropdowns.
function PlacesModal({ open, onClose, branch }: { open: boolean; onClose: () => void; branch: BranchCode }) {
  const places = useLocations(branch)
  const [name, setName] = useState('')
  function add() { const n = name.trim(); if (!n) return; locationsStore.add(branch, n); setName('') }
  return (
    <Modal open={open} onClose={onClose} title="Places" subtitle="Pick-up & drop-off points used in the From / To dropdowns."
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className={inputCls} placeholder="Add a place (e.g. Kisasa)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} autoFocus />
          <Button onClick={add} disabled={!name.trim()}><Plus size={15} /> Add</Button>
        </div>
        <div className="divide-y divide-black/5 rounded-lg border border-black/10">
          {places.map((p) => (
            <div key={p} className="flex items-center gap-2 px-3 py-2 text-sm">
              <MapPin size={14} className="text-status-neutral" />
              <span className="flex-1 text-navy">{p}</span>
              {p === GATE
                ? <span className="text-[11px] text-status-neutral">always available</span>
                : <button onClick={() => locationsStore.remove(branch, p)} className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical" title="Remove"><X size={14} /></button>}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-status-neutral">Places are shared with everyone on this branch and appear in the From / To dropdowns immediately.</p>
      </div>
    </Modal>
  )
}
