import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import type { RoleKey } from '@/lib/roles'

// Employee files hold sensitive personal data (IDs, salary, contracts, medicals),
// so viewing is limited to HR, the MD and Ops management — never the wider staff
// who can otherwise reach HR → Employees or a driver profile.
export const FILE_VIEW_ROLES: RoleKey[] = ['hr_manager', 'hr_officer', 'managing_director', 'operations_manager', 'asst_operations_manager', 'administrator']
export const canViewEmployeeFile = (role: RoleKey) => FILE_VIEW_ROLES.includes(role)

/**
 * Employee file — the rich personnel record that supplements the lightweight
 * directory entry (Employee / Driver / account). Holds personal & employment
 * details, next-of-kin and emergency contacts, uploaded documents (interview
 * transcript, qualifications, IDs, contract, certificates), and the exit
 * interview. Keyed by the directory person id, stored migration-free in
 * app_config so it works for employees AND drivers without a schema change.
 */

export interface Contact { name: string; relationship: string; phone: string }

export type DocCategory = 'interview' | 'qualification' | 'id' | 'contract' | 'certificate' | 'medical' | 'exit' | 'other'
export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  interview: 'Interview transcript', qualification: 'Qualification', id: 'ID document',
  contract: 'Contract', certificate: 'Certificate', medical: 'Medical', exit: 'Exit interview', other: 'Other',
}
export const DOC_CATEGORIES = Object.keys(DOC_CATEGORY_LABEL) as DocCategory[]

export interface EmpDoc { id: string; category: DocCategory; name: string; file_id: string; file_name: string; note: string; at: string; by: string }
export interface ExitInfo { date: string; reason: string; note: string; file_id: string; file_name: string }

// History log — dated records that stay on the file for auditability (trainings,
// promotions, transfers, salary changes, commendations, warnings…), each with an
// optional supporting upload.
export type EventType = 'training' | 'promotion' | 'transfer' | 'salary' | 'commendation' | 'warning' | 'note' | 'other'
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  training: 'Training', promotion: 'Promotion', transfer: 'Transfer', salary: 'Salary change',
  commendation: 'Commendation', warning: 'Warning', note: 'Note', other: 'Other',
}
export const EVENT_TYPES = Object.keys(EVENT_TYPE_LABEL) as EventType[]
export interface FileEvent { id: string; type: EventType; date: string; title: string; detail: string; file_id: string; file_name: string; by: string; at: string }

// Salary (optional) — grade/band + basic pay. When set, payroll reads the basic from
// here; statutory deductions are configured in Payroll.
export interface Allowance { name: string; amount: number }
export interface SalaryInfo { grade: string; band: string; basic: number; currency: string; effective: string; allowances: Allowance[] }

// Contract with an expiry so renewals can be prepared in time.
export type ExpiryState = 'none' | 'valid' | 'expiring' | 'expired'
export interface ContractDoc { id: string; branch: string; person_name: string; name: string; type: string; start: string; expiry: string; file_id: string; file_name: string; note: string; by: string; at: string }
export function contractExpiry(expiry: string, todayISO: string, soonDays = 30): ExpiryState {
  if (!expiry) return 'none'
  if (expiry < todayISO) return 'expired'
  const soon = new Date(`${todayISO}T00:00:00`).getTime() + soonDays * 86_400_000
  return new Date(`${expiry}T00:00:00`).getTime() <= soon ? 'expiring' : 'valid'
}

export interface EmployeeFile {
  national_id: string
  dob: string
  gender: string
  marital_status: string
  address: string
  email: string
  start_date: string      // hire date (the base employee record has none)
  leave_opening: number   // annual-leave days carried in when the system went live
  leave_opening_at: string // date that opening balance was captured (accrual starts here)
  job_title: string
  contract_type: string   // Permanent / Fixed-term / Casual …
  tpin: string            // tax number
  napsa: string           // social-security number
  bank_name: string
  bank_branch: string
  bank_account: string
  next_of_kin: Contact
  emergency_contacts: Contact[]
  documents: EmpDoc[]
  events: FileEvent[]      // trainings, promotions, salary changes, warnings…
  salary: SalaryInfo | null
  contracts: ContractDoc[]
  exit: ExitInfo | null
  notes: string
  updated_by: string
  updated_at: string
}

