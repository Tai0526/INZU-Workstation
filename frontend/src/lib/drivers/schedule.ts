/**
 * Work / rest rotation schedules for the mine. The schedule depends on the
 * driver's SECTION, with two structures:
 *
 *  • CONTINUOUS 12-hour (Pit 14/7 → 7-day blocks · Security & Dewatering 10/5 →
 *    5-day blocks): the crews rotate Day → Night → Off ACROSS each other. At the
 *    cycle anchor crew A is on Day, crew B on Night, crew C resting, and every
 *    block they each advance one phase. Day = 05:00–17:00, Night = 17:00–05:00.
 *  • 7 on / 7 off SPLIT (Sentinel, Enterprise, Omega): crews alternate the on/off
 *    week; within the on week a driver works their Morning block (→ day) or
 *    Afternoon block (ends ~02:00 → night). Set per driver.
 *
 * Day/night windows come from Admin → Scheduling; the cycle start is configurable.
 */

import { schedulingStore, windowForKind, blocksForKind, shiftBlocks, type CycleKey } from '@/lib/drivers/scheduling'
import { effectiveKind, effectiveShort, effectiveWindow, effectiveLabel, effectiveShiftDef } from '@/lib/drivers/driverShifts'

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

// ── Crew rotation ────────────────────────────────────────────────────────
// Each crew has a PHASE at the cycle start (admin-set in Admin → Scheduling;
// default A/B/C order = Day/Night/Off). Continuous sections rotate Day → Night →
// Off (3 phases); 7/7 sections alternate On → Off (2 phases), with day/night on
// the On block coming from the driver's Morning/Afternoon. The phase advances one
// step every block (N days) from the cycle start, so the selection keeps rotating.
export function isContinuousSection(section: string): boolean {
  return section.startsWith('Pit') || section === 'Security' || section === 'Dewatering'
}
/** Block length (days per phase): Pit 14/7 → 7 · Security & Dewatering 10/5 → 5 · 7/7 → 7. */
function blockLen(section: string): number {
  if (section.startsWith('Pit')) return 7
  if (section === 'Security' || section === 'Dewatering') return 5
  return 7
}
/** Crew's position (A=0, B=1, C=2…) among the configured crews — the default phase order. */
function crewIndex(crewId: string): number {
  const i = schedulingStore.get().crews.findIndex((c) => c.id === crewId)
  return i >= 0 ? i : 0
}
/** Cycle group for a section: 14/7 (Pit), 10/5 (Security & Dewatering), else 7/7. */
export function cycleKeyFor(section: string): CycleKey {
  if (section.startsWith('Pit')) return '14x7'
  if (section === 'Security' || section === 'Dewatering') return '10x5'
  return '7x7'
}
/** Cycle start date for a section's rotation type (each type began on its own date). */
export function cycleAnchorFor(section: string): string {
  return schedulingStore.get().cycleAnchors[cycleKeyFor(section)] || DEFAULT_ANCHOR
}
/** Number of phases in a cycle — continuous Day/Night/Off = 3 · 7/7 On/Off = 2. */
export function phaseCount(key: CycleKey): number {
  return key === '7x7' ? 2 : 3
}
/** A crew's phase at the cycle start for a cycle type — admin override, else A/B/C order. */
export function crewPhaseFor(key: CycleKey, crewId: string): number {
  const ov = schedulingStore.get().crewPhase?.[key]?.[crewId]
  return ov == null ? crewIndex(crewId) % phaseCount(key) : ov
}

/** What a driver is doing on a date: day / night / off — their crew's phase rotated each block. */
function driverPhase(d: { id?: string; section: string; crew: string }, dateISO: string, anchorOverride?: string): 'day' | 'night' | 'off' {
  const key = cycleKeyFor(d.section)
  const count = phaseCount(key)
  const anchor = anchorOverride || cycleAnchorFor(d.section)
  const blocks = Math.floor(daysBetween(anchor, dateISO) / blockLen(d.section))
  const phase = (((crewPhaseFor(key, d.crew) + blocks) % count) + count) % count
  if (key === '7x7') return phase === 1 ? 'off' : effectiveKind(d) // On → Morning(day)/Afternoon(night)
  return phase === 0 ? 'day' : phase === 1 ? 'night' : 'off'
}
function phaseToShift(section: string, ph: 'day' | 'night' | 'off'): ShiftType {
  if (ph === 'off') return 'off'
  const cont = isContinuousSection(section)
  if (ph === 'night') return cont ? 'night_cont' : 'night_split'
  return cont ? 'day_cont' : 'day_split'
}
/** Shift type for a driver on a date, against a specific cycle start (used for previews). */
export function previewShiftOnDate(d: { id?: string; section: string; crew: string }, anchor: string, dateISO: string): ShiftType {
  return phaseToShift(d.section, driverPhase(d, dateISO, anchor))
}
/** Shift type for a driver on a date using the live cycle settings. */
export function driverShiftOnDate(d: { id?: string; section: string; crew: string }, dateISO: string): ShiftType {
  return phaseToShift(d.section, driverPhase(d, dateISO))
}

const localISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** The shift a driver's rotation puts them on today (local date). */
export function scheduledShift(d: { id?: string; section: string; crew: string }, now: Date = new Date()): ShiftType {
  return driverShiftOnDate(d, localISO(now))
}

// ── Per-driver display (continuous = D/N by phase · split = M/A by block) ──
/** Short code for a driver's day: continuous → D/N (phase); split → M/A (block); off → ·. */
export function dutyShort(d: { id?: string; section: string; crew: string }, type: ShiftType): string {
  if (SHIFT_META[type].kind === 'off') return SHIFT_META.off.short
  return isContinuousSection(d.section) ? SHIFT_META[type].short : effectiveShort(d)
}
/** Human label for a driver's day (Day/Night for continuous, Morning/Afternoon for split). */
export function dutyLabel(d: { id?: string; section: string; crew: string }, type: ShiftType): string {
  if (SHIFT_META[type].kind === 'off') return SHIFT_META.off.label
  if (isContinuousSection(d.section)) return SHIFT_META[type].kind === 'day' ? 'Day' : 'Night'
  return effectiveLabel(d) || (SHIFT_META[type].kind === 'day' ? 'Day' : 'Night')
}
/** Clock window for a driver's day. Continuous → canonical day/night; split → the driver's block. */
export function dutyHours(d: { id?: string; section: string; crew: string }, type: ShiftType): string {
  if (SHIFT_META[type].kind === 'off') return ''
  if (isContinuousSection(d.section)) return windowForKind(schedulingStore.get(), SHIFT_META[type].kind)
  return effectiveWindow(d) || windowForKind(schedulingStore.get(), SHIFT_META[type].kind)
}
/** Numeric blocks for "on shift now". Continuous → canonical day/night; split → the driver's block. */
export function dutyBlocks(d: { id?: string; section: string; crew: string }, type: ShiftType): [number, number][] {
  if (SHIFT_META[type].kind === 'off') return []
  if (isContinuousSection(d.section)) return blocksForKind(schedulingStore.get(), SHIFT_META[type].kind)
  return shiftBlocks(effectiveShiftDef(d))
}
