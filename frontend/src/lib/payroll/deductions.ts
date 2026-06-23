import { useSyncExternalStore } from 'react'
import type { BranchCode } from '@/lib/roles'
import { getActor } from '@/lib/audit/actor'
import type { StatusTone } from '@/components/ui/StatusBadge'
import { registerCrossTabSync } from '@/lib/storage/sync'

/**
 * Payroll deductions — currently fed by approved incident fines. The payroll
 * module (when built) consumes these as pending line-items to subtract from a
 * driver's pay run. Kept deliberately small: a fine approved by the Ops Manager
 * lands here as a 'pending' deduction tied back to its incident.
 */

export type DeductionStatus = 'pending' | 'applied' | 'cancelled'
export const DEDUCTION_STATUS_META: Record<DeductionStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  applied: { label: 'Applied', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export interface PayrollDeduction {
  id: string
  branch: BranchCode
  driver_id: string
  driver_name: string
  amount: number
  reason: string
  incident_id: string
  date: string // ISO date the deduction was raised
  status: DeductionStatus
  created_by: string
  created_at: string
}

const KEY = 'inzu_payroll_deductions'
let cache: PayrollDeduction[] | null = null
const listeners = new Set<() => void>()

function load(): PayrollDeduction[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? (JSON.parse(raw) as PayrollDeduction[]) : []
  } catch {
    cache = []
  }
  return cache!
}
function commit(next: PayrollDeduction[]) {
  cache = next
  localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
}
registerCrossTabSync(KEY, () => { cache = null; load(); listeners.forEach((l) => l()) })
function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `ded_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}

export const deductionsStore = {
  list: (): PayrollDeduction[] => load(),
  forIncident(incidentId: string): PayrollDeduction | undefined {
    return load().find((d) => d.incident_id === incidentId)
  },
  add(input: Omit<PayrollDeduction, 'id' | 'created_by' | 'created_at'>): PayrollDeduction {
    const d: PayrollDeduction = { ...input, id: newId(), created_by: getActor().name, created_at: new Date().toISOString() }
    commit([...load(), d])
    return d
  },
  update(id: string, patch: Partial<PayrollDeduction>) {
    commit(load().map((d) => (d.id === id ? { ...d, ...patch, id: d.id } : d)))
  },
  remove(id: string) {
    commit(load().filter((d) => d.id !== id))
  },
  subscribe(cb: () => void) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  snapshot: () => load(),
}

export function useDeductions(): PayrollDeduction[] {
  return useSyncExternalStore(deductionsStore.subscribe, deductionsStore.snapshot, deductionsStore.snapshot)
}
