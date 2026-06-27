import type { BranchCode } from '@/lib/roles'
import type { StatusTone } from '@/components/ui/StatusBadge'

/**
 * Workshop job cards — a vehicle fault / repair job.
 *
 * Flow (the Asst Operations Manager is the department approver; the Workshop
 * Supervisor is responsible day-to-day):
 *  - The Supervisor RAISES a job card → the vehicle goes into the workshop
 *    (under_repair) — or grounded for a critical fault — immediately, so an
 *    unsafe bus is off the road at once.
 *  - When the repair is done the Supervisor submits it for SIGN-OFF.
 *  - The Asst Ops Manager (or Ops Manager / Admin) APPROVES → the vehicle goes
 *    back into service and the card closes; or REJECTS → it returns to the
 *    workshop for more work.
 * Vehicle status changes and pending sign-offs notify the relevant parties.
 */
export type JobStatus = 'open' | 'awaiting_approval' | 'closed'
export type JobSeverity = 'minor' | 'major' | 'critical'

export const JOB_STATUS_META: Record<JobStatus, { label: string; tone: StatusTone }> = {
  open: { label: 'In workshop', tone: 'warning' },
  awaiting_approval: { label: 'Awaiting sign-off', tone: 'warning' },
  closed: { label: 'Back in service', tone: 'good' },
}

// `grounds` = a critical fault takes the bus fully out of service (grounded)
// rather than just into the workshop.
export const SEVERITY_META: Record<JobSeverity, { label: string; tone: StatusTone; grounds: boolean }> = {
  minor: { label: 'Minor', tone: 'neutral', grounds: false },
  major: { label: 'Major', tone: 'warning', grounds: false },
  critical: { label: 'Critical — grounds the bus', tone: 'critical', grounds: true },
}

export interface JobCard {
  id: string
  branch: BranchCode
  fleet_no: string // bus, e.g. INZ 226
  reg_no: string
  driver_name: string // who was driving / reported the fault
  fault: string
  severity: JobSeverity
  vehicle_status: 'under_repair' | 'grounded' // what the bus was set to while in the workshop
  mechanics: string[] // assigned mechanics (from HR)
  status: JobStatus
  work_done: string // what was fixed (captured at completion)
  reported_by: string
  reported_at: string
  completed_by: string
  completed_at: string
  approved_by: string
  approved_at: string
  rejected_note: string // why a sign-off was sent back
  notes: string
  // ── audit ──
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}
export type JobCardInput = Omit<JobCard, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

/** Open = still in the workshop (not yet signed back into service). */
export const isJobOpen = (j: JobCard) => j.status !== 'closed'

// ── Mechanics work / rest schedule ──────────────────────────────────────
// A simple weekly pattern per mechanic (which weekdays they work + which shift).
// `workdays` holds weekday indices, 0 = Sunday … 6 = Saturday.
export interface MechShift {
  workdays: number[]
  shift: 'day' | 'night'
}
export const DEFAULT_MECH_SHIFT: MechShift = { workdays: [1, 2, 3, 4, 5, 6], shift: 'day' } // Mon–Sat, day
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const SHIFT_LABEL: Record<MechShift['shift'], string> = { day: 'Day', night: 'Night' }
