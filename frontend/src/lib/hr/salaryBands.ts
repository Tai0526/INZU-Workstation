import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * Salary grades / bands catalog (optional). HR defines the grades once; an
 * employee's salary references a grade, and its default basic pre-fills. Payroll
 * reads the employee's basic from their file — statutory deductions stay in Payroll.
 * Migration-free app_config list.
 */
export interface SalaryBand { id: string; grade: string; band: string; basic: number; currency: string; leave_day_rate: number; note: string }
/** Cost of one leave day for a band: its set rate, else basic ÷ 22 working days. */
export const leaveDayRate = (b: Pick<SalaryBand, 'leave_day_rate' | 'basic'> | null | undefined): number =>
  (b?.leave_day_rate && b.leave_day_rate > 0 ? b.leave_day_rate : b?.basic ? Math.round(b.basic / 22) : 0)

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `band_${Date.now()}_${Math.round(Math.random() * 1e6)}`)
const cfg = createSyncConfig<SalaryBand[]>({ key: 'salary_bands', lsKey: 'inzu_salary_bands', default: [] })

export const salaryBandsStore = {
  get: cfg.get,
  subscribe: cfg.subscribe,
  list: () => cfg.get(),
  add(data: Omit<SalaryBand, 'id'>): SalaryBand { const item = { ...data, id: newId() }; cfg.set([...cfg.get(), item]); return item },
  update(id: string, patch: Partial<SalaryBand>) { cfg.set(cfg.get().map((b) => (b.id === id ? { ...b, ...patch, id: b.id } : b))) },
  remove(id: string) { cfg.set(cfg.get().filter((b) => b.id !== id)) },
}
export const useSalaryBands = () => useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
