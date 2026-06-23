import * as XLSX from 'xlsx'
import type { BranchCode } from '@/lib/roles'
import { type Vehicle, type VehicleInput, type VehicleStatus, type VehicleType, STATUS_META, TYPE_LABELS } from './types'

/** Column order shared by export and the import template. */
const COLUMNS: { header: string; key: keyof Vehicle }[] = [
  { header: 'Fleet Number', key: 'fleet_no' },
  { header: 'Registration Plate', key: 'reg_plate' },
  { header: 'Make', key: 'make' },
  { header: 'Model', key: 'model' },
  { header: 'Year', key: 'year' },
  { header: 'Type', key: 'type' },
  { header: 'Branch', key: 'branch' },
  { header: 'Status', key: 'status' },
  { header: 'Capacity', key: 'capacity' },
  { header: 'Colour', key: 'colour' },
  { header: 'Chassis No', key: 'chassis_no' },
  { header: 'Engine No', key: 'engine_no' },
  { header: 'In Service Date', key: 'in_service_date' },
  { header: 'Notes', key: 'notes' },
]

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Export ─────────────────────────────────────────────────────────────
export function exportVehicles(vehicles: Vehicle[], branchLabel: string) {
  const rows = vehicles.map((v) =>
    Object.fromEntries(
      COLUMNS.map((c) => {
        let val: any = v[c.key]
        if (c.key === 'type') val = TYPE_LABELS[v.type]
        if (c.key === 'status') val = STATUS_META[v.status].label
        if (c.key === 'branch') val = v.branch === 'kansanshi' ? 'Kansanshi' : 'Trident'
        return [c.header, val ?? '']
      }),
    ),
  )
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS.map((c) => c.header) })
  ws['!cols'] = COLUMNS.map((c) => ({ wch: Math.max(c.header.length + 2, 14) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Vehicles')
  XLSX.writeFile(wb, `INZU_Vehicle_Register_${branchLabel}_${todayStr()}.xlsx`)
}

// ── Import template ────────────────────────────────────────────────────
export function downloadTemplate() {
  const example = {
    'Fleet Number': 'INZU-099',
    'Registration Plate': 'BAX 0000',
    Make: 'Tata',
    Model: 'Starbus LP 909',
    Year: 2023,
    Type: 'Bus',
    Branch: 'Kansanshi',
    Status: 'Active',
    Capacity: 32,
    Colour: 'White',
    'Chassis No': '',
    'Engine No': '',
    'In Service Date': '2023-06-01',
    Notes: 'Delete this example row before uploading',
  }
  const ws = XLSX.utils.json_to_sheet([example], { header: COLUMNS.map((c) => c.header) })
  ws['!cols'] = COLUMNS.map((c) => ({ wch: Math.max(c.header.length + 2, 14) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Vehicles')
  XLSX.writeFile(wb, 'INZU_Vehicle_Import_Template.xlsx')
}

// ── Import / parse ─────────────────────────────────────────────────────
export type ParsedRow = VehicleInput

export interface ImportResult {
  valid: ParsedRow[]
  errors: { row: number; reason: string }[]
}

function normBranch(s: string): BranchCode | null {
  const t = s.trim().toLowerCase()
  if (t.startsWith('kan')) return 'kansanshi'
  if (t.startsWith('tri')) return 'trident'
  return null
}

function normStatus(s: string): VehicleStatus {
  const t = s.trim().toLowerCase()
  if (t.includes('ground')) return 'grounded'
  if (t.includes('workshop') || t.includes('repair')) return 'under_repair'
  return 'active'
}

function normType(s: string): VehicleType {
  const t = s.trim().toLowerCase()
  if (t.includes('tipper')) return 'tipper'
  if (t.includes('light')) return 'light_vehicle'
  if (t.includes('bus')) return 'bus'
  if (!t) return 'bus'
  return 'other'
}

function num(v: any): number | null {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Lower-cased, trimmed header lookup so import is lenient about casing/spacing. */
function pick(row: Record<string, any>, ...names: string[]): any {
  const map: Record<string, any> = {}
  for (const k of Object.keys(row)) map[k.trim().toLowerCase()] = row[k]
  for (const n of names) {
    const hit = map[n.trim().toLowerCase()]
    if (hit !== undefined) return hit
  }
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
    const rowNo = i + 2 // header is row 1
    const fleet_no = String(pick(r, 'Fleet Number', 'Fleet No', 'fleet_no')).trim()
    const reg_plate = String(pick(r, 'Registration Plate', 'Reg Plate', 'Plate', 'reg_plate')).trim()
    if (!fleet_no && !reg_plate) return // skip fully blank rows silently
    if (!fleet_no) {
      errors.push({ row: rowNo, reason: 'Missing Fleet Number' })
      return
    }
    if (!reg_plate) {
      errors.push({ row: rowNo, reason: `${fleet_no}: missing Registration Plate` })
      return
    }
    const branchRaw = String(pick(r, 'Branch')).trim()
    const branch = branchRaw ? normBranch(branchRaw) : defaultBranch
    if (!branch) {
      errors.push({ row: rowNo, reason: `${fleet_no}: branch "${branchRaw}" not recognised (use Kansanshi or Trident)` })
      return
    }
    valid.push({
      fleet_no,
      reg_plate,
      make: String(pick(r, 'Make')).trim() || 'Tata',
      model: String(pick(r, 'Model')).trim(),
      year: num(pick(r, 'Year')),
      type: normType(String(pick(r, 'Type'))),
      branch,
      status: normStatus(String(pick(r, 'Status'))),
      capacity: num(pick(r, 'Capacity')),
      colour: String(pick(r, 'Colour', 'Color')).trim(),
      chassis_no: String(pick(r, 'Chassis No', 'Chassis')).trim(),
      engine_no: String(pick(r, 'Engine No', 'Engine')).trim(),
      in_service_date: String(pick(r, 'In Service Date', 'In-Service Date')).trim().slice(0, 10),
      notes: String(pick(r, 'Notes')).trim(),
    })
  })

  return { valid, errors }
}
