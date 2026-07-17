import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Gauge, ShieldCheck, GraduationCap, ShieldAlert, Camera, ChevronRight, Plane, FolderOpen } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import DriverAvatar from '@/components/drivers/DriverAvatar'
import DriverDocuments from '@/components/drivers/DriverDocuments'
import { useAuth } from '@/auth/AuthContext'
import { BRANCHES } from '@/lib/roles'
import { putFile } from '@/lib/storage/fileStore'
import { useDrivers, driversStore } from '@/lib/drivers/store'
import {
  type Driver, SHIFT_STATE_META, driverShiftState,
  complianceItems, EXPIRY_TONE,
} from '@/lib/drivers/types'
import { useScheduling, crewLabel } from '@/lib/drivers/scheduling'
import { useDriverShifts } from '@/lib/drivers/driverShifts'
import { scheduledShift, dutyLabel, dutyHours, driverShiftOnDate, SHIFT_META } from '@/lib/drivers/schedule'
import { leaveStore, useDriverLeave } from '@/lib/drivers/leave'
import { leaveLedgerStore, LEAVE_TYPES, LEAVE_TYPE_LABEL, type LeaveType } from '@/lib/hr/leaveLedger'
import { useSpeedEvents } from '@/lib/speed/store'
import { overBy, STATUS_META } from '@/lib/speed/types'
import { useCases, INCIDENT_TYPE_META, CASE_STAGE_META } from '@/lib/safety/cases'
import {
  useCompliance, useComplianceClasses, classMap, cellState, prereqsMet, isCompliantCell,
  useTraining, credStatus, CRED_STATUS_META, TRAINING_META,
} from '@/lib/safety/registers'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-status-neutral">{label}</div>
      <div className="text-sm text-navy">{value || '—'}</div>
    </div>
  )
}

// Who can place a driver on leave (Ops + Route Supervisors, plus the admin).
const LEAVE_MANAGER_ROLES = ['administrator', 'operations_manager', 'asst_operations_manager', 'route_supervisor']
const DAY_MS = 86_400_000
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDaysISO = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setTime(d.getTime() + n * DAY_MS); return isoOf(d) }
const daysInclusive = (a: string, b: string) => Math.max(1, Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / DAY_MS) + 1)

