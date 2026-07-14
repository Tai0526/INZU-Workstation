import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * Per-event escalation history — escalated / retracted / re-escalated, with who
 * and why. Kept in an app_config map keyed by the speed event id (the speed_events
 * table has no trail column), so it survives even when the incident it refers to
 * is deleted on retraction. This is what shows "why it was retracted".
 */
export interface SpeedAuditEntry { at: string; by: string; action: string; detail?: string }

const cfg = createSyncConfig<Record<string, SpeedAuditEntry[]>>({ key: 'speed_audit', lsKey: 'inzu_speed_audit', default: {} })
const EMPTY: SpeedAuditEntry[] = []

export const speedAuditStore = {
  get: (id: string): SpeedAuditEntry[] => cfg.get()[id] ?? EMPTY,
  log(id: string, action: string, detail?: string) {
    if (!id) return
    const all = cfg.get()
    const entry: SpeedAuditEntry = { at: new Date().toISOString(), by: getActor().name, action, detail }
    cfg.set({ ...all, [id]: [...(all[id] ?? []), entry] })
  },
  subscribe: cfg.subscribe,
}

export function useSpeedAudit(): Record<string, SpeedAuditEntry[]> {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}
