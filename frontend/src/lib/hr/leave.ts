import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import { getActor } from '@/lib/audit/actor'

/**
 * Employee (non-driver) leave — a date-bounded period per employee, set by HR or
 * the head of department. Stored migration-free in app_config (employeeId → period),
 * so it syncs everywhere and auto-clears when it ends. `by`/`at` record who
 * approved it. Drivers keep their own store (lib/drivers/leave.ts) because their
 * leave is rotation-aware; HR → Leave shows both consolidated.
 */
export interface EmpLeave { start: string; end: string; reason?: string; by?: string; at?: string }

const cfg = createSyncConfig<Record<string, EmpLeave>>({ key: 'employee_leave', lsKey: 'inzu_employee_leave', default: {} })

export const empLeaveStore = {
  get: (): Record<string, EmpLeave> => cfg.get(),
  subscribe: cfg.subscribe,
  for: (id: string): EmpLeave | undefined => cfg.get()[id],
  set(id: string, start: string, end: string, reason = '') {
    cfg.set({ ...cfg.get(), [id]: { start, end, reason: reason.trim(), by: getActor().name, at: new Date().toISOString() } })
  },
  clear(id: string) { const c = { ...cfg.get() }; delete c[id]; cfg.set(c) },
}

export function empOnLeave(id: string, dateISO: string): boolean {
  const lp = cfg.get()[id]
  return !!lp && lp.start <= dateISO && dateISO <= lp.end
}
export function useEmployeeLeave(): Record<string, EmpLeave> {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}
