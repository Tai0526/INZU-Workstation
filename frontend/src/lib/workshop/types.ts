import type { BranchCode } from '@/lib/roles'
import type { StatusTone } from '@/components/ui/StatusBadge'

/**
 * Workshop job cards — a vehicle fault / repair job.
 *
 * Flow (the Asst Operations Manager is the department approver; the Workshop
 * Supervisor is responsible day-to-day):
 *  - A fault is found — by a driver's Daily Checklist, or raised directly — and a
 *    job card is raised → the vehicle goes into the workshop (or grounded for a
 *    critical fault) immediately.
 *  - When the repair is done the Supervisor submits it for SIGN-OFF (tyre jobs
 *    can log the tyre change to Tyre Management at this point).
 *  - The Asst Ops Manager APPROVES → the vehicle goes back into service and the
 *    card closes; or REJECTS → it returns to the workshop.
 */
export type JobStatus = 'open' | 'awaiting_approval' | 'closed'
export type JobSeverity = 'minor' | 'major' | 'critical'
export type JobCategory = 'mechanical' | 'tyre' | 'electrical' | 'body' | 'service' | 'other'

export const JOB_STATUS_META: Record<JobStatus, { label: string; tone: StatusTone }> = {
  open: { label: 'In workshop', tone: 'warning' },
  awaiting_approval: { label: 'Awaiting sign-off', tone: 'warning' },
  closed: { label: 'Back in service', tone: 'good' },
}
export const SEVERITY_META: Record<JobSeverity, { label: string; tone: StatusTone; grounds: boolean }> = {
  minor: { label: 'Minor', tone: 'neutral', grounds: false },
  major: { label: 'Major', tone: 'warning', grounds: false },
  critical: { label: 'Critical — grounds the bus', tone: 'critical', grounds: true },
}
export const JOB_CATEGORY_LABEL: Record<JobCategory, string> = {
  mechanical: 'Mechanical', tyre: 'Tyre', electrical: 'Electrical', body: 'Body', service: 'Service', other: 'Other',
}

/** A scanned copy / photo of the physical job card (proof of the work done). */
export interface JobFile { id: string; name: string; at: string; by: string }
/** One entry in a workshop item's audit trail. */
export interface WsTrail { at: string; by: string; action: string; detail?: string }

export interface JobCard {
  id: string
  branch: BranchCode
  fleet_no: string
  reg_no: string
  driver_name: string
  fault: string
  severity: JobSeverity
  category: JobCategory
  vehicle_status: 'under_repair' | 'grounded'
  mechanics: string[]
  status: JobStatus
  work_done: string
  reported_by: string
  reported_at: string
  completed_by: string
  completed_at: string
  approved_by: string
  approved_at: string
  rejected_note: string
  notes: string
  checklist_id: string // the Daily Checklist this job came from ('' if raised directly)
  card_files?: JobFile[] // scanned/photographed physical job card(s) — required before sign-off
  trail?: WsTrail[] // audit trail: raised / repaired / approved / rejected / files
  created_by: string; created_at: string; updated_by: string; updated_at: string
}
export type JobCardInput = Omit<JobCard, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>
export const isJobOpen = (j: JobCard) => j.status !== 'closed'

// ── Daily checklists (driver pre-trip inspection) ───────────────────────
export interface ChecklistItem { key: string; label: string; ok: boolean; note: string; tyre?: boolean }
export const CHECK_POINTS: { key: string; label: string; tyre?: boolean }[] = [
  { key: 'brakes', label: 'Brakes' },
  { key: 'tyres', label: 'Tyres & wheels', tyre: true },
  { key: 'lights', label: 'Lights & indicators' },
  { key: 'oil', label: 'Oil & coolant' },
  { key: 'wipers', label: 'Wipers & washers' },
  { key: 'horn', label: 'Horn' },
  { key: 'mirrors', label: 'Mirrors & windscreen' },
  { key: 'seatbelts', label: 'Seatbelts' },
  { key: 'body', label: 'Body & doors' },
  { key: 'leaks', label: 'Leaks (fuel / oil / water)' },
]
export interface Checklist {
  id: string
  branch: BranchCode
  date: string
  fleet_no: string
  reg_no: string
  driver_name: string
  items: ChecklistItem[]
  job_ids: string[] // job cards raised from this checklist's faults
  notes: string
  created_by: string; created_at: string; updated_by: string; updated_at: string
}
export type ChecklistInput = Omit<Checklist, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>
export const checklistFaults = (c: Checklist) => c.items.filter((i) => !i.ok)
export const hasTyreFault = (c: Checklist) => c.items.some((i) => !i.ok && i.tyre)

