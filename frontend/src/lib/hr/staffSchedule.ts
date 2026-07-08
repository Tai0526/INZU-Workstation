import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * HR-set work-rest cycles for SYSTEM USERS (people with app accounts) — e.g. route
 * supervisors and bus controllers on 7-on/7-off, others on 21-on/7-off. Keyed by
 * user id, stored in app_config (no schema change). The Working/Off computation
 * lives in @/lib/schedule/workCycle.
 */
export interface StaffCycle {
  onDays: number
  offDays: number
  anchor: string // yyyy-mm-dd — first working day of a cycle block
  by?: string
  at?: string
}

const EMPTY: Record<string, StaffCycle> = {}
const cfg = createSyncConfig<Record<string, StaffCycle>>({ key: 'staff_schedule', lsKey: 'inzu_staff_schedule', default: EMPTY })

export const staffScheduleStore = {
  get: (): Record<string, StaffCycle> => cfg.get(),
  for: (userId: string): StaffCycle | undefined => cfg.get()[userId],
  set(userId: string, c: { onDays: number; offDays: number; anchor: string }, by?: string) {
    if (!userId) return
    cfg.set({ ...cfg.get(), [userId]: { onDays: c.onDays, offDays: c.offDays, anchor: c.anchor, by, at: new Date().toISOString() } })
  },
  clear(userId: string) {
    const m = { ...cfg.get() }
    delete m[userId]
    cfg.set(m)
  },
  subscribe: cfg.subscribe,
}

export function useStaffSchedule(): Record<string, StaffCycle> {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}
