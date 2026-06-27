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
export interface PmConfig { interval_days: number; last_service_date: string; last_service_odo: number; notes: string }
export const DEFAULT_PM: PmConfig = { interval_days: 90, last_service_date: '', last_service_odo: 0, notes: '' }
export type PmState = 'ok' | 'soon' | 'overdue' | 'unset'
export const PM_META: Record<PmState, { label: string; tone: StatusTone }> = {
  ok: { label: 'On schedule', tone: 'good' },
  soon: { label: 'Due soon', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'critical' },
  unset: { label: 'Not scheduled', tone: 'neutral' },
}
const DAY = 86_400_000
/** Compute next-service date and status from a PM config. */
export function pmStatus(cfg: PmConfig, todayISO: string): { state: PmState; dueDate: string; daysLeft: number | null } {
  if (!cfg.last_service_date || !cfg.interval_days) return { state: 'unset', dueDate: '', daysLeft: null }
  const due = new Date(`${cfg.last_service_date}T00:00:00`).getTime() + cfg.interval_days * DAY
  const dueDate = new Date(due).toISOString().slice(0, 10)
  const daysLeft = Math.round((due - new Date(`${todayISO}T00:00:00`).getTime()) / DAY)
  const state: PmState = daysLeft < 0 ? 'overdue' : daysLeft <= 14 ? 'soon' : 'ok'
  return { state, dueDate, daysLeft }
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

// ── Mechanics work / rest schedule ──────────────────────────────────────
export interface MechShift { workdays: number[]; shift: 'day' | 'night' }
export const DEFAULT_MECH_SHIFT: MechShift = { workdays: [1, 2, 3, 4, 5, 6], shift: 'day' }
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const SHIFT_LABEL: Record<MechShift['shift'], string> = { day: 'Day', night: 'Night' }
