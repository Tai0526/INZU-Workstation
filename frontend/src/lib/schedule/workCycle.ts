/**
 * A simple Working / Off / Leave work-rest engine shared by HR staff schedules
 * and Safety general-worker schedules. A cycle repeats `onDays` working days then
 * `offDays` rest days; the first working day of a block sits at `anchor`. All date
 * maths is done in UTC from the yyyy-mm-dd parts so it never drifts by a day in
 * Zambia's UTC+2 (which `Date.toISOString()` on a local midnight would).
 */

export type WorkState = 'on' | 'off' | 'leave'

export interface CyclePreset { key: string; label: string; onDays: number; offDays: number }

export const CYCLE_PRESETS: CyclePreset[] = [
  { key: '21x7', label: '21 on / 7 off', onDays: 21, offDays: 7 },
  { key: '14x7', label: '14 on / 7 off', onDays: 14, offDays: 7 },
  { key: '11x3', label: '11 on / 3 off', onDays: 11, offDays: 3 },
  { key: '7x7', label: '7 on / 7 off', onDays: 7, offDays: 7 },
]

export function cycleLabel(onDays: number, offDays: number): string {
  const p = CYCLE_PRESETS.find((x) => x.onDays === onDays && x.offDays === offDays)
  return p ? p.label : `${onDays} on / ${offDays} off`
}

function utcOf(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}

/** Whole days from a→b (b−a); UTC-stable, so no off-by-one across timezones/DST. */
export function daysBetween(aISO: string, bISO: string): number {
  return Math.round((utcOf(bISO) - utcOf(aISO)) / 86_400_000)
}

/** dateISO shifted by n days, returned as yyyy-mm-dd. */
export function addDaysISO(iso: string, n: number): string {
  const dt = new Date(utcOf(iso) + n * 86_400_000)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/** 0 = Sunday … 6 = Saturday (UTC-stable). */
export function weekdayOf(iso: string): number {
  return new Date(utcOf(iso)).getUTCDay()
}

/** Working on dateISO given an on/off cycle whose first working day is `anchor`? */
export function isWorkingOn(onDays: number, offDays: number, anchorISO: string, dateISO: string): boolean {
  const cycle = Math.max(1, (onDays || 0) + (offDays || 0))
  const idx = ((daysBetween(anchorISO || dateISO, dateISO) % cycle) + cycle) % cycle
  return idx < (onDays || 0)
}

/** Today's local date as yyyy-mm-dd (calendar day where the user actually is). */
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Calendar-month helpers (for full-month roster views) ────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Current month as yyyy-mm (local). */
export function thisMonth(): string { return todayISO().slice(0, 7) }

/** Every day of a yyyy-mm month, as yyyy-mm-dd from the 1st to the 30th/31st. */
export function monthDays(ym: string): string[] {
  const [y, m] = ym.slice(0, 7).split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate() // day 0 of next month = last day of this one
  const mm = String(m).padStart(2, '0')
  return Array.from({ length: n }, (_, i) => `${y}-${mm}-${String(i + 1).padStart(2, '0')}`)
}

/** yyyy-mm shifted by whole months (with year rollover). */
export function shiftMonth(ym: string, delta: number): string {
  let [y, m] = ym.slice(0, 7).split('-').map(Number)
  m += delta
  while (m < 1) { m += 12; y -= 1 }
  while (m > 12) { m -= 12; y += 1 }
  return `${y}-${String(m).padStart(2, '0')}`
}

/** "July 2026" for a yyyy-mm month. */
export function monthLabel(ym: string): string {
  const [y, m] = ym.slice(0, 7).split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}
