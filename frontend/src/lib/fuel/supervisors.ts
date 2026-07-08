import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * System users designated as FUEL SUPERVISORS. They may authorise (or reject)
 * fuel draws — visitor / authorised-vehicle sign-off — like Ops, without holding
 * an Ops role. This lets a trusted fuel controller (e.g. Rudo Tembo) authorise
 * while another fuel attendant cannot. Stored as a list of user ids in app_config
 * (no schema change); toggled from Admin → Users.
 */
const EMPTY: string[] = []
const cfg = createSyncConfig<string[]>({ key: 'fuel_supervisors', lsKey: 'inzu_fuel_supervisors', default: EMPTY })

export const fuelSupervisorsStore = {
  get: (): string[] => cfg.get(),
  has: (id: string): boolean => !!id && cfg.get().includes(id),
  set(id: string, on: boolean) {
    if (!id) return
    const cur = cfg.get()
    if (on && !cur.includes(id)) cfg.set([...cur, id])
    else if (!on && cur.includes(id)) cfg.set(cur.filter((x) => x !== id))
  },
  toggle(id: string) { fuelSupervisorsStore.set(id, !fuelSupervisorsStore.has(id)) },
  subscribe: cfg.subscribe,
}

export function useFuelSupervisors(): string[] {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}
