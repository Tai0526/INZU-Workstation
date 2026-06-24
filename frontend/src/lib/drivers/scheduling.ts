import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * Admin-configurable scheduling reference — shifts, crews and work-day rotations.
 * Managed under Admin → Scheduling. Drivers reference a crew by its `id`; the
 * crew may be linked to a shift (giving it times) or stand alone as a plain
 * grouping. The day/night "kind" of a crew's shift still drives the rotation
 * engine in `schedule.ts`, so adding e.g. Crew C (Day) works end-to-end.
 */

/**
 * A named shift, optionally timed. Times are 'HH:MM' (24h); blank = label-only.
 * A second block (start2/end2) makes it a split shift — e.g. a morning and an
 * afternoon block with a gap in between.
 */
export interface ShiftDef { id: string; label: string; start?: string; end?: string; start2?: string; end2?: string }
/** A crew (e.g. A, B, C). Optionally linked to a shift to give it times. */
export interface CrewDef { id: string; label: string; shift_id?: string }
/** A work / rest rotation expressed in days. */
export interface WorkScheduleDef { id: string; label: string; on_days: number; off_days: number; continuous: boolean }

export interface SchedulingConfig {
  shifts: ShiftDef[]
  crews: CrewDef[]
  schedules: WorkScheduleDef[]
}

export const DEFAULT_SCHEDULING: SchedulingConfig = {
  shifts: [
    { id: 'day', label: 'Day', start: '06:00', end: '18:00' },
    { id: 'night', label: 'Night', start: '18:00', end: '06:00' },
  ],
  crews: [
    { id: 'A', label: 'A', shift_id: 'day' },
    { id: 'B', label: 'B', shift_id: 'night' },
  ],
  schedules: [
    { id: '7x7', label: '7 on / 7 off', on_days: 7, off_days: 7, continuous: false },
    { id: '14x7', label: '14 on / 7 off', on_days: 14, off_days: 7, continuous: true },
    { id: '10x5', label: '10 on / 5 off', on_days: 10, off_days: 5, continuous: true },
  ],
}

const cfg = createSyncConfig<SchedulingConfig>({
  key: 'scheduling',
  lsKey: 'inzu_scheduling',
  default: DEFAULT_SCHEDULING,
  merge: (saved) => ({
    shifts: saved?.shifts ?? DEFAULT_SCHEDULING.shifts,
    crews: saved?.crews ?? DEFAULT_SCHEDULING.crews,
    schedules: saved?.schedules ?? DEFAULT_SCHEDULING.schedules,
  }),
})

const clone = (c: SchedulingConfig): SchedulingConfig => JSON.parse(JSON.stringify(c))
function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}
function uniqueId(base: string, taken: Set<string>): string {
  let id = base || 'item'
  let n = 2
  while (taken.has(id)) id = `${base}-${n++}`
  return id
}
/** Next free single uppercase letter for a new crew (A, B, C, …). */
function nextCrewLabel(crews: CrewDef[]): string {
  const used = new Set(crews.map((c) => c.label.trim().toUpperCase()))
  for (let i = 0; i < 26; i++) {
    const L = String.fromCharCode(65 + i)
    if (!used.has(L)) return L
  }
  return `Crew ${crews.length + 1}`
}