export function blankFile(): EmployeeFile {
  return {
    national_id: '', dob: '', gender: '', marital_status: '', address: '', email: '',
    start_date: '', leave_opening: 0, leave_opening_at: '', job_title: '', contract_type: '', tpin: '', napsa: '', bank_name: '', bank_branch: '', bank_account: '',
    next_of_kin: { name: '', relationship: '', phone: '' }, emergency_contacts: [], documents: [], events: [], salary: null, contracts: [], exit: null, notes: '',
    updated_by: '', updated_at: '',
  }
}

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `doc_${Date.now()}_${Math.round(Math.random() * 1e6)}`)
const stampNow = () => new Date().toISOString()
const who = () => getActor().name
const cfg = createSyncConfig<Record<string, EmployeeFile>>({ key: 'employee_files', lsKey: 'inzu_employee_files', default: {} })

export const employeeFileStore = {
  get: cfg.get,
  subscribe: cfg.subscribe,
  for: (id: string): EmployeeFile => cfg.get()[id] ?? blankFile(),
  has: (id: string): boolean => !!cfg.get()[id],
  set(id: string, patch: Partial<EmployeeFile>) {
    const cur = cfg.get()[id] ?? blankFile()
    cfg.set({ ...cfg.get(), [id]: { ...cur, ...patch, updated_by: who(), updated_at: stampNow() } })
  },
  addDoc(id: string, doc: { category: DocCategory; name: string; file_id: string; file_name: string; note?: string }) {
    const cur = cfg.get()[id] ?? blankFile()
    const rec: EmpDoc = { id: newId(), category: doc.category, name: doc.name.trim() || doc.file_name, file_id: doc.file_id, file_name: doc.file_name, note: (doc.note ?? '').trim(), at: stampNow(), by: who() }
    employeeFileStore.set(id, { documents: [...cur.documents, rec] })
  },
  removeDoc(id: string, docId: string) {
    const cur = cfg.get()[id] ?? blankFile()
    employeeFileStore.set(id, { documents: cur.documents.filter((d) => d.id !== docId) })
  },
  addEvent(id: string, ev: { type: EventType; date: string; title: string; detail?: string; file_id?: string; file_name?: string }) {
    const cur = cfg.get()[id] ?? blankFile()
    const rec: FileEvent = { id: newId(), type: ev.type, date: ev.date, title: ev.title.trim(), detail: (ev.detail ?? '').trim(), file_id: ev.file_id ?? '', file_name: ev.file_name ?? '', by: who(), at: stampNow() }
    employeeFileStore.set(id, { events: [...cur.events, rec] })
  },
  removeEvent(id: string, evId: string) { const cur = cfg.get()[id] ?? blankFile(); employeeFileStore.set(id, { events: cur.events.filter((e) => e.id !== evId) }) },
  addContract(id: string, c: { branch: string; person_name: string; name: string; type: string; start: string; expiry: string; file_id?: string; file_name?: string; note?: string }) {
    const cur = cfg.get()[id] ?? blankFile()
    const rec: ContractDoc = { id: newId(), branch: c.branch, person_name: c.person_name, name: c.name.trim() || 'Contract', type: c.type.trim(), start: c.start, expiry: c.expiry, file_id: c.file_id ?? '', file_name: c.file_name ?? '', note: (c.note ?? '').trim(), by: who(), at: stampNow() }
    employeeFileStore.set(id, { contracts: [...cur.contracts, rec] })
  },
  removeContract(id: string, cId: string) { const cur = cfg.get()[id] ?? blankFile(); employeeFileStore.set(id, { contracts: cur.contracts.filter((c) => c.id !== cId) }) },
  clear(id: string) { const c = { ...cfg.get() }; delete c[id]; cfg.set(c) },
}
export const useEmployeeFiles = () => useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
/** Rough completeness of the core file fields — for a "file X% complete" nudge. */
export function fileCompleteness(f: EmployeeFile): number {
  const core = [f.national_id, f.dob, f.address, f.email, f.start_date, f.contract_type, f.next_of_kin.name, f.next_of_kin.phone]
  const filled = core.filter((v) => !!(v || '').trim()).length
  const hasDocs = f.documents.length > 0 ? 1 : 0
  return Math.round(((filled + hasDocs) / (core.length + 1)) * 100)
}
