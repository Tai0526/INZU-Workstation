import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import {
  schedulingStore, shiftById, shiftForCrew, shiftDefForKind, crewShiftKind,
  shiftKindOf, shiftShort, shiftTime, type ShiftDef,
} from '@/lib/drivers/scheduling'

/**
 * Per-driver shift (block) assignment — e.g. Morning or Afternoon — overriding
 * the crew's default shift. A driver in either crew can do morning (→ day) or
 * afternoon (ends ~02:00, → night). Stored migration-free as driverId → shiftId
 * in app_config, so it syncs like the rest of the scheduling config.
 */
const cfg = createSyncConfig<Record<string, string>>({
  key: 'driver_shifts', lsKey: 'inzu_driver_shifts', default: {},
})

export const driverShiftsStore = {
  get: (): Record<string, string> => cfg.get(),
  subscribe: cfg.subscribe,
  /** The assigned shift id for a driver, or '' when they follow the crew default. */
  shiftFor: (driverId: string): string => cfg.get()[driverId] ?? '',
  set(driverId: string, shiftId: string | undefined) {
    const cur = cfg.get()
    const next = { ...cur }
    if (shiftId) next[driverId] = shiftId
    else delete next[driverId]
    cfg.set(next)
  },
}
export function useDriverShifts(): Record<string, string> {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}

type DriverLike = { id?: string; crew: string; section?: string }

/**
 * Section-specific shift TIMES — some sections run split shifts that the generic
 * Day/Afternoon times don't capture. Sentinel & Enterprise work split shifts:
 * Day = 03:00–10:00 & 14:00–20:00, Afternoon = 11:00–16:00 & 20:00–02:00. The
 * block (day/afternoon) and its kind stay the same — only the clock times change.
 */
const SECTION_SHIFT_OVERRIDES: Record<string, Record<string, { start: string; end: string; start2?: string; end2?: string }>> = {
  Sentinel: {
    day: { start: '03:00', end: '10:00', start2: '14:00', end2: '20:00' },
    afternoon: { start: '11:00', end: '16:00', start2: '20:00', end2: '02:00' },
  },
  Enterprise: {
    day: { start: '03:00', end: '10:00', start2: '14:00', end2: '20:00' },
    afternoon: { start: '11:00', end: '16:00', start2: '20:00', end2: '02:00' },
  },
}

/** The shift a driver actually works: explicit override (with any section-specific
 *  split times) → crew's shift → canonical for the crew's kind. */
export function effectiveShiftDef(d: DriverLike): ShiftDef | undefined {
  const c = schedulingStore.get()
  const ov = d.id ? cfg.get()[d.id] : ''
  if (ov) {
    const base = shiftById(c, ov)
    if (base) {
      const split = d.section ? SECTION_SHIFT_OVERRIDES[d.section]?.[ov] : undefined
      return split ? { ...base, ...split } : base
    }
  }
  return shiftForCrew(c, d.crew) ?? shiftDefForKind(c, crewShiftKind(c, d.crew))
}
/** day/night classification of a driver's effective shift (afternoon → night). */
export function effectiveKind(d: DriverLike): 'day' | 'night' {
  const c = schedulingStore.get()
  const ov = d.id ? cfg.get()[d.id] : ''
  if (ov) { const s = shiftById(c, ov); if (s) return shiftKindOf(s) }
  return crewShiftKind(c, d.crew)
}
/** Short code shown on the roster / schedule (M, A, D, N…). */
export function effectiveShort(d: DriverLike): string {
  return shiftShort(effectiveShiftDef(d))
}
/** The driver's working window, e.g. "05:00–14:00" or split "03:00–09:00 · 14:00–20:00". */
export function effectiveWindow(d: DriverLike): string {
  return shiftTime(effectiveShiftDef(d))
}
/** The driver's shift label, e.g. "Morning" / "Afternoon". */
export function effectiveLabel(d: DriverLike): string {
  return effectiveShiftDef(d)?.label ?? ''
}
