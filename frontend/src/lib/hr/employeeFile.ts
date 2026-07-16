import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import { createSyncConfig } from '@/lib/supabase/syncTable'

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

export interface EmployeeFile {
  national_id: string
  dob: string
  gender: string
  marital_status: string
  address: string
  email: string
  start_date: string      // hire date (the base employee record has none)
  job_title: string
  contract_type: string   // Permanent / Fixed-term / Casual …
  tpin: string            // tax number
  napsa: string           // social-security number
  bank_name: string
  bank_account: string
  next_of_kin: Contact
  emergency_contacts: Contact[]
  documents: EmpDoc[]
  exit: ExitInfo | null
  notes: string
  updated_by: string
  updated_at: string
}

export function blankFile(): EmployeeFile {
  return {
    national_id: '', dob: '', gender: '', marital_status: '', address: '', email: '',
    start_date: '', job_title: '', contract_type: '', tpin: '', napsa: '', bank_name: '', bank_account: '',
    next_of_kin: { name: '', relationship: '', phone: '' }, emergency_contacts: [], documents: [], exit: null, notes: '',
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
