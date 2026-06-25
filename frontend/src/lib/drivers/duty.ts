import type { Driver } from './types'
import type { WeeklyAssignment } from '@/lib/operations/types'
import { driverShiftOnDate, SHIFT_META, type ShiftType } from './schedule'
import { isOnLeave } from './leave'

/**
 * Duty = what a driver actually did on a day, combining their work/rest ROTATION
 * with the WEEKLY PLAN assignment (which bus, or the workshop):
 *   • scheduled on  + assigned → worked that vehicle
 *   • scheduled off + assigned → overtime (covering) on that vehicle / in the workshop
 *   • scheduled off + nothing  → off / rest
 * A weekly assignment covers a PERIOD [week_start, week_end] (a Friday→Friday week
 * by default, or a custom period), so a date is matched by range containment.
 */

/** Sentinel "vehicle" used when a driver is assigned to workshop duty (not a bus). */
export const WORKSHOP = 'Workshop'

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function addDays(iso: string, n: number): string { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return isoOf(d) }

/** Friday (period start) of the Friday→Friday week containing dateISO. Friday is shift change. */
export function fridayOf(dateISO: string): string {
  const x = new Date(`${dateISO}T00:00:00`)
  const back = (x.getDay() - 5 + 7) % 7 // days since the last Friday (Fri→0 … Thu→6)
  x.setDate(x.getDate() - back)
  return isoOf(x)
}

export function datesInRange(startISO: string, endISO: string): string[] {
  const out: string[] = []
  let d = new Date(`${startISO}T00:00:00`)
  const end = new Date(`${endISO}T00:00:00`)
  while (d <= end) { out.push(isoOf(d)); d = new Date(d.getTime() + 86_400_000) }
  return out
}

export type DutyKind = 'worked' | 'overtime' | 'off' | 'leave' | 'suspended'
export interface DayDuty { shift: ShiftType; kind: DutyKind; vehicle: string; overtime: boolean }

// The actual days an assignment covers (partial overtime narrows these; otherwise
// the whole period, with legacy rows defaulting to a 7-day week).
const coverStart = (a: WeeklyAssignment) => a.cover_start || a.week_start
const coverEnd = (a: WeeklyAssignment) => a.cover_end || a.week_end || addDays(a.week_start, 6)

/** Index branch-scoped weekly assignments by driver id. */
export function buildAssignmentIndex(assigns: WeeklyAssignment[]): Map<string, WeeklyAssignment[]> {
  const m = new Map<string, WeeklyAssignment[]>()
  for (const a of assigns) {
    const l = m.get(a.driver_id) ?? []
    l.push(a)
    m.set(a.driver_id, l)
  }
  return m
}

/** What a driver did on a given date (rotation + the assignment whose cover covers it). */
export function dutyOn(driver: Driver, dateISO: string, idx: Map<string, WeeklyAssignment[]>): DayDuty {
  const shift = driverShiftOnDate(driver, dateISO)
  const isOff = SHIFT_META[shift].kind === 'off'
  const assignment = (idx.get(driver.id) ?? []).find((a) => coverStart(a) <= dateISO && dateISO <= coverEnd(a))
  const vehicle = assignment?.fleet_no ?? ''
  if (driver.status === 'suspended') return { shift, kind: 'suspended', vehicle: '', overtime: false }
  if (isOff) {
    if (assignment) return { shift, kind: 'overtime', vehicle, overtime: true }
    return { shift, kind: 'off', vehicle: '', overtime: false }
  }
  // Working day, but away on leave (date-bounded, or legacy status).
  if (driver.status === 'on_leave' || isOnLeave(driver.id, dateISO)) return { shift, kind: 'leave', vehicle: '', overtime: false }
  return { shift, kind: 'worked', vehicle, overtime: false }
}

export interface DriverDutySummary {
  driver: Driver
  worked: number
  off: number
  overtime: number
  vehicles: string[] // distinct vehicles on worked days
  otByVehicle: Record<string, number> // vehicle / workshop → overtime days
  daily: { dateISO: string; kind: DutyKind; vehicle: string }[]
}

/** Per-driver duty summary over a set of dates (for the weekly / monthly report). */
export function summarizeDuty(drivers: Driver[], dates: string[], idx: Map<string, WeeklyAssignment[]>): DriverDutySummary[] {
  return drivers.map((driver) => {
    let worked = 0, off = 0, overtime = 0
    const vehicles = new Set<string>()
    const otByVehicle: Record<string, number> = {}
    const daily: { dateISO: string; kind: DutyKind; vehicle: string }[] = []
    for (const dateISO of dates) {
      const d = dutyOn(driver, dateISO, idx)
      daily.push({ dateISO, kind: d.kind, vehicle: d.vehicle })
      if (d.kind === 'worked') { worked++; if (d.vehicle) vehicles.add(d.vehicle) }
      else if (d.kind === 'overtime') { overtime++; const v = d.vehicle || '—'; otByVehicle[v] = (otByVehicle[v] ?? 0) + 1 }
      else if (d.kind === 'off') off++
    }
    return { driver, worked, off, overtime, vehicles: [...vehicles].sort(), otByVehicle, daily }
  })
}
