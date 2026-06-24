import type { BranchCode } from '@/lib/roles'
import type { StatusTone } from '@/components/ui/StatusBadge'
import { daysUntil, EXPIRY_WARNING_DAYS } from '@/lib/documents/types'
import { scheduledShift } from '@/lib/drivers/schedule'
import { schedulingStore, windowForKind, blocksForKind, inAnyBlock, shiftBlocks } from '@/lib/drivers/scheduling'
import { effectiveShiftDef } from '@/lib/drivers/driverShifts'

// ── Crews & shifts (spec §4.3.2) ───────────────────────────────────────
// Crews are admin-configurable (Admin → Scheduling) — A, B, C… each optionally
// linked to a shift. `crew` therefore stores a crew id (string). By default
// Crew A works Day and Crew B works Night; see lib/drivers/scheduling.ts.
// The actual hours depend on the section's shift PATTERN:
//   • split   — most Trident sections: two blocks with a break between
//   • straight — Pit & Security (and Kansanshi): one continuous 12-hour block
export type Crew = string
export type ShiftKey = 'day' | 'night'
export type PatternKey = 'split' | 'straight'

/** Legacy default crew→shift map. Live mapping comes from scheduling config. */
export const CREW_SHIFT: Record<string, ShiftKey> = { A: 'day', B: 'night' }
export const SHIFT_LABEL: Record<ShiftKey, string> = { day: 'Day', night: 'Night' }

// Sections that run the straight 12-hour shift (continuous). Everything else on
// Trident is split. Pit (both mines), Security and Dewatering run continuous.
const isStraightSection = (section: string) => section.startsWith('Pit') || section === 'Security' || section === 'Dewatering'

export function patternFor(branch: BranchCode, section: string): PatternKey {
  if (branch === 'trident') return isStraightSection(section) ? 'straight' : 'split'
  return 'straight' // Kansanshi: straight day/night (assumed — adjust when confirmed)
}

// Shift windows come from the configured shift times (Admin → Scheduling),
// resolved by day/night kind so a change there reflects everywhere.
export function shiftWindow(_pattern: PatternKey, shift: ShiftKey): string {
  return windowForKind(schedulingStore.get(), shift) || '—'
}
export function shiftWindowCompact(_pattern: PatternKey, shift: ShiftKey): string {
  return windowForKind(schedulingStore.get(), shift) || '—'
}

export type DriverStatus = 'active' | 'on_leave' | 'suspended'

export interface Driver {
  id: string
  employee_no: string
  full_name: string
  branch: BranchCode
  phone: string
  licence_no: string
  licence_class: string
  licence_expiry: string // ISO yyyy-mm-dd
  psv_expiry: string
  date_hired: string
  crew: Crew
  section: string // one of SECTIONS[branch]
  status: DriverStatus
  schedule_anchor?: string // ISO date the rotation cycle started (pattern derives from section)
  overtime: boolean // mock — derived from Fuel activity outside shift window later
  photo_file_id: string // profile picture, key into the IndexedDB file store ('' = none)
  notes: string
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

export type DriverInput = Omit<Driver, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

// ── Live shift state ───────────────────────────────────────────────────
export function isShiftActiveNow(_pattern: PatternKey, shift: ShiftKey, now = new Date()): boolean {
  return inAnyBlock(blocksForKind(schedulingStore.get(), shift), now)
}

export type ShiftState = 'on_shift' | 'overtime' | 'off' | 'leave' | 'suspended'

export const SHIFT_STATE_META: Record<ShiftState, { label: string; tone: StatusTone }> = {
  on_shift: { label: 'On shift', tone: 'good' },
  overtime: { label: 'Overtime', tone: 'warning' },
  off: { label: 'Off', tone: 'neutral' },
  leave: { label: 'On leave', tone: 'neutral' },
  suspended: { label: 'Suspended', tone: 'critical' },
}

export function driverShiftState(d: Driver, now = new Date()): ShiftState {
  if (d.status === 'suspended') return 'suspended'
  if (d.status === 'on_leave') return 'leave'
  const sched = scheduledShift(d, now)
  // Working a scheduled rest day = overtime (covering). Otherwise the rotation rules.
  if (sched === 'off') return d.overtime ? 'overtime' : 'off'
  // On a work day, "on shift now" uses the driver's own shift window (morning,
  // afternoon, etc.) rather than the generic day/night window.
  return inAnyBlock(shiftBlocks(effectiveShiftDef(d)), now) ? 'on_shift' : 'off'
}

// ── Compliance expiry (licence / PSV). Medical & site classes live in
// Safety → Driver Compliance. ─────────────────────────────────────────
export type ExpiryStatus = 'current' | 'expiring' | 'expired' | 'none'

export const EXPIRY_TONE: Record<ExpiryStatus, StatusTone> = {
  current: 'good', expiring: 'warning', expired: 'critical', none: 'neutral',
}

export function expiryStatus(iso: string, now = new Date()): ExpiryStatus {
  const d = daysUntil(iso, now)
  if (d === null) return 'none'
  if (d < 0) return 'expired'
  if (d <= EXPIRY_WARNING_DAYS) return 'expiring'
  return 'current'
}

export interface ComplianceItem { label: string; date: string; status: ExpiryStatus }

export function complianceItems(d: Driver, now = new Date()): ComplianceItem[] {
  return [
    { label: 'Driving licence', date: d.licence_expiry, status: expiryStatus(d.licence_expiry, now) },
    { label: 'PSV permit', date: d.psv_expiry, status: expiryStatus(d.psv_expiry, now) },
  ]
}

/** Worst expiry status across a driver's compliance items (for sorting/flags). */
export function worstExpiry(d: Driver, now = new Date()): ExpiryStatus {
  const rank: Record<ExpiryStatus, number> = { expired: 0, expiring: 1, current: 2, none: 3 }
  return complianceItems(d, now).reduce<ExpiryStatus>(
    (worst, c) => (rank[c.status] < rank[worst] ? c.status : worst),
    'none',
  )
}
