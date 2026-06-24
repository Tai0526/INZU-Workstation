import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import type { BranchCode } from '@/lib/roles'
import { type Employee, type EmployeeInput, type JobRole } from './types'
import { createSyncTable } from '@/lib/supabase/syncTable'

const KEY = 'inzu_employees'

function emp(id: string, branch: BranchCode, no: string, name: string, role: JobRole, hod = ''): Employee {
  const now = '2026-01-01T00:00:00.000Z'
  return { id, branch, employee_no: no, full_name: name, job_role: role, status: 'active', phone: '', hod, created_by: 'System (seed)', created_at: now, updated_by: 'System (seed)', updated_at: now }
}

const SEED: Employee[] = [
  // Trident
  emp('E-T01', 'trident', 'INZ-E201', 'Rudo Tembo', 'Fuel Attendant', 'Fuel Controller'),
  emp('E-T02', 'trident', 'INZ-E202', 'Asford Makungu', 'Fuel Attendant', 'Fuel Controller'),
  emp('E-T03', 'trident', 'INZ-E203', 'Davies Mwape', 'Mechanic', 'Workshop Supervisor'),
  emp('E-T04', 'trident', 'INZ-E204', 'Justina Phiri', 'General Worker', 'Safety Officer'),
  // Kansanshi
  emp('E-K01', 'kansanshi', 'INZ-E101', 'Rudo Tembo', 'Fuel Attendant', 'Fuel Controller'),
  emp('E-K02', 'kansanshi', 'INZ-E102', 'Asford Makungu', 'Fuel Attendant', 'Fuel Controller'),
  emp('E-K03', 'kansanshi', 'INZ-E103', 'Patrick Lungu', 'Mechanic', 'Workshop Supervisor'),
]

const { load, commit, subscribe } = createSyncTable<Employee>({ table: 'employees', lsKey: KEY, seed: SEED })
function newId() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `e_${Date.now()}_${Math.round(Math.random() * 1e6)}` }
const stamp = () => new Date().toISOString()

export const employeesStore = {
  list: (): Employee[] => load(),
  add(data: EmployeeInput): Employee {
    const now = stamp(); const who = getActor().name
    const e: Employee = { ...data, id: newId(), created_by: who, created_at: now, updated_by: who, updated_at: now }
    commit([...load(), e]); return e
  },
  update(id: string, patch: Partial<Employee>) { const who = getActor().name; commit(load().map((e) => (e.id === id ? { ...e, ...patch, id: e.id, updated_by: who, updated_at: stamp() } : e))) },
  remove(id: string) { commit(load().filter((e) => e.id !== id)) },
  /** Active employees in a branch with a given job role. */
  byRole(branch: BranchCode, role: JobRole): Employee[] {
    return load().filter((e) => e.branch === branch && e.status === 'active' && e.job_role === role)
  },
}

export function useEmployees(): Employee[] {
  return useSyncExternalStore(subscribe, load, load)
}
