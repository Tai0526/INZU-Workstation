import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Download, FileText, ArrowRight, Bus, Clock, Check } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Button from '@/components/ui/Button'
import { useVehicles } from '@/lib/fleet/store'
import { useDrivers } from '@/lib/drivers/store'
import { useRoutes, useDailyPlan, dailyPlanStore } from '@/lib/operations/store'
import { DEFAULT_TO_LOCATION, TRIP_LABEL, type DailyPlanInput, type DailyPlanTrip, type TripType } from '@/lib/operations/types'
import { exportDailyPlan } from '@/lib/operations/excel'
import { downloadTablePdf, type PdfTable } from '@/lib/reports/pdfDoc'

const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2.5 text-sm text-navy outline-none focus:border-brand'
type FormState = { driver_name: string; fleet_no: string; reg_no: string; from_location: string; to_location: string; departure_time: string }
const blankForm = (t: TripType): FormState => ({
  driver_name: '', fleet_no: '', reg_no: '', departure_time: '',
  from_location: t === 'knockoff' ? DEFAULT_TO_LOCATION : '',
  to_location: t === 'pickup' ? DEFAULT_TO_LOCATION : '',
})

export default function DailyPlan() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canPlan = canEdit(role, 'operations') || role === 'route_supervisor'

  // Only active (in-service) buses can be planned.
  const vehicles = useVehicles().filter((v) => v.branch === branch && v.status === 'active')
  const drivers = useDrivers().filter((d) => d.branch === branch)
  const routes = useRoutes().filter((r) => r.branch === branch)
  const plan = useDailyPlan()

  const [date, setDate] = useState(todayISO())
  const [tripType, setTripType] = useState<TripType>('pickup')
  const [form, setForm] = useState<FormState>(() => blankForm('pickup'))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [gateOverride, setGateOverride] = useState(false)
  const [error, setError] = useState('')

  const trips = useMemo(
    () => plan.filter((t) => t.branch === branch && t.date === date).sort((a, b) => a.departure_time.localeCompare(b.departure_time)),
    [plan, branch, date],
  )
  const pickups = trips.filter((t) => t.trip_type !== 'knockoff')
  const knockoffs = trips.filter((t) => t.trip_type === 'knockoff')

  const locationOptions = useMemo(() => {
    const names = new Set<string>([DEFAULT_TO_LOCATION, ...routes.map((r) => r.name)])
    return [...names].filter(Boolean)
  }, [routes])

  // The non-gate end is the one you actually enter; the gate end auto-fills.
  const primaryField: keyof FormState = tripType === 'pickup' ? 'from_location' : 'to_location'
  const gateField: keyof FormState = tripType === 'pickup' ? 'to_location' : 'from_location'

  function set<K extends keyof FormState>(k: K, v: FormState[K]) { setForm((p) => ({ ...p, [k]: v })); setError('') }
  function onFleet(v: string) {
    const veh = vehicles.find((x) => x.fleet_no.toLowerCase() === v.trim().toLowerCase())
    setForm((p) => ({ ...p, fleet_no: v, reg_no: veh ? veh.reg_plate : p.reg_no })); setError('')
  }
  function chooseType(t: TripType) {
    setTripType(t)
    setGateOverride(false)
    setForm((p) => t === 'pickup'
      ? { ...p, to_location: DEFAULT_TO_LOCATION, from_location: p.from_location === DEFAULT_TO_LOCATION ? '' : p.from_location }
      : { ...p, from_location: DEFAULT_TO_LOCATION, to_location: p.to_location === DEFAULT_TO_LOCATION ? '' : p.to_location })
    setError('')
  }
  function startEdit(id: string) {
    const t = trips.find((x) => x.id === id); if (!t) return
    setEditingId(id); setTripType(t.trip_type)
    const gate = t.trip_type === 'pickup' ? t.to_location : t.from_location
    setGateOverride(gate !== DEFAULT_TO_LOCATION)
    setForm({ driver_name: t.driver_name, fleet_no: t.fleet_no, reg_no: t.reg_no, from_location: t.from_location, to_location: t.to_location, departure_time: t.departure_time })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function cancelEdit() { setEditingId(null); setForm(blankForm(tripType)); setGateOverride(false); setError('') }
  function submit() {
    if (!form.fleet_no.trim()) return setError('Pick the bus (fleet number).')
    if (!form.from_location.trim() || !form.to_location.trim()) return setError(`Enter where to ${tripType === 'pickup' ? 'pick up from' : 'drop off'}.`)
    const payload: DailyPlanInput = {
      branch, date, trip_type: tripType, driver_name: form.driver_name.trim(), fleet_no: form.fleet_no.trim(), reg_no: form.reg_no.trim(),
      from_location: form.from_location.trim(), to_location: form.to_location.trim(), departure_time: form.departure_time, notes: '',
    }
    if (editingId) dailyPlanStore.update(editingId, payload)
    else dailyPlanStore.add(payload)
    setEditingId(null)
    setForm(blankForm(tripType)) // keep the mode for the next trip
    setGateOverride(false)
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
    <div className="rounded-xl border border-black/10 bg-white px-3 py-2">
      <div className="text-lg font-bold leading-none text-navy">{value}</div>
      <div className="mt-0.5 text-[11px] text-status-neutral">{label}</div>
    </div>
  )

  return (
    <div className="page space-y-4">
      <p className="max-w-2xl text-sm text-status-neutral">
        The day's <span className="font-medium text-navy">intended movements</span>. Pick <span className="font-medium text-navy">Pickup</span> or
        <span className="font-medium text-navy"> Knock-off</span> once — it sticks and fills in Main Mine Gate — then just add bus, time and the pick-up point. This is what
        <span className="font-medium text-navy"> Bus Allocation</span> checks the actual runs against.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand" />
        {date === todayISO() && <span className="rounded-full bg-status-good/10 px-2 py-0.5 text-xs font-medium text-status-good">Today</span>}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => exportDailyPlan(trips, branchLabel)} disabled={trips.length === 0}><Download size={15} /> Excel</Button>
          <Button variant="secondary" onClick={exportPdf} disabled={trips.length === 0}><FileText size={15} /> PDF</Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {stat('Trips', trips.length)}
        {stat('Pickups', pickups.length)}
        {stat('Knock-offs', knockoffs.length)}
      </div>

      {/* Quick add / edit — mobile-first */}
      {canPlan && (
        <div className="card space-y-3 p-4">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-sm font-bold text-navy">{editingId ? 'Edit trip' : 'Add trip'}</h3>
            {editingId && <button onClick={cancelEdit} className="ml-auto text-xs font-medium text-status-neutral hover:text-navy">Cancel edit</button>}
          </div>

          {/* Pickup / Knock-off — full-width segmented, sticks for the next trip */}
          <div className="grid grid-cols-2 gap-2">
            {(['pickup', 'knockoff'] as TripType[]).map((t) => (
              <button key={t} onClick={() => chooseType(t)}
                className={clsx('rounded-lg border py-2.5 text-sm font-semibold transition-colors', tripType === t ? 'border-navy bg-navy text-white' : 'border-black/15 bg-white text-navy hover:bg-canvas')}>
                {TRIP_LABEL[t]}
              </button>
            ))}
          </div>

          {error && <div className="rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Bus (fleet no)</span>
              <input list="dp-fleet" className={inputCls} value={form.fleet_no} onChange={(e) => onFleet(e.target.value)} placeholder="INZ 226" />
              {form.reg_no && <span className="mt-1 block text-[11px] text-status-neutral">Reg: <span className="font-medium text-navy">{form.reg_no}</span></span>}
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Departure time</span>
              <input type="time" className={inputCls} value={form.departure_time} onChange={(e) => set('departure_time', e.target.value)} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-navy">{tripType === 'pickup' ? 'Pick up from' : 'Drop off at'}</span>
              <input list="dp-locations" className={inputCls} value={form[primaryField]} onChange={(e) => set(primaryField, e.target.value)} placeholder={tripType === 'pickup' ? 'Pick-up point' : 'Drop-off point'} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-navy">Driver <span className="text-status-neutral">(optional)</span></span>
              <input list="dp-drivers" className={inputCls} value={form.driver_name} onChange={(e) => set('driver_name', e.target.value)} placeholder="Driver name" />
            </label>
          </div>

          {/* The Main Mine Gate end — auto, with an optional override */}
          {!gateOverride ? (
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-status-neutral">
              {tripType === 'pickup'
                ? <><span>→</span> <span className="font-medium text-brand">{form.to_location || DEFAULT_TO_LOCATION}</span></>
                : <><span className="font-medium text-brand">{form.from_location || DEFAULT_TO_LOCATION}</span> <span>→</span></>}
              <button onClick={() => setGateOverride(true)} className="ml-1 text-xs font-medium text-brand hover:underline">change</button>
            </div>
          ) : (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">{tripType === 'pickup' ? 'To' : 'From'}</span>
              <input list="dp-locations" className={inputCls} value={form[gateField]} onChange={(e) => set(gateField, e.target.value)} placeholder={DEFAULT_TO_LOCATION} />
            </label>
          )}

          <Button onClick={submit} className="w-full justify-center py-3 text-base">
            {editingId ? <><Check size={16} /> Save trip</> : <><Plus size={16} /> Add {TRIP_LABEL[tripType].toLowerCase()}</>}
          </Button>
        </div>
      )}

      {/* Trips */}
      {trips.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center text-sm text-status-neutral">
          <Bus size={26} className="text-status-neutral/60" />
          No trips planned for {date}.{canPlan && ' Add the first one above.'}
        </div>
      ) : (
        <div className="space-y-4">
          <TripGroup title="Pickups" trips={pickups} canPlan={canPlan} onEdit={startEdit} editingId={editingId} />
          <TripGroup title="Knock-offs" trips={knockoffs} canPlan={canPlan} onEdit={startEdit} editingId={editingId} />
        </div>
      )}

      <datalist id="dp-drivers">{drivers.map((d) => <option key={d.id} value={d.full_name} />)}</datalist>
      <datalist id="dp-fleet">{vehicles.map((v) => <option key={v.id} value={v.fleet_no} />)}</datalist>
      <datalist id="dp-locations">{locationOptions.map((n) => <option key={n} value={n} />)}</datalist>

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
      {!canPlan && <p className="text-xs text-status-neutral">View only — Bus Controllers, Route Supervisors and Operations can edit the plan.</p>}
    </div>
  )
}