// ── Tyre management (per-vehicle tyre history) ──────────────────────────
export const TYRE_POSITIONS = ['Front left', 'Front right', 'Rear left outer', 'Rear left inner', 'Rear right outer', 'Rear right inner', 'Spare']
export interface TyreRecord {
  id: string
  branch: BranchCode
  fleet_no: string
  reg_no: string
  position: string
  brand: string
  serial: string
  fitted_date: string
  odometer: number
  cost_usd: number | null
  reason: string
  job_id: string // the tyre job card it came from ('' if logged directly)
  notes: string
  created_by: string; created_at: string; updated_by: string; updated_at: string
}
export type TyreInput = Omit<TyreRecord, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

// ── PM / service schedules (per vehicle) ────────────────────────────────
// A service is due by DISTANCE (every interval_km, from the last-service odometer)
// or by TIME (every interval_days), whichever comes first. The live odometer is
// read from the Fuel module (captured at every refuel).
export interface PmConfig { interval_days: number; interval_km: number; last_service_date: string; last_service_odo: number; notes: string }
export const DEFAULT_PM: PmConfig = { interval_days: 90, interval_km: 10000, last_service_date: '', last_service_odo: 0, notes: '' }
export type PmState = 'ok' | 'soon' | 'overdue' | 'unset'
export const PM_META: Record<PmState, { label: string; tone: StatusTone }> = {
  ok: { label: 'On schedule', tone: 'good' },
  soon: { label: 'Due soon', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'critical' },
  unset: { label: 'Not scheduled', tone: 'neutral' },
}
const DAY = 86_400_000
export const PM_SOON_KM = 1000 // flag as "due soon" within this many km
export const PM_SOON_DAYS = 14
/** Days-only status (kept for the notifications roll-up that has no odometer). */
export function pmStatus(cfg: PmConfig, todayISO: string): { state: PmState; dueDate: string; daysLeft: number | null } {
  if (!cfg.last_service_date || !cfg.interval_days) return { state: 'unset', dueDate: '', daysLeft: null }
  const due = new Date(`${cfg.last_service_date}T00:00:00`).getTime() + cfg.interval_days * DAY
  const dueDate = new Date(due).toISOString().slice(0, 10)
  const daysLeft = Math.round((due - new Date(`${todayISO}T00:00:00`).getTime()) / DAY)
  const state: PmState = daysLeft < 0 ? 'overdue' : daysLeft <= PM_SOON_DAYS ? 'soon' : 'ok'
  return { state, dueDate, daysLeft }
}

export interface PmService {
  state: PmState
  dueDate: string        // yyyy-mm-dd from the time interval ('' if none)
  daysLeft: number | null
  dueOdo: number | null  // odometer at which the next service falls due
  kmLeft: number | null  // km until due (negative = overdue by distance)
  progress: number       // 0..1+ of the interval consumed (>1 = overdue)
  latestOdo: number | null
}
/** Odometer-aware status: due by km OR by days, whichever is closer. */
export function pmService(cfg: PmConfig, latestOdo: number | null, todayISO: string): PmService {
  const hasKm = (cfg.interval_km || 0) > 0 && (cfg.last_service_odo || 0) > 0 && latestOdo != null
  const hasDays = (cfg.interval_days || 0) > 0 && !!cfg.last_service_date
  if (!hasKm && !hasDays) return { state: 'unset', dueDate: '', daysLeft: null, dueOdo: null, kmLeft: null, progress: 0, latestOdo }

  let dueOdo: number | null = null, kmLeft: number | null = null, kmProg = 0
  if (hasKm) {
    dueOdo = cfg.last_service_odo + cfg.interval_km
    kmLeft = dueOdo - (latestOdo as number)
    kmProg = ((latestOdo as number) - cfg.last_service_odo) / cfg.interval_km
  }
  let dueDate = '', daysLeft: number | null = null, dayProg = 0
  if (hasDays) {
    const due = new Date(`${cfg.last_service_date}T00:00:00`).getTime() + cfg.interval_days * DAY
    dueDate = new Date(due).toISOString().slice(0, 10)
    daysLeft = Math.round((due - new Date(`${todayISO}T00:00:00`).getTime()) / DAY)
    dayProg = 1 - daysLeft / cfg.interval_days
  }
  const overdue = (kmLeft != null && kmLeft < 0) || (daysLeft != null && daysLeft < 0)
  const soon = (kmLeft != null && kmLeft <= PM_SOON_KM) || (daysLeft != null && daysLeft <= PM_SOON_DAYS)
  return { state: overdue ? 'overdue' : soon ? 'soon' : 'ok', dueDate, daysLeft, dueOdo, kmLeft, progress: Math.max(0, kmProg, dayProg), latestOdo }
}

