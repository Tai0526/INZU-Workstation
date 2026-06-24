import type { BranchCode } from '@/lib/roles'
import type { StatusTone } from '@/components/ui/StatusBadge'

export interface Audited {
  id: string
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

// ── Route library (the plan baseline source) ───────────────────────────
export interface OpRoute extends Audited {
  branch: BranchCode
  name: string
  code: string
  distance_km: number // planned (paid) distance for one run
  notes: string
}

// ── Daily bus allocation (the plan) — one row per run, as logged daily ──
// A run is a pickup (to site) or a knock-off (home); a bus does several of each.
export type TripType = 'pickup' | 'knockoff'
export const TRIP_LABEL: Record<TripType, string> = { pickup: 'Pickup', knockoff: 'Knock-off' }

export interface Allocation extends Audited {
  branch: BranchCode
  date: string // yyyy-mm-dd
  trip_type: TripType
  driver_name: string
  fleet_no: string // e.g. INZ 226
  reg_no: string // e.g. BCG 4666
  route_id: string // selected route (carries the distance)
  location: string // route / destination name (display)
  departure_time: string // HH:MM
  passengers: number | null
  planned_km: number // the route's distance — shown as mileage, not typed
  notes: string
  plan_trip_id?: string // the Daily Plan trip this run fulfils (links actual ↔ plan)
}
export type AllocationInput = Omit<Allocation, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

// ── Mileage (the actual distance) ──────────────────────────────────────
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export const APPROVAL_META: Record<ApprovalStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Pending approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'critical' },
}

export interface MileageEntry extends Audited {
  branch: BranchCode
  date: string
  vehicle_id: string
  vehicle_label: string
  driver_id: string
  driver_name: string
  actual_km: number
  status: ApprovalStatus
  approved_by: string
  approved_at: string
  notes: string
}

// ── Daily plan (the intended movements) ────────────────────────────────
// How buses SHOULD move on a day: driver, bus, from → to, departure time.
// (Bus Allocation is the ACTUAL report of how they moved — with passengers.)
export const DEFAULT_TO_LOCATION = 'Main Mine Gate'

export interface DailyPlanTrip extends Audited {
  branch: BranchCode
  date: string // yyyy-mm-dd
  trip_type: TripType // pickup (→ Main Mine Gate) or knock-off (Main Mine Gate →)
  driver_name: string
  fleet_no: string // bus, e.g. INZ 226
  reg_no: string // auto-filled from the vehicle
  from_location: string
  to_location: string // defaults to Main Mine Gate
  departure_time: string // HH:MM
  notes: string
}
export type DailyPlanInput = Omit<DailyPlanTrip, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

// ── Weekly driver ↔ vehicle planning ───────────────────────────────────
// Assigns drivers to a specific vehicle for a week (Monday-anchored). One
// vehicle can carry several drivers (e.g. a day + a night driver). An assignment
// created from an off-duty driver is flagged as overtime (covering a shortage).
export interface WeeklyAssignment extends Audited {
  branch: BranchCode
  week_start: string // yyyy-mm-dd — period start (a Friday by default; shift change Fri 10:00)
  week_end: string // yyyy-mm-dd — inclusive last day of the period
  // Actual days covered (defaults to the whole period). Used for partial overtime
  // cover — e.g. a driver covering only 3 of the 7 days because leave overran.
  cover_start?: string
  cover_end?: string
  fleet_no: string
  driver_id: string
  driver_name: string
  overtime: boolean
}
export type WeeklyAssignmentInput = Omit<WeeklyAssignment, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

