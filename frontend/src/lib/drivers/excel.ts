import * as XLSX from 'xlsx'
import type { BranchCode } from '@/lib/roles'
import { SECTIONS } from '@/lib/org/sections'
import type { Driver, DriverInput, Crew, DriverStatus } from './types'
import { schedulingStore } from './scheduling'

/** Column order shared by export + the import template. */
const COLUMNS: { header: string; key: keyof Driver }[] = [
  { header: 'Employee No', key: 'employee_no' },
  { header: 'Full Name', key: 'full_name' },
  { header: 'Branch', key: 'branch' },
  { header: 'Section', key: 'section' },
  { header: 'Crew', key: 'crew' },
  { header: 'Status', key: 'status' },
  { header: 'Phone', key: 'phone' },
  { header: 'Licence No', key: 'licence_no' },
  { header: 'Licence Class', key: 'licence_class' },
  { header: 'Licence Expiry', key: 'licence_expiry' },
  { header: 'PSV Expiry', key: 'psv_expiry' },
  { header: 'Date Hired', key: 'date_hired' },
  { header: 'Notes', key: 'notes' },
]

const STATUS_LABEL: Record<DriverStatus, string> = { active: 'Active', on_leave: 'On leave', suspended: 'Suspended' }
const todayStr = () => new Date().toISOString().slice(0, 10)

