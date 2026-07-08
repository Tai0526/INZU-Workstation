import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * System users who are also allowed to drive. Once flagged, their names appear
 * in the speeding-driver picker (Speed Events) alongside the registered drivers,
 * so an event driven by e.g. a route supervisor or bus controller can be
 * confirmed against the right person. Stored as a list of user ids in app_config
 * (no schema change). Toggled from Admin → Users.
 */
const EMPTY: string[] = []
const cfg = createSyncConfig<string[]>({ key: 'driving_users', lsKey: 'inzu_driving_users', default: EMPTY })

export const drivingUsersStore = {
  get: (): string[] => cfg.get(),
  has: (id: string): boolean => !!id && cfg.get().includes(id),
  set(id: string, on: boolean) {
    if (!id) return
    const cur = cfg.get()
    if (on && !cur.includes(id)) cfg.set([...cur, id])
    else if (!on && cur.includes(id)) cfg.set(cur.filter((x) => x !== id))
  },
  toggle(id: string) { drivingUsersStore.set(id, !drivingUsersStore.has(id)) },
  subscribe: cfg.subscribe,
}

export function useDrivingUsers(): string[] {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}
