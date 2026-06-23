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

export type ShiftType = 'day_split' | 'night_split' | 'day_cont' | 'night_cont' | 'off'
export type ShiftKind = 'day' | 'night' | 'off'

export interface ShiftMeta { label: string; short: string; kind: ShiftKind; hours: string }
export const SHIFT_META: Record<ShiftType, ShiftMeta> = {
  day_split: { label: 'Day (split)', short: 'D', kind: 'day', hours: '03:00–09:00 · 14:00–20:00' },
  night_split: { label: 'Night (split)', short: 'N', kind: 'night', hours: '11:00–16:00 · 20:00–02:00' },
  day_cont: { label: 'Day (continuous)', short: 'D', kind: 'day', hours: '06:00–18:00' },
  night_cont: { label: 'Night (continuous)', short: 'N', kind: 'night', hours: '18:00–06:00' },
  off: { label: 'Off / rest', short: '·', kind: 'off', hours: 'Rest day' },
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
    blurb: '7 days on, 7 off. Split 12-hour day shift (03–09 & 14–20).',
    cycle: [...rep('day_split', 7), ...rep('off', 7)],
  },
  '7x7_night': {
    key: '7x7_night', label: '7 on / 7 off — Night (split)', continuous: false,
    blurb: '7 days on, 7 off. Split 12-hour night shift (11–16 & 20–02).',
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
 * Rotation a section runs — assignment is automatic from the driver's section:
 *   Pit → 14/7 · Security & Dewatering → 10/5 · all other sections → 7/7 split
 *   (Day for crew A, Night for crew B).
 */
export function sectionPattern(section: string, crew: 'A' | 'B'): string {
  if (section.startsWith('Pit')) return '14x7' // both Pit (Enterprise Mine) and Pit (Sentinel Mine)
  if (section === 'Security' || section === 'Dewatering') return '10x5'
  return crew === 'B' ? '7x7_night' : '7x7_day'
}
/** A driver's rotation pattern key — derived from their section + crew. */
export function patternKeyFor(d: { section: string; crew: 'A' | 'B' }): string {
  return sectionPattern(d.section, d.crew)
}
export function anchorFor(d: { schedule_anchor?: string }): string {
  return d.schedule_anchor || DEFAULT_ANCHOR
}

// ── Time-of-day windows (for "on shift now") ────────────────────────────
// `end` may exceed 24 to denote wrapping past midnight (e.g. 26 = 02:00).
const SHIFT_BLOCKS: Record<ShiftType, [number, number][]> = {
  day_split: [[3, 9], [14, 20]],
  night_split: [[11, 16], [20, 26]],
  day_cont: [[6, 18]],
  night_cont: [[18, 30]],
  off: [],
}
function inBlock([s, e]: [number, number], h: number): boolean {
  return e <= 24 ? h >= s && h < e : h >= s || h < e - 24
}
/** Is the current time within this shift's working window? */
export function isWithinShift(t: ShiftType, now: Date = new Date()): boolean {
  const h = now.getHours() + now.getMinutes() / 60
  return SHIFT_BLOCKS[t].some((b) => inBlock(b, h))
}

const localISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** The shift a driver's rotation puts them on today (local date). */
export function scheduledShift(d: { section: string; schedule_anchor?: string; crew: 'A' | 'B' }, now: Date = new Date()): ShiftType {
  return shiftOnDate(patternKeyFor(d), anchorFor(d), localISO(now))
}
