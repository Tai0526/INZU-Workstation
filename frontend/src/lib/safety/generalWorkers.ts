import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import type { BranchCode } from '@/lib/roles'

/**
 * Safety-owned scheduling for general workers. They are HR employees with
 * job_role "General Worker"; this store adds what Safety needs on top:
 *  - which of the two teams (A / B) each worker is on, and
 *  - each team's 11-on/3-off cycle start date (per branch), so the two teams
 *    stagger — one team's rest days fall on Fri/Sat/Sun while the other works,
 *    alternating each weekend.
 * Leave reuses the shared employee-leave store (so it also shows up in HR).
 * Everything here is app_config (no schema change).
 */
export type GwGroup = 'A' | 'B'

export interface GwCycle { onDays: number; offDays: number; aAnchor: string; bAnchor: string }
export interface GwState {
  assign: Record<string, GwGroup>          // employee id → team
  cycles: Partial<Record<BranchCode, GwCycle>> // per-branch team cycle + start dates
}

export const GW_DEFAULT_CYCLE: GwCycle = { onDays: 11, offDays: 3, aAnchor: '', bAnchor: '' }
const DEFAULT: GwState = { assign: {}, cycles: {} }
const cfg = createSyncConfig<GwState>({
  key: 'gw_schedule', lsKey: 'inzu_gw_schedule', default: DEFAULT,
  merge: (s) => ({ assign: s?.assign ?? {}, cycles: s?.cycles ?? {} }),
})

export const gwStore = {
  get: (): GwState => cfg.get(),
  groupOf: (id: string): GwGroup | undefined => cfg.get().assign[id],
  setGroup(id: string, g: GwGroup | null) {
    const assign = { ...cfg.get().assign }
    if (g) assign[id] = g; else delete assign[id]
    cfg.set({ ...cfg.get(), assign })
  },
  cycleFor: (branch: BranchCode): GwCycle => cfg.get().cycles[branch] ?? GW_DEFAULT_CYCLE,
  setCycle(branch: BranchCode, c: GwCycle) {
    cfg.set({ ...cfg.get(), cycles: { ...cfg.get().cycles, [branch]: c } })
  },
  subscribe: cfg.subscribe,
}

export function useGw(): GwState {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}