// ── Monthly vehicle inspection (thorough, at least once per calendar month) ──
// Every vehicle must get one detailed inspection a month. A mechanic is assigned
// a date; after the inspection the findings are recorded, and any jobs found are
// raised as job cards. Ops/Asst Ops see which buses haven't been done — overdue,
// with how many days — so nothing slips through a whole month unchecked.
export type InspectionStatus = 'scheduled' | 'done'
export type InspectionResult = 'pass' | 'advisory' | 'fail'
export const INSPECTION_RESULT_META: Record<InspectionResult, { label: string; tone: StatusTone }> = {
  pass: { label: 'Passed', tone: 'good' },
  advisory: { label: 'Advisories', tone: 'warning' },
  fail: { label: 'Failed — jobs raised', tone: 'critical' },
}
export interface InspectionItem { key: string; label: string; ok: boolean; note: string }
export const INSPECTION_GROUPS = ['Engine & drivetrain', 'Brakes, tyres & steering', 'Electrical', 'Body, cabin & safety'] as const
export const INSPECTION_POINTS: { key: string; label: string; group: (typeof INSPECTION_GROUPS)[number] }[] = [
  { group: 'Engine & drivetrain', key: 'engine', label: 'Engine — oil, coolant, leaks, belts' },
  { group: 'Engine & drivetrain', key: 'transmission', label: 'Gearbox, clutch & transmission' },
  { group: 'Engine & drivetrain', key: 'exhaust', label: 'Exhaust & emissions' },
  { group: 'Engine & drivetrain', key: 'fuel_sys', label: 'Fuel system & filters' },
  { group: 'Brakes, tyres & steering', key: 'brakes', label: 'Brakes — pads, discs, lines, handbrake' },
  { group: 'Brakes, tyres & steering', key: 'suspension', label: 'Suspension & shocks' },
  { group: 'Brakes, tyres & steering', key: 'steering', label: 'Steering & alignment' },
  { group: 'Brakes, tyres & steering', key: 'tyres', label: 'Tyres & wheels — tread, pressure, wheel nuts' },
  { group: 'Electrical', key: 'lights', label: 'Lights, indicators & reflectors' },
  { group: 'Electrical', key: 'battery', label: 'Battery & charging' },
  { group: 'Electrical', key: 'instruments', label: 'Gauges, wipers & horn' },
  { group: 'Body, cabin & safety', key: 'body', label: 'Body, doors, mirrors & windscreen' },
  { group: 'Body, cabin & safety', key: 'seats', label: 'Seats & seatbelts' },
  { group: 'Body, cabin & safety', key: 'safety_kit', label: 'Fire extinguisher, first-aid & triangles' },
]
export const freshInspectionItems = (): InspectionItem[] => INSPECTION_POINTS.map((p) => ({ key: p.key, label: p.label, ok: true, note: '' }))

export interface MonthlyInspection {
  id: string
  branch: BranchCode
  month: string          // yyyy-mm this inspection covers
  fleet_no: string
  reg_no: string
  mechanic: string       // assigned mechanic (full name)
  scheduled_date: string // yyyy-mm-dd planned
  status: InspectionStatus
  done_date: string      // yyyy-mm-dd actually inspected ('' until done)
  odometer: number
  items: InspectionItem[]
  result: InspectionResult
  findings: string       // what needs work / summary
  notes: string
  job_ids: string[]      // job cards raised from this inspection
  trail?: WsTrail[]      // audit trail: scheduled / rescheduled / completed / jobs raised
  created_by: string; created_at: string; updated_by: string; updated_at: string
}
export type MonthlyInspectionInput = Omit<MonthlyInspection, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>
export const inspectionFaults = (i: MonthlyInspection) => i.items.filter((x) => !x.ok)

