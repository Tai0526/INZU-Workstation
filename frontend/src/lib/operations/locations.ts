import { useSyncExternalStore } from 'react'
import type { BranchCode } from '@/lib/roles'
import { DEFAULT_TO_LOCATION } from './types'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * Editable list of pick-up / drop-off PLACES per branch, used as the From / To
 * dropdown in the Daily Plan. Stored as one settings blob (no dedicated table),
 * so it syncs across users. Main Mine Gate is always available and can't be removed.
 */

type LocMap = Record<string, string[]>
const cfg = createSyncConfig<LocMap>({ key: 'op_locations', lsKey: 'inzu_op_locations', default: {} })

// Stable-reference cache so useSyncExternalStore doesn't loop (recomputes only
// when the branch's stored array reference changes).
const computed: Record<string, { src: string[] | undefined; out: string[] }> = {}
function list(branch: BranchCode): string[] {
  const src = cfg.get()[branch]
  const c = computed[branch]
  if (c && c.src === src) return c.out
  const out = [...new Set([DEFAULT_TO_LOCATION, ...(src ?? [])])]
  computed[branch] = { src, out }
  return out
}

export const locationsStore = {
  list,
  add(branch: BranchCode, name: string) {
    const n = name.trim()
    if (!n || n.toLowerCase() === DEFAULT_TO_LOCATION.toLowerCase()) return
    const cur = cfg.get()
    const existing = cur[branch] ?? []
    if (existing.some((x) => x.toLowerCase() === n.toLowerCase())) return
    cfg.set({ ...cur, [branch]: [...existing, n] })
  },
  remove(branch: BranchCode, name: string) {
    const cur = cfg.get()
    cfg.set({ ...cur, [branch]: (cur[branch] ?? []).filter((x) => x !== name) })
  },
  subscribe: cfg.subscribe,
}

export function useLocations(branch: BranchCode): string[] {
  return useSyncExternalStore(cfg.subscribe, () => list(branch), () => list(branch))
}
