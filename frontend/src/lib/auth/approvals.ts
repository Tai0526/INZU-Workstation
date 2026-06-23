import { useSyncExternalStore } from 'react'
import type { RoleKey } from '@/lib/roles'
import { registerCrossTabSync } from '@/lib/storage/sync'

/**
 * Approval chains, admin-editable. Each chain is an ordered list of roles that
 * must act in sequence. Modules read the chain for their workflow rather than
 * hard-coding the order, so the admin can re-sequence approvals without code.
 */
export interface ApprovalChain {
  key: string
  label: string
  steps: RoleKey[]
}

const DEFAULTS: ApprovalChain[] = [
  { key: 'incident_verdict', label: 'Incident verdict', steps: ['safety_officer', 'operations_manager'] },
  { key: 'mileage', label: 'Daily mileage', steps: ['tracker', 'operations_manager'] },
  { key: 'fuel_draw', label: 'Authorised-vehicle fuel', steps: ['fuel_controller', 'operations_manager'] },
  { key: 'petty_cash', label: 'Petty cash requisition', steps: ['safety_officer', 'operations_manager'] },
  { key: 'payroll', label: 'Payroll run', steps: ['payroll_officer', 'operations_manager', 'managing_director'] },
  { key: 'leave', label: 'Leave request', steps: ['route_supervisor', 'hr_manager'] },
]

const KEY = 'inzu_approvals'
let cache: ApprovalChain[] | null = null
const listeners = new Set<() => void>()
function load(): ApprovalChain[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    const saved = raw ? (JSON.parse(raw) as ApprovalChain[]) : null
    // Merge: keep saved order/steps, add any new default chains not yet saved.
    cache = saved ? [...saved, ...DEFAULTS.filter((d) => !saved.some((s) => s.key === d.key))] : DEFAULTS
  } catch {
    cache = DEFAULTS
  }
  return cache!
}
function commit(next: ApprovalChain[]) {
  cache = next
  localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
}
registerCrossTabSync(KEY, () => { cache = null; load(); listeners.forEach((l) => l()) })

export const approvalsStore = {
  list: (): ApprovalChain[] => load(),
  forKey: (key: string): ApprovalChain | undefined => load().find((c) => c.key === key),
  setSteps(key: string, steps: RoleKey[]) {
    commit(load().map((c) => (c.key === key ? { ...c, steps } : c)))
  },
  move(key: string, index: number, dir: -1 | 1) {
    const chain = load().find((c) => c.key === key)
    if (!chain) return
    const steps = [...chain.steps]
    const j = index + dir
    if (j < 0 || j >= steps.length) return
    ;[steps[index], steps[j]] = [steps[j], steps[index]]
    approvalsStore.setSteps(key, steps)
  },
  resetAll() { commit(DEFAULTS) },
  subscribe(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) },
}
export function useApprovals(): ApprovalChain[] {
  return useSyncExternalStore(approvalsStore.subscribe, approvalsStore.list, approvalsStore.list)
}
