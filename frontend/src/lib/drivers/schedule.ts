/**
 * Work / rest rotation schedules for the mine. A driver is assigned a rotation
 * pattern + a cycle start date ("anchor"); from those we can compute what they're
 * doing on any calendar day — Day shift, Night shift, or Off/rest — and the exact
 * hours for that shift.
 *
 *  • 7 on / 7 off  — SPLIT 12-hour shift (two blocks with a break). Day people work
 *    03:00–09:00 & 14:00–20:00; night people 11:00–16:00 & 20:00–02:00. (No day↔night
 *    rotation within the cycle — assign the day or the night variant.)
 *  • 14 on / 7 off — CONTINUOUS 12-hour: 7 days Day, 7 days Night, 7 days off.
 *  • 10 on / 5 off — CONTINUOUS 12-hour: 5 days Day, 5 days Night, 5 days off.
 */

import { schedulingStore, windowForKind, blocksForKind, inAnyBlock } from '@/lib/drivers/scheduling'
import { effectiveKind } from '@/lib/drivers/driverShifts'

export type ShiftType = 'day_split' | 'night_split' | 'day_cont' | 'night_cont' | 'off'
export type ShiftKind = 'day' | 'night' | 'off'

export interface ShiftMeta { label: string; short: string; kind: ShiftKind }
export const SHIFT_META: Record<ShiftType, ShiftMeta> = {
  day_split: { label: 'Day (split)', short: 'D', kind: 'day' },
  night_split: { label: 'Night (split)', short: 'N', kind: 'night' },
  day_cont: { label: 'Day (continuous)', short: 'D', kind: 'day' },
  night_cont: { label: 'Night (continuous)', short: 'N', kind: 'night' },
  off: { label: 'Off / rest', short: '·', kind: 'off' },
}

/**
 * Clock window for a rotation shift type, read from the configured shift times
 * (Admin → Scheduling) by day/night kind — '' for an off/rest day or a
 * label-only shift. Single source of truth for shift hours across the app.
 */
export function shiftHours(t: ShiftType): string {
  const kind = SHIFT_META[t].kind
  return kind === 'off' ? '' : windowForKind(schedulingStore.get(), kind)
}

export interface RotationPattern {
  key: string
  label: string
  blurb: string
  continuous: boolean
  cycle: ShiftType[]
}

const rep = (t: ShiftType, n: number): ShiftType[] => Array.from({ length: n }, () => t)

export const ROTATIONS: Record<string, RotationPattern> = {
  '7x7_day': {
    key: '7x7_day', label: '7 on / 7 off — Day (split)', continuous: false,
    blurb: '7 days on, 7 off — day shift.',
    cycle: [...rep('day_split', 7), ...rep('off', 7)],
  },
  '7x7_night': {
    key: '7x7_night', label: '7 on / 7 off — Night (split)', continuous: false,
    blurb: '7 days on, 7 off — night shift.',
    cycle: [...rep('night_split', 7), ...rep('off', 7)],
  },
  '14x7': {
    key: '14x7', label: '14 on / 7 off — Day→Night', continuous: true,
    blurb: '7 days Day, 7 days Night, 7 days off. Continuous 12-hour shift.',
    cycle: [...rep('day_cont', 7), ...rep('night_cont', 7), ...rep('off', 7)],
  },
  '10x5': {
    key: '10x5', label: '10 on / 5 off — Day→Night', continuous: true,
    blurb: '5 days Day, 5 days Night, 5 days off. Continuous 12-hour shift.',
    cycle: [...rep('day_cont', 5), ...rep('night_cont', 5), ...rep('off', 5)],
  },
}
export const ROTATION_LIST = Object.values(ROTATIONS)

/** Default cycle start when a driver has no anchor set. A Friday — shift change is
 *  Friday (10:00), so the 7-on/7-off blocks flip on Fridays. (2026-01-02 is a Friday.) */
export const DEFAULT_ANCHOR = '2026-01-02'

export function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(`${aISO}T00:00:00`).getTime()
  const b = new Date(`${bISO}T00:00:00`).getTime()
  return Math.floor((b - a) / 86_400_000)
}

/** What shift (if any) a rotation puts a person on for a given date. */
export function shiftOnDate(patternKey: string, anchorISO: string, dateISO: string): ShiftType {
  const p = ROTATIONS[patternKey]
  if (!p) return 'off'
  const len = p.cycle.length
  let idx = daysBetween(anchorISO || DEFAULT_ANCHOR, dateISO) % len
  if (idx < 0) idx += len
  return p.cycle[idx]
}

/**
 * A driver's rotation pattern key — from their section, and for the 7/7 split
 * sections the day/night of their EFFECTIVE shift (per-driver override → crew
 * default). Pit → 14/7 · Security & Dewatering → 10/5 · all others → 7/7.
 */
export function patternKeyFor(d: { id?: string; section: string; crew: string }): string {
  if (d.section.startsWith('Pit')) return '14x7' // both Pit (Enterprise Mine) and Pit (Sentinel Mine)
  if (d.section === 'Security' || d.section === 'Dewatering') return '10x5'
  return effectiveKind(d) === 'night' ? '7x7_night' : '7x7_day'
}
export function anchorFor(d: { schedule_anchor?: string }): string {
  return d.schedule_anchor || DEFAULT_ANCHOR
}

// ── Time-of-day windows (for "on shift now") ────────────────────────────
/** Is the current time within this shift's configured working window? */
export function isWithinShift(t: ShiftType, now: Date = new Date()): boolean {
  const kind = SHIFT_META[t].kind
  if (kind === 'off') return false
  return inAnyBlock(blocksForKind(schedulingStore.get(), kind), now)
}

const localISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** The shift a driver's rotation puts them on today (local date). */
export function scheduledShift(d: { id?: string; section: string; schedule_anchor?: string; crew: string }, now: Date = new Date()): ShiftType {
  return shiftOnDate(patternKeyFor(d), anchorFor(d), localISO(now))
}