function TripGroup({ title, trips, canPlan, onEdit, editingId }: { title: string; trips: DailyPlanTrip[]; canPlan: boolean; onEdit: (id: string) => void; editingId: string | null }) {
  if (trips.length === 0) return null
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="font-display text-sm font-bold text-navy">{title}</h3>
        <span className="rounded-full bg-navy/5 px-2 py-0.5 text-[11px] font-semibold text-navy">{trips.length}</span>
      </div>
      <div className="space-y-2">
        {trips.map((t) => (
          <div key={t.id} className={clsx('card flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5', editingId === t.id && 'ring-2 ring-brand')}>
            <div className="flex w-16 shrink-0 items-center gap-1.5 font-display text-base font-bold text-navy">
              <Clock size={14} className="text-brand" /> {t.departure_time || '—'}
            </div>
            <div className="min-w-[150px] flex-1">
              <div className="flex items-center gap-1.5 text-sm text-navy">
                <span className={clsx('font-semibold', t.from_location === DEFAULT_TO_LOCATION ? 'text-brand' : 'text-navy')}>{t.from_location}</span>
                <ArrowRight size={14} className="shrink-0 text-status-neutral" />
                <span className={clsx('font-semibold', t.to_location === DEFAULT_TO_LOCATION ? 'text-brand' : 'text-navy')}>{t.to_location}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-status-neutral">
                <span className="inline-flex items-center gap-1"><Bus size={12} /> {t.fleet_no}{t.reg_no ? ` · ${t.reg_no}` : ''}</span>
                {t.driver_name && <span>{t.driver_name}</span>}
              </div>
            </div>
            {canPlan && (
              <div className="ml-auto flex gap-1">
                <button onClick={() => onEdit(t.id)} className="rounded-md p-2 text-status-neutral hover:bg-canvas hover:text-navy" title="Edit"><Pencil size={15} /></button>
                <button onClick={() => confirm('Remove this trip?') && dailyPlanStore.remove(t.id)} className="rounded-md p-2 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical" title="Remove"><Trash2 size={15} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
