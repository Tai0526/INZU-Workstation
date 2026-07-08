import { useMemo, useState } from 'react'
import { Check, AlertTriangle, XCircle, History, Ban, Clock, MapPin } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import type { BranchCode } from '@/lib/roles'
import { useDrivers } from '@/lib/drivers/store'
import { useDrivingUsers } from '@/lib/drivers/drivingUsers'
import { useUsers } from '@/lib/auth/users'
import { useVehicles } from '@/lib/fleet/store'
import { useAllocations } from '@/lib/operations/store'
import { useSpeedEvents, speedStore } from '@/lib/speed/store'
import { useSpeedGeo, suggestDrivers } from '@/lib/speed/geo'
import {
  type SpeedEvent, type SpeedEventInput, type SpeedStatus, STATUS_META, overBy, countsAgainstDriver,
  SPEED_ZONES, effectiveLimit, bandFor, penaltyFor, penaltyTone, penaltyLabel, offenceNumberInBand,
} from '@/lib/speed/types'
import { casesStore, useCases, CASE_STAGE_META } from '@/lib/safety/cases'
import { ShieldAlert } from 'lucide-react'

const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th', '6th']
const PENALTY_TONE_CLS: Record<string, string> = {
  critical: 'border-status-critical/30 bg-status-critical/5 text-status-critical',
  warning: 'border-status-warning/40 bg-status-warning/10 text-[#8a6d10]',
  neutral: 'border-black/10 bg-canvas text-navy',
  good: 'border-status-good/30 bg-status-good/5 text-status-good',
}

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

const empty = (branch: BranchCode): SpeedEventInput => ({
  branch, event_datetime: '', driver_id: '', driver_name: '', vehicle_id: '', vehicle_label: '',
  route: '', recorded_speed: 0, speed_limit: 60, status: 'flagged', source: 'Geotab', notes: '',
  resolved_by: '', resolved_at: '',
})