// ── Export ───────────────────────────────────────────────────────────────
export function exportDrivers(drivers: Driver[], branchLabel: string) {
  const rows = drivers.map((d) =>
    Object.fromEntries(COLUMNS.map((c) => {
      let val: any = d[c.key]
      if (c.key === 'branch') val = d.branch === 'kansanshi' ? 'Kansanshi' : 'Trident'
      if (c.key === 'status') val = STATUS_LABEL[d.status]
      if (c.key === 'crew') val = `Crew ${d.crew}`
      return [c.header, val ?? '']
    })),
  )
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS.map((c) => c.header) })
  ws['!cols'] = COLUMNS.map((c) => ({ wch: Math.max(c.header.length + 2, 14) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Drivers')
  XLSX.writeFile(wb, `INZU_Drivers_${branchLabel}_${todayStr()}.xlsx`)
}

// ── Import template ───────────────────────────────────────────────────────
export function downloadTemplate(branch: BranchCode) {
  const example = {
    'Employee No': 'INZ-D999',
    'Full Name': 'Jane Doe',
    Branch: branch === 'kansanshi' ? 'Kansanshi' : 'Trident',
    Section: SECTIONS[branch][0],
    Crew: 'A',
    Status: 'Active',
    Phone: '',
    'Licence No': 'DL-000',
    'Licence Class': 'C1',
    'Licence Expiry': '2027-01-01',
    'PSV Expiry': '2027-01-01',
    'Date Hired': '2024-01-01',
    Notes: 'Delete this example row before uploading',
  }
  const ws = XLSX.utils.json_to_sheet([example], { header: COLUMNS.map((c) => c.header) })
  ws['!cols'] = COLUMNS.map((c) => ({ wch: Math.max(c.header.length + 2, 14) }))
  // A helper sheet listing valid sections + crews so users pick the right values.
  const help = XLSX.utils.json_to_sheet([
    { Field: 'Section (Kansanshi)', Allowed: SECTIONS.kansanshi.join(', ') },
    { Field: 'Section (Trident)', Allowed: SECTIONS.trident.join(', ') },
    { Field: 'Crew', Allowed: schedulingStore.get().crews.map((c) => c.label).join(', ') || 'A, B' },
    { Field: 'Status', Allowed: 'Active, On leave, Suspended' },
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Drivers')
  XLSX.utils.book_append_sheet(wb, help, 'Allowed values')
  XLSX.writeFile(wb, 'INZU_Driver_Import_Template.xlsx')
}

// ── Import / parse ─────────────────────────────────────────────────────────
export type ParsedRow = DriverInput
export interface ImportResult { valid: ParsedRow[]; errors: { row: number; reason: string }[] }

function normBranch(s: string): BranchCode | null {
  const t = s.trim().toLowerCase()
  if (t.startsWith('kan')) return 'kansanshi'
  if (t.startsWith('tri')) return 'trident'
  return null
}
function normCrew(s: string): Crew {
  const crews = schedulingStore.get().crews
  const raw = String(s).replace(/crew/gi, '').trim().toLowerCase()
  const hit = crews.find((c) => c.id.toLowerCase() === raw || c.label.toLowerCase() === raw)
  if (hit) return hit.id
  if (/night/i.test(s)) { const n = crews.find((c) => /night/i.test(c.label)); if (n) return n.id }
  return crews[0]?.id ?? 'A'
}
function normStatus(s: string): DriverStatus {
  const t = s.trim().toLowerCase()
  if (t.includes('leave')) return 'on_leave'
  if (t.includes('suspend')) return 'suspended'
  return 'active'
}
/** Match a section leniently (case/space-insensitive) against the branch's list. */
function matchSection(s: string, branch: BranchCode): string | null {
  const t = s.trim().toLowerCase()
  if (!t) return SECTIONS[branch][0]
  return SECTIONS[branch].find((sec) => sec.toLowerCase() === t) ?? null
}
function pick(row: Record<string, any>, ...names: string[]): any {
  const map: Record<string, any> = {}
  for (const k of Object.keys(row)) map[k.trim().toLowerCase()] = row[k]
  for (const n of names) { const hit = map[n.trim().toLowerCase()]; if (hit !== undefined) return hit }
  return ''
}

export async function parseImportFile(file: File, defaultBranch: BranchCode): Promise<ImportResult> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })

  const valid: ParsedRow[] = []
  const errors: { row: number; reason: string }[] = []

  raw.forEach((r, i) => {
    const rowNo = i + 2
    const employee_no = String(pick(r, 'Employee No', 'Employee Number', 'employee_no')).trim()
    const full_name = String(pick(r, 'Full Name', 'Name', 'full_name')).trim()
    if (!employee_no && !full_name) return // skip blank rows
    if (!full_name) { errors.push({ row: rowNo, reason: 'Missing Full Name' }); return }
    if (!employee_no) { errors.push({ row: rowNo, reason: `${full_name}: missing Employee No` }); return }
    const branchRaw = String(pick(r, 'Branch')).trim()
    const branch = branchRaw ? normBranch(branchRaw) : defaultBranch
    if (!branch) { errors.push({ row: rowNo, reason: `${employee_no}: branch "${branchRaw}" not recognised (Kansanshi or Trident)` }); return }
    const section = matchSection(String(pick(r, 'Section')), branch)
    if (!section) { errors.push({ row: rowNo, reason: `${employee_no}: section "${String(pick(r, 'Section'))}" not valid for ${branch} (use ${SECTIONS[branch].join(', ')})` }); return }
    valid.push({
      employee_no, full_name, branch, section,
      crew: normCrew(String(pick(r, 'Crew'))),
      status: normStatus(String(pick(r, 'Status'))),
      phone: String(pick(r, 'Phone')).trim(),
      licence_no: String(pick(r, 'Licence No', 'License No')).trim(),
      licence_class: String(pick(r, 'Licence Class', 'License Class')).trim() || 'C1',
      licence_expiry: String(pick(r, 'Licence Expiry', 'License Expiry')).trim().slice(0, 10),
      psv_expiry: String(pick(r, 'PSV Expiry')).trim().slice(0, 10),
      date_hired: String(pick(r, 'Date Hired', 'Hired')).trim().slice(0, 10),
      overtime: false,
      photo_file_id: '',
      notes: String(pick(r, 'Notes')).trim(),
    })
  })

  return { valid, errors }
}
