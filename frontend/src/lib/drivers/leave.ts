import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * Driver leave — a date-bounded period per driver, set by Ops / Route Supervisors
 * from the driver profile. Stored migration-free in app_config (driverId → period),
 * so it syncs everywhere and a driver auto-returns from leave once it ends. Leave
 * applies to WORKING days only — a driver isn't "on leave" on a rotation rest day.
 */
export interface LeavePeriod { start: string; end: string } // ISO yyyy-mm-dd, inclusive

const cfg = createSyncConfig<Record<string, LeavePeriod>>({ key: 'driver_leave', lsKey: 'inzu_driver_leave', default: {} })

export const leaveStore = {
  get: (): Record<string, LeavePeriod> => cfg.get(),
  subscribe: cfg.subscribe,
  for: (driverId: string): LeavePeriod | undefined => cfg.get()[driverId],
  set(driverId: string, start: string, end: string) {
    cfg.set({ ...cfg.get(), [driverId]: { start, end } })
  },
  clear(driverId: string) {
    const cur = { ...cfg.get() }
    delete cur[driverId]
    cfg.set(cur)
  },
}

/** Is the driver on leave on this date (inclusive)? */
export function isOnLeave(driverId: string, dateISO: string): boolean {
  const lp = cfg.get()[driverId]
  return !!lp && lp.start <= dateISO && dateISO <= lp.end
}
/** Does the driver's leave overlap the period [start, end]? (for the Weekly Plan) */
export function leaveOverlaps(driverId: string, startISO: string, endISO: string): boolean {
  const lp = cfg.get()[driverId]
  return !!lp && lp.start <= endISO && startISO <= lp.end
}

export function useDriverLeave(): Record<string, LeavePeriod> {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}