export default function DriverDetail({
  driver, open, onClose, canEdit, onEdit, onOpenFile,
}: {
  driver: Driver | null
  open: boolean
  onClose: () => void
  canEdit: boolean
  onEdit: (d: Driver) => void
  onOpenFile?: (d: Driver) => void
}) {
  const { user } = useAuth()
  const all = useDrivers()
  const sched = useScheduling()
  useDriverShifts() // re-render when this driver's shift assignment changes
  const leaveMap = useDriverLeave()
  const [leaveOpen, setLeaveOpen] = useState(false)
  const canManageLeave = LEAVE_MANAGER_ROLES.includes(user?.role ?? '')
  const photoInput = useRef<HTMLInputElement>(null)
  // Resolve the live record so photo/doc changes reflect without reopening.
  const d = all.find((x) => x.id === driver?.id) ?? driver
  if (!d) return null

  const leave = leaveMap[d.id]
  const branch = BRANCHES.find((b) => b.code === d.branch)!
  const todayType = scheduledShift(d)
  const shiftLabel = dutyLabel(d, todayType) // current Day/Night/Off (or Day/Afternoon for 7/7)
  const windowStr = dutyHours(d, todayType)
  const state = driverShiftState(d)
  const stateMeta = SHIFT_STATE_META[state]
  const comp = complianceItems(d)

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const fileId = `${d!.id}_photo_${Date.now()}`.replace(/\s/g, '')
    await putFile(fileId, f)
    driversStore.update(d!.id, { photo_file_id: fileId })
    e.target.value = ''
  }

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={d.full_name}
      subtitle={`${d.employee_no} · ${branch.short}`}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {canManageLeave ? <Button variant="secondary" onClick={() => setLeaveOpen(true)}><Plane size={14} /> {leave ? 'Manage leave' : 'Set on leave'}</Button> : <span />}
          <div className="flex gap-2">
            {onOpenFile && <Button variant="secondary" onClick={() => onOpenFile(d)}><FolderOpen size={14} /> HR file</Button>}
            <Button variant="secondary" onClick={onClose}>Close</Button>
            {canEdit && <Button onClick={() => onEdit(d)}><Pencil size={14} /> Edit</Button>}
          </div>
        </div>
      }
    >
      {/* Header: photo + shift/section chips */}
      <div className="mb-4 flex items-start gap-4">
        <div className="relative">
          <DriverAvatar name={d.full_name} photoFileId={d.photo_file_id} size={64} />
          {canEdit && (
            <>
              <button
                onClick={() => photoInput.current?.click()}
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-navy text-white hover:bg-navy-secondary"
                title="Upload photo"
              >
                <Camera size={12} />
              </button>
              <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={stateMeta.tone}>{stateMeta.label}</StatusBadge>
          <span className="rounded-full bg-navy/5 px-2.5 py-0.5 text-xs font-medium text-navy">Crew {crewLabel(sched, d.crew)} · {shiftLabel}{windowStr ? ` (${windowStr})` : ''}</span>
          <span className="rounded-full bg-navy/5 px-2.5 py-0.5 text-xs font-medium text-navy">{d.section}</span>
          {leave && <span className="inline-flex items-center gap-1 rounded-full bg-[#E7E0F5] px-2.5 py-0.5 text-xs font-medium text-[#5b4a86]"><Plane size={11} /> On leave · {leave.start} → {leave.end}</span>}
        </div>
      </div>

      {/* Record */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Row label="Branch" value={branch.short} />
        <Row label="Section" value={d.section} />
        <Row label="Crew / shift" value={`${crewLabel(sched, d.crew)} · ${shiftLabel}`} />
        <Row label="Date hired" value={d.date_hired} />
        <Row label="Licence no." value={d.licence_no} />
        <Row label="Licence class" value={d.licence_class} />
        <Row label="Phone" value={d.phone} />
      </div>

      {/* Compliance dates */}
      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">Compliance dates</div>
        <div className="overflow-hidden rounded-lg border border-black/10">
          <table className="w-full text-left text-sm">
            <tbody>
              {comp.map((c) => (
                <tr key={c.label} className="border-b border-black/5 last:border-0">
                  <td className="px-3 py-2 text-navy">{c.label}</td>
                  <td className="px-3 py-2 text-status-neutral">{c.date || '—'}</td>
                  <td className="px-3 py-2 text-right"><StatusBadge tone={EXPIRY_TONE[c.status]}>{c.status === 'none' ? 'Not set' : c.status}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Uploaded documents & certificates */}
      <div className="mt-5">
        <DriverDocuments driver={d} canEdit={canEdit} />
      </div>

      {/* Linked records — live previews for this driver */}
      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">Linked records</div>
        <div className="space-y-2">
          <CompliancePreview driver={d} />
          <SpeedPreview driver={d} />
          <IncidentsPreview driver={d} />
          <TrainingPreview driver={d} />
        </div>
      </div>

      {d.notes && <p className="mt-4 rounded-lg bg-canvas px-3 py-2 text-sm text-navy">{d.notes}</p>}
    </Modal>
    {leaveOpen && <LeaveModal driver={d} onClose={() => setLeaveOpen(false)} />}
    </>
  )
}

// Leave editor — set the driver on leave for N days (must start on a working day).
function LeaveModal({ driver, onClose }: { driver: Driver; onClose: () => void }) {
  const existing = leaveStore.for(driver.id)
  const [start, setStart] = useState(existing?.start || isoOf(new Date()))
  const [days, setDays] = useState(existing ? daysInclusive(existing.start, existing.end) : 7)
  const [type, setType] = useState<LeaveType>('annual')
  const [err, setErr] = useState('')
  const n = Math.max(1, Number(days) || 1)
  const end = addDaysISO(start, n - 1)
  const startOff = SHIFT_META[driverShiftOnDate(driver, start)].kind === 'off'

  function save() {
    if (startOff) { setErr('The driver is off-rotation on that start date — leave can only begin on a working day.'); return }
    leaveStore.set(driver.id, start, end)
    // Record it in the leave ledger so it counts toward the driver's balance & file
    // (only on a fresh grant, not an edit, to avoid double-counting).
    if (!existing) leaveLedgerStore.add({ branch: driver.branch, person_id: driver.id, person_name: driver.full_name, source: 'driver', kind: 'leave', type, start, end, days: n, note: '', attachment: null })
    onClose()
  }
  function endLeave() { leaveStore.clear(driver.id); onClose() }

  return (
    <Modal open onClose={onClose} title={`Leave — ${driver.full_name}`} subtitle="Put the driver on leave for a number of days"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {existing ? <Button variant="danger" onClick={endLeave}>End leave</Button> : <span />}
          <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>{existing ? 'Update leave' : 'Set on leave'}</Button></div>
        </div>
      }>
      {err && <div className="mb-3 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{err}</div>}
      {!existing && <label className="mb-3 block"><span className="mb-1 block text-xs font-medium text-navy">Leave type</span>
        <select className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand" value={type} onChange={(e) => setType(e.target.value as LeaveType)}>{LEAVE_TYPES.map((t) => <option key={t} value={t}>{LEAVE_TYPE_LABEL[t]}</option>)}</select></label>}
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Start date</span>
          <input type="date" className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand" value={start} onChange={(e) => { setStart(e.target.value); setErr('') }} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Days</span>
          <input type="number" min={1} className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand" value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
      </div>
      <div className="mt-2 flex gap-1">
        {[3, 5, 7, 14].map((q) => (
          <button key={q} type="button" onClick={() => setDays(q)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${n === q ? 'border-brand bg-brand-tint/60 text-navy' : 'border-black/15 text-navy hover:bg-canvas'}`}>{q}d</button>
        ))}
      </div>
      <p className="mt-3 text-xs text-status-neutral">On leave <b className="text-navy">{n} day{n === 1 ? '' : 's'}</b> · {start} → {end}.</p>
      {startOff && <p className="mt-2 rounded-lg bg-status-warning/10 px-3 py-2 text-[11px] text-[#8a6d10]">This driver is off-rotation on the selected start date — leave can only begin on a working day.</p>}
    </Modal>
  )
}

function PreviewCard({ to, icon: Icon, label, badge, empty, children }: {
  to: string; icon: typeof Gauge; label: string; badge?: React.ReactNode; empty?: boolean; children?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-black/10 bg-white">
      <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2">
        <Icon size={15} className="text-brand" />
        <span className="text-sm font-semibold text-navy">{label}</span>
        {badge}
        <Link to={to} className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-brand hover:underline">View <ChevronRight size={12} /></Link>
      </div>
      {empty ? <p className="px-3 py-2.5 text-xs text-status-neutral">No records.</p> : <div className="divide-y divide-black/5">{children}</div>}
    </div>
  )
}

const matchesDriver = (d: Driver) => (r: { driver_id?: string; driver_name?: string }) =>
  (r.driver_id && r.driver_id === d.id) || (!!r.driver_name && r.driver_name === d.full_name)

function CompliancePreview({ driver }: { driver: Driver }) {
  const creds = useCompliance().filter((c) => c.driver_id === driver.id)
  const classes = useComplianceClasses()
  const byKey = useMemo(() => classMap(classes), [classes])
  const prereqKeys = useMemo(() => classes.filter((c) => c.prerequisite).map((c) => c.key), [classes])
  const met = prereqsMet(creds, prereqKeys)
  const done = classes.filter((cls) => isCompliantCell(cellState(creds.find((c) => c.category === cls.key), cls.prerequisite, met))).length
  const pct = classes.length ? Math.round((done / classes.length) * 100) : 0
  const tone = pct === 100 ? 'good' : pct >= 60 ? 'warning' : 'critical'
  return (
    <PreviewCard to="/safety/compliance" icon={ShieldCheck} label="Driver compliance"
      badge={<span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tone === 'good' ? 'bg-status-good/10 text-status-good' : tone === 'warning' ? 'bg-status-warning/10 text-[#8a6d10]' : 'bg-status-critical/10 text-status-critical'}`}>{done}/{classes.length} · {pct}%</span>}>
      <div className="px-3 py-2 text-xs text-status-neutral">
        Prerequisites (medical + silicosis): {met ? <span className="font-medium text-status-good">current</span> : <span className="font-medium text-status-critical">incomplete — trainings locked</span>}
      </div>
      {creds.filter((c) => c.expiry && credStatus(c.expiry) !== 'valid').slice(0, 3).map((c) => (
        <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
          <span className="flex-1 text-navy">{byKey[c.category]?.label ?? c.category}</span>
          <span className="text-status-neutral">{c.expiry}</span>
          <StatusBadge tone={CRED_STATUS_META[credStatus(c.expiry)].tone}>{CRED_STATUS_META[credStatus(c.expiry)].label}</StatusBadge>
        </div>
      ))}
    </PreviewCard>
  )
}

function SpeedPreview({ driver }: { driver: Driver }) {
  const events = useSpeedEvents().filter(matchesDriver(driver)).sort((a, b) => b.event_datetime.localeCompare(a.event_datetime))
  return (
    <PreviewCard to="/speed/events" icon={Gauge} label="Speed events" empty={events.length === 0}
      badge={events.length > 0 ? <span className="rounded-full bg-navy/5 px-2 py-0.5 text-xs font-bold text-navy">{events.length}</span> : undefined}>
      {events.slice(0, 3).map((e) => (
        <div key={e.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
          <span className="text-navy">{e.event_datetime.slice(0, 10)}</span>
          <span className="text-status-critical">+{overBy(e)} km/h</span>
          <span className="flex-1 truncate text-status-neutral">{e.route}</span>
          <StatusBadge tone={STATUS_META[e.status].tone}>{STATUS_META[e.status].label}</StatusBadge>
        </div>
      ))}
    </PreviewCard>
  )
}

function IncidentsPreview({ driver }: { driver: Driver }) {
  const cases = useCases().filter(matchesDriver(driver)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return (
    <PreviewCard to="/safety/incidents" icon={ShieldAlert} label="Incidents" empty={cases.length === 0}
      badge={cases.length > 0 ? <span className="rounded-full bg-navy/5 px-2 py-0.5 text-xs font-bold text-navy">{cases.length}</span> : undefined}>
      {cases.slice(0, 3).map((c) => (
        <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
          <span className="flex-1 truncate text-navy">{INCIDENT_TYPE_META[c.incident_type].label}{c.source === 'speed' && c.over_by != null ? ` · +${c.over_by}` : ''}</span>
          <span className="text-status-neutral">{c.event_datetime.slice(0, 10)}</span>
          <StatusBadge tone={CASE_STAGE_META[c.stage].tone}>{CASE_STAGE_META[c.stage].label}</StatusBadge>
        </div>
      ))}
    </PreviewCard>
  )
}

function TrainingPreview({ driver }: { driver: Driver }) {
  const training = useTraining().filter((c) => c.driver_id === driver.id)
  return (
    <PreviewCard to="/safety/training" icon={GraduationCap} label="Training records" empty={training.length === 0}
      badge={training.length > 0 ? <span className="rounded-full bg-navy/5 px-2 py-0.5 text-xs font-bold text-navy">{training.length}</span> : undefined}>
      {training.slice(0, 3).map((c) => (
        <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
          <span className="flex-1 truncate text-navy">{TRAINING_META[c.category] ?? c.category}</span>
          <span className="text-status-neutral">{c.expiry || '—'}</span>
          {c.expiry && <StatusBadge tone={CRED_STATUS_META[credStatus(c.expiry)].tone}>{CRED_STATUS_META[credStatus(c.expiry)].label}</StatusBadge>}
        </div>
      ))}
    </PreviewCard>
  )
}