export default function SpeedEventModal({
  open, onClose, editing, branch, canEdit,
}: {
  open: boolean
  onClose: () => void
  editing: SpeedEvent | null
  branch: BranchCode
  canEdit: boolean
}) {
  const drivers = useDrivers().filter((d) => d.branch === branch)
  const users = useUsers()
  const drivingIds = useDrivingUsers()
  const vehicles = useVehicles().filter((v) => v.branch === branch)
  const allEvents = useSpeedEvents()
  const allCases = useCases()
  const allocations = useAllocations().filter((a) => a.branch === branch)
  const geoMap = useSpeedGeo()
  const geo = editing ? geoMap[editing.id] : undefined
  const [form, setForm] = useState<SpeedEventInput | SpeedEvent>(() => (editing ? { ...editing } : empty(branch)))
  const [error, setError] = useState('')

  // Registered drivers + any system users flagged "can drive" for this branch — the
  // pool the speeding driver is confirmed against (a route supervisor or bus
  // controller may have been the one driving).
  const driverOptions = useMemo(() => {
    const opts = drivers.map((d) => ({ id: d.id, name: d.full_name, staff: false }))
    const seen = new Set(opts.map((o) => o.name.trim().toLowerCase()))
    for (const u of users) {
      if (!drivingIds.includes(u.id)) continue
      if (u.branch !== branch && !(u.extra_branches ?? []).includes(branch)) continue
      const k = u.full_name.trim().toLowerCase()
      if (!k || seen.has(k)) continue
      seen.add(k)
      opts.push({ id: u.id, name: u.full_name, staff: true })
    }
    return opts.sort((a, b) => a.name.localeCompare(b.name))
  }, [drivers, users, drivingIds, branch])

  // The Geotab report carries no driver, so suggest the most likely one to confirm against.
  const suggestions = useMemo(
    () => (form.driver_name ? [] : suggestDrivers(form.vehicle_label, form.event_datetime, { allocations, events: allEvents })),
    [form.driver_name, form.vehicle_label, form.event_datetime, allocations, allEvents],
  )
  function pickDriver(name: string) {
    const d = driverOptions.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase())
    setForm((f) => ({ ...f, driver_name: name, driver_id: d?.id ?? '' }))
  }

  const key = (editing?.id ?? 'new') + String(open)
  const [lastKey, setLastKey] = useState('')
  if (open && key !== lastKey) {
    setForm(editing ? { ...editing } : empty(branch))
    setError('')
    setLastKey(key)
  }

  function set<K extends keyof SpeedEvent>(k: K, v: SpeedEvent[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function onDriver(id: string) {
    const d = driverOptions.find((x) => x.id === id)
    setForm((f) => ({ ...f, driver_id: id, driver_name: d?.name ?? '' }))
  }
  function onVehicle(id: string) {
    const v = vehicles.find((x) => x.id === id)
    setForm((f) => ({ ...f, vehicle_id: id, vehicle_label: v?.fleet_no ?? '' }))
  }

  // Driver history — same driver, excluding this event. "Done it before?"
  const history = allEvents
    .filter((e) => e.id !== editing?.id && (form.driver_id ? e.driver_id === form.driver_id : !!form.driver_name && e.driver_name === form.driver_name))
    .sort((a, b) => b.event_datetime.localeCompare(a.event_datetime))
  const priorAgainst = history.filter(countsAgainstDriver).length

  // Live penalty preview from current form values + the driver's same-band history.
  const liveOver = Math.max(0, Math.round((Number(form.recorded_speed) || 0) - effectiveLimit(Number(form.speed_limit) || 0)))
  const liveBand = bandFor(liveOver)
  const priorSameBand = history.filter(
    (e) => countsAgainstDriver(e) && bandFor(overBy(e))?.key === liveBand?.key && (!form.event_datetime || e.event_datetime <= form.event_datetime),
  ).length
  const liveOffence = liveBand ? priorSameBand + 1 : 0
  const penalty = penaltyFor(liveOver, liveOffence)

  function save() {
    if (!form.event_datetime) return setError('Date/time of the event is required.')
    if (form.status === 'confirmed' && !form.driver_name) return setError('Confirmed events need a driver — pick one or leave it pending.')
    if (!form.recorded_speed || !form.speed_limit) return setError('Recorded speed and limit are required.')
    if (editing) speedStore.update(editing.id, form)
    else speedStore.add(form)
    onClose()
  }

  // Resolve a pending/open event: persist any driver + notes edits, then set the
  // status. Confirming requires a driver; writing off keeps it in the record but
  // does NOT count it against the driver.
  function decide(status: SpeedStatus) {
    if (!editing) return
    if (status === 'confirmed' && !form.driver_name) { setError('Pick the driver before confirming.'); return }
    speedStore.update(editing.id, { driver_id: form.driver_id, driver_name: form.driver_name, notes: form.notes })
    speedStore.setStatus(editing.id, status)
    onClose()
  }

  // Escalation → disciplinary incident (carries the recommendation + repeat history)
  const existingCase = allCases.find((c) => c.event_id === editing?.id)
  function escalate() {
    if (!editing) return
    const branchEvents = allEvents.filter((e) => e.branch === editing.branch)
    const over = overBy(editing)
    const offN = offenceNumberInBand(branchEvents, editing)
    const pen = penaltyFor(over, offN)
    const repeatTotal = branchEvents.filter(
      (e) => (e.driver_id || e.driver_name) === (editing.driver_id || editing.driver_name) && countsAgainstDriver(e),
    ).length
    casesStore.create({
      branch: editing.branch, event_id: editing.id, driver_id: editing.driver_id, driver_name: editing.driver_name,
      vehicle_label: editing.vehicle_label, route: editing.route, event_datetime: editing.event_datetime,
      over_by: over, recorded_speed: editing.recorded_speed, speed_limit: editing.speed_limit,
      rec_band: pen?.bandKey ?? '—', rec_action: pen?.action ?? 'No charge', rec_fine: pen?.fine ?? 0,
      rec_offence: pen?.offence ?? offN, repeat_total: repeatTotal,
    })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? 'Speed event' : 'Log speed event'}
      subtitle={editing ? `${editing.driver_name} · ${editing.vehicle_label}` : 'Record a Geotab-flagged event'}
      footer={canEdit ? <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>{editing ? 'Save changes' : 'Log event'}</Button></> : <Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {error && <div className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>}

      {/* Likely-driver suggestions (the Geotab report carries no driver) */}
      {canEdit && !form.driver_name && suggestions.length > 0 && (
        <div className="mb-4 rounded-lg border border-brand/30 bg-brand-tint/30 px-3 py-2.5">
          <div className="mb-1.5 text-xs font-semibold text-navy">Likely driver — pick one, then confirm after speaking to them</div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button key={s.name} type="button" onClick={() => pickDriver(s.name)} title={s.basis}
                className="rounded-full border border-brand/40 bg-white px-2.5 py-1 text-xs text-navy hover:border-brand">
                {s.name} <span className="text-status-neutral">· {s.basis}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Geotab detail — how long, how far, and where it happened */}
      {geo && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-black/10 bg-canvas px-3 py-2 text-xs text-status-neutral">
          <span className="inline-flex items-center gap-1"><Clock size={13} /> <span className="font-medium text-navy">{geo.dur}s</span> over the limit</span>
          <span><span className="font-medium text-navy">{geo.dist.toFixed(2)} km</span> while speeding</span>
          {(geo.lat !== 0 || geo.lng !== 0) && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)}</span>}
          {geo.loc && <span className="max-w-[280px] truncate" title={geo.loc}>{geo.loc}</span>}
        </div>
      )}

      {/* Repeat-offender banner */}
      {form.driver_name && (
        <div className={`mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${priorAgainst >= 2 ? 'bg-status-critical/10 text-status-critical' : priorAgainst === 1 ? 'bg-status-warning/10 text-[#8a6d10]' : 'bg-status-good/10 text-status-good'}`}>
          <History size={16} />
          {priorAgainst === 0
            ? `${form.driver_name} has no prior speed events — first offence.`
            : `${form.driver_name} has ${priorAgainst} prior event${priorAgainst === 1 ? '' : 's'} — ${priorAgainst >= 2 ? 'repeat offender.' : 'done it before.'}`}
        </div>
      )}

      {/* Recommended penalty (live) */}
      {form.driver_name && liveOver >= 5 && (
        <div className={`mb-4 rounded-lg border px-3 py-2.5 ${PENALTY_TONE_CLS[penaltyTone(penalty)]}`}>
          <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">Recommended charge</div>
          <div className="text-sm font-bold">{penaltyLabel(penalty)}</div>
          <div className="mt-0.5 text-xs opacity-90">
            {liveBand?.label} · {ordinals[liveOffence] ?? `${liveOffence}th`} offence in this band · {liveOver} km/h over the {effectiveLimit(Number(form.speed_limit) || 0)} limit
          </div>
          {penalty?.dismissal && <div className="mt-1 text-xs font-bold">⚠ Dismissal threshold reached for this band.</div>}
        </div>
      )}
      {form.driver_name && liveOver > 0 && liveOver < 5 && (
        <div className="mb-4 rounded-lg border border-black/10 bg-canvas px-3 py-2 text-xs text-status-neutral">
          {liveOver} km/h over — below the 5 km/h charge threshold (no penalty).
        </div>
      )}

      <fieldset disabled={!canEdit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Date &amp; time *</span>
          <input type="datetime-local" className={inputCls} value={form.event_datetime} onChange={(e) => set('event_datetime', e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Source</span>
          <input className={inputCls} value={form.source} onChange={(e) => set('source', e.target.value)} />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Driver *</span>
          <select className={inputCls} value={form.driver_id} onChange={(e) => onDriver(e.target.value)}>
            <option value="">{form.driver_name || 'Select driver…'}</option>
            {driverOptions.map((d) => <option key={d.id} value={d.id}>{d.name}{d.staff ? ' · staff' : ''}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Vehicle</span>
          <select className={inputCls} value={form.vehicle_id} onChange={(e) => onVehicle(e.target.value)}>
            <option value="">{form.vehicle_label || 'Select vehicle…'}</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.fleet_no}</option>)}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-navy">Speed zone (sets the limit)</span>
          <select
            className={inputCls}
            value={SPEED_ZONES.some((z) => z.limit === form.speed_limit) ? String(form.speed_limit) : ''}
            onChange={(e) => e.target.value && set('speed_limit', Number(e.target.value))}
          >
            <option value="">Custom limit…</option>
            {SPEED_ZONES.map((z) => <option key={z.limit} value={z.limit}>{z.label}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Route / area</span>
          <input className={inputCls} value={form.route} onChange={(e) => set('route', e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Recorded (km/h) *</span>
            <input type="number" className={inputCls} value={form.recorded_speed || ''} onChange={(e) => set('recorded_speed', Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Limit (km/h) *</span>
            <input type="number" className={inputCls} value={form.speed_limit || ''} onChange={(e) => set('speed_limit', Number(e.target.value))} />
          </label>
        </div>

        <div className="sm:col-span-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Notes / dispute narrative</span>
            <textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
        </div>
      </fieldset>

      {/* Status + actions */}
      {editing && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-canvas px-3 py-2.5">
          <span className="text-xs font-medium text-status-neutral">Status</span>
          <StatusBadge tone={STATUS_META[editing.status].tone}>{STATUS_META[editing.status].label}</StatusBadge>
          {editing.resolved_by && <span className="text-[11px] text-status-neutral">by {editing.resolved_by}</span>}
          {canEdit && (
            <div className="ml-auto flex flex-wrap gap-1.5">
              <Button onClick={() => decide('confirmed')}><Check size={14} /> Confirm</Button>
              <Button variant="secondary" onClick={() => decide('dismissed')}><Ban size={14} /> Write off</Button>
              <Button variant="secondary" onClick={() => decide('disputed')}><AlertTriangle size={14} /> Dispute</Button>
              <Button variant="secondary" onClick={() => decide('closed')}><XCircle size={14} /> Close</Button>
            </div>
          )}
        </div>
      )}

      {/* Escalation to disciplinary incident */}
      {editing && editing.status === 'confirmed' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand-tint/40 px-3 py-2.5">
          <ShieldAlert size={16} className="text-brand" />
          {existingCase ? (
            <span className="text-sm text-navy">Escalated to incident — <span className="font-medium">{CASE_STAGE_META[existingCase.stage].label}</span>. Manage it in Safety → Incidents.</span>
          ) : (
            <>
              <span className="flex-1 text-sm text-navy">Push this confirmed offence to Safety as a disciplinary incident — it carries the recommended charge and repeat history.</span>
              {canEdit && <Button onClick={escalate}>Escalate to incident</Button>}
            </>
          )}
        </div>
      )}

      {/* Driver history */}
      {history.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">This driver’s history ({history.length})</div>
          <div className="max-h-40 overflow-auto rounded-lg border border-black/10">
            <table className="w-full text-left text-sm">
              <tbody>
                {history.map((e) => (
                  <tr key={e.id} className="border-b border-black/5 last:border-0">
                    <td className="px-3 py-1.5 text-navy">{e.event_datetime.slice(0, 10)}</td>
                    <td className="px-3 py-1.5 text-status-neutral">{e.recorded_speed}/{e.speed_limit} (+{overBy(e)})</td>
                    <td className="px-3 py-1.5 text-status-neutral">{e.route}</td>
                    <td className="px-3 py-1.5 text-right"><StatusBadge tone={STATUS_META[e.status].tone}>{STATUS_META[e.status].label}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}