export const schedulingStore = {
  get: (): SchedulingConfig => cfg.get(),
  subscribe: cfg.subscribe,
  reset() { cfg.set(clone(DEFAULT_SCHEDULING)) },

  // ── Shifts ──
  addShift() {
    const c = cfg.get()
    cfg.set({ ...c, shifts: [...c.shifts, { id: uid(), label: 'New shift', start: '', end: '' }] })
  },
  updateShift(id: string, patch: Partial<ShiftDef>) {
    const c = cfg.get()
    cfg.set({ ...c, shifts: c.shifts.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  },
  removeShift(id: string) {
    const c = cfg.get()
    cfg.set({
      ...c,
      shifts: c.shifts.filter((s) => s.id !== id),
      crews: c.crews.map((cr) => (cr.shift_id === id ? { ...cr, shift_id: undefined } : cr)),
    })
  },

  // ── Crews ──
  addCrew() {
    const c = cfg.get()
    const label = nextCrewLabel(c.crews)
    const id = uniqueId(label, new Set(c.crews.map((x) => x.id)))
    cfg.set({ ...c, crews: [...c.crews, { id, label, shift_id: undefined }] })
  },
  updateCrew(id: string, patch: Partial<Omit<CrewDef, 'id'>>) {
    const c = cfg.get()
    cfg.set({ ...c, crews: c.crews.map((cr) => (cr.id === id ? { ...cr, ...patch } : cr)) })
  },
  removeCrew(id: string) {
    const c = cfg.get()
    if (c.crews.length <= 1) return // keep at least one crew
    cfg.set({ ...c, crews: c.crews.filter((cr) => cr.id !== id) })
  },

  // ── Work schedules ──
  addSchedule() {
    const c = cfg.get()
    cfg.set({ ...c, schedules: [...c.schedules, { id: uid(), label: 'New schedule', on_days: 7, off_days: 7, continuous: false }] })
  },
  updateSchedule(id: string, patch: Partial<Omit<WorkScheduleDef, 'id'>>) {
    const c = cfg.get()
    cfg.set({ ...c, schedules: c.schedules.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  },
  removeSchedule(id: string) {
    const c = cfg.get()
    cfg.set({ ...c, schedules: c.schedules.filter((s) => s.id !== id) })
  },
}

// ── Lookups / derived labels ────────────────────────────────────────────
export function shiftById(c: SchedulingConfig, id?: string): ShiftDef | undefined {
  return id ? c.shifts.find((s) => s.id === id) : undefined
}
export function crewById(c: SchedulingConfig, id: string): CrewDef | undefined {
  return c.crews.find((cr) => cr.id === id)
}
export function shiftForCrew(c: SchedulingConfig, crewId: string): ShiftDef | undefined {
  const cr = crewById(c, crewId)
  return cr ? shiftById(c, cr.shift_id) : undefined
}
/** "05:00–17:00", or for a split shift "03:00–09:00 · 14:00–20:00"; '' when label-only. */
export function shiftTime(s?: ShiftDef): string {
  if (!s) return ''
  const parts: string[] = []
  if (s.start && s.end) parts.push(`${s.start}–${s.end}`)
  if (s.start2 && s.end2) parts.push(`${s.start2}–${s.end2}`)
  return parts.join(' · ')
}
/** Display label for a crew (falls back to the raw id for a deleted crew). */
export function crewLabel(c: SchedulingConfig, crewId: string): string {
  return crewById(c, crewId)?.label ?? crewId
}
/** A crew's shift as text, e.g. "Day (06:00–18:00)" or "Day" or '' (no shift). */
export function crewShiftLabel(c: SchedulingConfig, crewId: string): string {
  const s = shiftForCrew(c, crewId)
  if (!s) return ''
  const t = shiftTime(s)
  return t ? `${s.label} (${t})` : s.label
}
/**
 * day/night kind for the rotation engine — inferred from the crew's linked
 * shift (name contains "night" → night). Legacy fallback: a crew called "B"
 * with no shift is treated as night, anything else as day.
 */
export function crewShiftKind(c: SchedulingConfig, crewId: string): 'day' | 'night' {
  const s = shiftForCrew(c, crewId)
  if (s) return /night/i.test(`${s.id} ${s.label}`) ? 'night' : 'day'
  return crewId.trim().toUpperCase() === 'B' ? 'night' : 'day'
}

// ── Time resolution (the single source of truth for shift windows) ────────
/** Parse 'HH:MM' to fractional hours (e.g. '17:30' → 17.5); null if blank/invalid. */
export function parseHM(t?: string): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
  if (!m) return null
  const h = Number(m[1]) + Number(m[2]) / 60
  return Number.isFinite(h) ? h : null
}
/** The configured shift representing a given day/night kind. */
export function shiftDefForKind(c: SchedulingConfig, kind: 'day' | 'night'): ShiftDef | undefined {
  if (kind === 'night') return c.shifts.find((s) => /night/i.test(`${s.id} ${s.label}`))
  return c.shifts.find((s) => !/night/i.test(`${s.id} ${s.label}`)) ?? c.shifts[0]
}
/** "05:00–17:00" for a kind, or '' when its shift has no times. */
export function windowForKind(c: SchedulingConfig, kind: 'day' | 'night'): string {
  return shiftTime(shiftDefForKind(c, kind))
}
/** Numeric [start, end] block(s) of a shift def; `end` may exceed 24 when wrapping past midnight. */
function defBlocks(s?: ShiftDef): [number, number][] {
  const out: [number, number][] = []
  const add = (st?: string, en?: string) => {
    const a = parseHM(st), b = parseHM(en)
    if (a != null && b != null) out.push([a, b <= a ? b + 24 : b])
  }
  add(s?.start, s?.end)
  add(s?.start2, s?.end2)
  return out
}
/**
 * Numeric [start, end] block(s) for a kind, used by "on shift now". Includes
 * both blocks of a split shift. `end` may exceed 24 when a block wraps past
 * midnight (e.g. 17:00–05:00 → [17, 29]).
 */
export function blocksForKind(c: SchedulingConfig, kind: 'day' | 'night'): [number, number][] {
  return defBlocks(shiftDefForKind(c, kind))
}
/** Is the clock time `now` inside any of these blocks? */
export function inAnyBlock(blocks: [number, number][], now: Date): boolean {
  const h = now.getHours() + now.getMinutes() / 60
  return blocks.some(([s, e]) => (e <= 24 ? h >= s && h < e : h >= s || h < e - 24))
}

// ── Hooks ────────────────────────────────────────────────────────────────
export function useScheduling(): SchedulingConfig {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}
export function useCrews(): CrewDef[] { return useScheduling().crews }
export function useShifts(): ShiftDef[] { return useScheduling().shifts }
export function useWorkSchedules(): WorkScheduleDef[] { return useScheduling().schedules }
