import { useMemo } from 'react'
import { ROLES, type BranchCode, type RoleKey } from '@/lib/roles'
import { useEmployees } from './store'
import type { JobRole } from './types'
import { useDrivers } from '@/lib/drivers/store'
import { useUsers } from '@/lib/auth/users'

/**
 * The consolidated HR view of "everyone" in a branch, from the three sources:
 *  - HR employees (the editable directory — mechanics, fuel attendants, etc.)
 *  - Drivers (managed in the Drivers module; shown here read-only)
 *  - System accounts ticked "Is an employee" in Admin that aren't already an
 *    HR employee or a driver.
 * Other modules pull their people from HR (fuel attendants, mechanics); this is
 * the single place that knows the whole headcount.
 */
export type HrSource = 'hr' | 'driver' | 'account'

export interface HrPerson {
  key: string // unique row key
  id: string // employee id / driver id / account id
  source: HrSource
  full_name: string
  employee_no: string
  role: string // job role / "Driver" / account role label
  department: string // coarse grouping
  branch: BranchCode
  status: 'active' | 'inactive'
  phone: string
  hod: string
  link?: string // where this person is managed
}

// Everyone maps to a real department — no generic "System users" bucket. Employees
// map by job role; system accounts map by their system role (below).
const DEPT_BY_JOB: Partial<Record<JobRole, string>> = {
  Mechanic: 'Workshop', 'Workshop Supervisor': 'Workshop',
  'Fuel Attendant': 'Operations', 'Fuel Controller': 'Operations',
  'Safety Officer': 'Safety',
  'General Worker': 'General Workers', Cleaner: 'General Workers', 'Security Guard': 'General Workers',
  'HR Officer': 'HR', 'Payroll Officer': 'HR',
  'Route Supervisor': 'Operations', 'Bus Controller': 'Operations', Tracker: 'IT',
}
const deptForJob = (j: JobRole): string => DEPT_BY_JOB[j] ?? 'Other'

const DEPT_BY_ROLE: Partial<Record<RoleKey, string>> = {
  operations_manager: 'Management', asst_operations_manager: 'Management',
  managing_director: 'Management', finance_director: 'Management', board_chairman: 'Management', board_member: 'Management',
  route_supervisor: 'Operations', bus_controller: 'Operations', fuel_controller: 'Operations',
  safety_officer: 'Safety',
  workshop_supervisor: 'Workshop',
  hr_manager: 'HR', hr_officer: 'HR', payroll_officer: 'HR',
  tracker: 'IT', administrator: 'IT',
}
const deptForRole = (r: RoleKey): string => DEPT_BY_ROLE[r] ?? 'Other'

export function useHrPeople(branch: BranchCode): HrPerson[] {
  const employees = useEmployees()
  const drivers = useDrivers()
  const users = useUsers()

  return useMemo(() => {
    const emps = employees.filter((e) => e.branch === branch)
    const drvs = drivers.filter((d) => d.branch === branch)

    const people: HrPerson[] = []
    for (const e of emps) {
      people.push({
        key: `hr:${e.id}`, id: e.id, source: 'hr', full_name: e.full_name, employee_no: e.employee_no,
        role: e.job_role, department: deptForJob(e.job_role), branch: e.branch,
        status: e.status, phone: e.phone, hod: e.hod, link: '/hr/employees',
      })
    }
    for (const d of drvs) {
      people.push({
        key: `driver:${d.id}`, id: d.id, source: 'driver', full_name: d.full_name, employee_no: d.employee_no,
        role: 'Driver', department: 'Drivers', branch: d.branch,
        status: d.status === 'suspended' ? 'inactive' : 'active', phone: d.phone, hod: d.section, link: '/drivers/profiles',
      })
    }
    // Accounts flagged "is an employee" that aren't already an HR employee or driver.
    // Viewers are not part of the organisation, so they never appear in HR.
    const empIds = new Set(emps.map((e) => e.id))
    const known = new Set(people.map((p) => p.full_name.trim().toLowerCase()))
    for (const u of users) {
      if (!u.is_employee || u.branch !== branch || u.role === 'viewer') continue
      if (u.employee_id && empIds.has(u.employee_id)) continue
      if (known.has(u.full_name.trim().toLowerCase())) continue
      people.push({
        key: `acct:${u.id}`, id: u.id, source: 'account', full_name: u.full_name, employee_no: u.username,
        role: ROLES[u.role].label, department: deptForRole(u.role), branch: u.branch,
        status: u.active ? 'active' : 'inactive', phone: '', hod: '', link: '/admin',
      })
    }
    return people.sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [employees, drivers, users, branch])
}