export type InspState = 'done' | 'overdue' | 'today' | 'upcoming' | 'unscheduled'
export const INSP_STATE_META: Record<InspState, { label: string; tone: StatusTone }> = {
  done: { label: 'Inspected', tone: 'good' },
  overdue: { label: 'Overdue', tone: 'critical' },
  today: { label: 'Due today', tone: 'warning' },
  upcoming: { label: 'Scheduled', tone: 'neutral' },
  unscheduled: { label: 'Not scheduled', tone: 'warning' },
}
/** Last calendar day of a yyyy-mm month, as yyyy-mm-dd (timezone-safe). */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const day = new Date(y, m, 0).getDate() // day 0 of the next month = last day of this one
  return `${month}-${String(day).padStart(2, '0')}`
}
export interface InspStatusInfo { state: InspState; dueDate: string; daysOver: number }
/** Where a vehicle's monthly inspection stands. Its due date is the scheduled date,
 *  or the month-end if it was never scheduled; overdue counts the days past due. */
export function inspectionStatus(insp: MonthlyInspection | undefined, month: string, todayISO: string): InspStatusInfo {
  if (insp && insp.status === 'done') return { state: 'done', dueDate: insp.done_date || insp.scheduled_date, daysOver: 0 }
  const due = insp?.scheduled_date || monthEnd(month)
  const days = Math.round((new Date(`${todayISO}T00:00:00`).getTime() - new Date(`${due}T00:00:00`).getTime()) / DAY)
  if (days > 0) return { state: 'overdue', dueDate: due, daysOver: days }
  if (days === 0) return { state: 'today', dueDate: due, daysOver: 0 }
  return { state: insp ? 'upcoming' : 'unscheduled', dueDate: due, daysOver: 0 }
}

// ── Critical spares (inventory) ─────────────────────────────────────────
export interface Spare {
  id: string
  branch: BranchCode
  name: string
  part_no: string
  qty: number
  min_qty: number
  unit: string
  location: string
  notes: string
  created_by: string; created_at: string; updated_by: string; updated_at: string
}
export type SpareInput = Omit<Spare, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>
export const spareLow = (s: Spare) => s.qty <= s.min_qty

// ── Failure / RCA log ───────────────────────────────────────────────────
export type RcaStatus = 'open' | 'closed'
export const RCA_META: Record<RcaStatus, { label: string; tone: StatusTone }> = {
  open: { label: 'Open', tone: 'warning' }, closed: { label: 'Closed', tone: 'good' },
}
export interface Rca {
  id: string
  branch: BranchCode
  date: string
  fleet_no: string
  title: string
  failure: string
  root_cause: string
  corrective: string
  preventive: string
  owner: string
  status: RcaStatus
  created_by: string; created_at: string; updated_by: string; updated_at: string
}
export type RcaInput = Omit<Rca, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

// ── Mechanics work / rest schedule (crew rotation, like the drivers) ────
// Mechanics are grouped into crews; each crew runs a continuous rotation —
// `onDays` worked then `offDays` rested (default 14 on / 7 off) — from a start
// (anchor) date. The three default crews are staggered so all three overlap for
// one full week each 21-day cycle (the "all-hands" week). A mechanic's month
// roster is derived from the crew they're on.
export type MechShiftKind = 'day' | 'night'
export interface MechCrew {
  id: string
  name: string
  shift: MechShiftKind
  start: string // ISO date the crew's ON block began (rotation anchor)
  onDays: number // consecutive days worked
  offDays: number // consecutive days rested
}
// Offsets 0 / +4 / +7 days give a 7-day window where all three crews are on.
export const DEFAULT_MECH_CREWS: MechCrew[] = [
  { id: 'MA', name: 'Crew A', shift: 'day', start: '2026-06-01', onDays: 14, offDays: 7 },
  { id: 'MB', name: 'Crew B', shift: 'night', start: '2026-06-05', onDays: 14, offDays: 7 },
  { id: 'MC', name: 'Crew C', shift: 'day', start: '2026-06-08', onDays: 14, offDays: 7 },
]
export const SHIFT_LABEL: Record<MechShiftKind, string> = { day: 'Day', night: 'Night' }

/** Is a crew on shift on `dateISO`, per its on/off rotation from its start date? */
export function crewOnDate(crew: MechCrew, dateISO: string): boolean {
  const cycle = Math.max(1, (crew.onDays || 0) + (crew.offDays || 0))
  const ms = new Date(`${dateISO}T00:00:00`).getTime() - new Date(`${crew.start || dateISO}T00:00:00`).getTime()
  const diff = Math.floor(ms / 86_400_000)
  const idx = ((diff % cycle) + cycle) % cycle
  return idx < (crew.onDays || 0)
}
