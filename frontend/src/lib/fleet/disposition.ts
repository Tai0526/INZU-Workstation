import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * Vehicle dispositions — written off (crash / insurance) or left the fleet
 * (transferred away / long gone). A retired vehicle KEEPS its record and full
 * history, but `useVehicles()` excludes it, so it disappears from licensing,
 * missing-document alerts, fuel, allocation, workshop coverage and dashboards
 * automatically. Only the Vehicle Register (via useAllVehicles) still shows
 * it, badged, where it can be restored.
 *
 * Stored migration-free in app_config as vehicleId → disposition.
 */

export type DispositionKind = 'written_off' | 'departed'

export interface Disposition {
  kind: DispositionKind
  date: string // when it was written off / left
  note: string
  by: string // who recorded it
  at: string // ISO timestamp of the recording
}

export const DISPOSITION_META: Record<DispositionKind, { label: string; hint: string }> = {
  written_off: { label: 'Written off', hint: 'Crashed / insurance write-off — permanently out of service.' },
  departed: { label: 'Left the fleet', hint: 'Transferred away or gone from the branch long-term.' },
}

const cfg = createSyncConfig<Record<string, Disposition>>({
  key: 'vehicle_disposition', lsKey: 'inzu_vehicle_disposition', default: {},
})

export const dispositionStore = {
  get: (): Record<string, Disposition> => cfg.get(),
  subscribe: cfg.subscribe,
  retire(vehicleId: string, d: Disposition) {
    cfg.set({ ...cfg.get(), [vehicleId]: d })
  },
  restore(vehicleId: string) {
    const next = { ...cfg.get() }
    delete next[vehicleId]
    cfg.set(next)
  },
}

export function useDispositions(): Record<string, Disposition> {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}
