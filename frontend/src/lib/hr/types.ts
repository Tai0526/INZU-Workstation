import type { BranchCode } from '@/lib/roles'

/**
 * HR employee database — non-driver staff (drivers live in the driver roster).
 * Other modules pull people from here by job role (e.g. Fuel Attendants).
 * The HR module will build full management on top of this store.
 */
export const JOB_ROLES = [
  'Fuel Attendant', 'Mechanic', 'General Worker', 'Cleaner', 'Security Guard',
  'HR Officer', 'Payroll Officer', 'Safety Officer', 'Workshop Supervisor',
  'Route Supervisor', 'Bus Controller', 'Tracker', 'Fuel Controller', 'Other',
] as const
export type JobRole = (typeof JOB_ROLES)[number]

export const FUEL_ATTENDANT_ROLE: JobRole = 'Fuel Attendant'

export interface Employee {
  id: string
  branch: BranchCode
  employee_no: string
  full_name: string
  job_role: JobRole
  status: 'active' | 'inactive'
  phone: string
  hod: string // head of department / supervisor
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}
export type EmployeeInput = Omit<Employee, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>
