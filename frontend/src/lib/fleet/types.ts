import type { BranchCode } from '@/lib/roles'
import type { StatusTone } from '@/components/ui/StatusBadge'

// ── Vehicle status (spec §4.2.2) ──────────────────────────────────────
// The single source of truth for whether a vehicle may be used anywhere
// else in the system. Only `active` vehicles are "available" — Fuel, Bus
// Allocation, Mileage and Speed all read availability from here, so a vehicle
// that is in the workshop or grounded automatically drops out of those flows.
export type VehicleStatus = 'active' | 'under_repair' | 'grounded'

export type VehicleType = 'bus' | 'tipper' | 'light_vehicle' | 'other'

export interface Vehicle {
  id: string
  fleet_no: string // primary human identity
  reg_plate: string
  make: string
  model: string
  year: number | null
  type: VehicleType
  branch: BranchCode
  status: VehicleStatus
  capacity: number | null
  colour: string
  chassis_no: string
  engine_no: string
  in_service_date: string // ISO yyyy-mm-dd
  notes: string
  // ── Audit attribution ──
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

/** Fields a user/import supplies — audit + id/timestamps are stamped by the store. */
export type VehicleInput = Omit<Vehicle, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>


export const STATUS_META: Record<VehicleStatus, { label: string; tone: StatusTone; available: boolean; hint: string }> = {
  active: { label: 'Active', tone: 'good', available: true, hint: 'On road — available for fuel, allocation, mileage and speed tracking.' },
  under_repair: { label: 'In Workshop', tone: 'warning', available: false, hint: 'Under repair — excluded from fuel, allocation and mileage until returned to service.' },
  grounded: { label: 'Grounded', tone: 'critical', available: false, hint: 'Out of service — cannot be fuelled, allocated or tracked.' },
}

export const TYPE_LABELS: Record<VehicleType, string> = {
  bus: 'Bus',
  tipper: 'Tipper',
  light_vehicle: 'Light Vehicle',
  other: 'Other',
}

/** The one rule every other module uses to decide if a vehicle can be used. */
export function isAvailable(v: Vehicle): boolean {
  return STATUS_META[v.status].available
}
