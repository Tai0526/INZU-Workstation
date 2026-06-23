import * as XLSX from 'xlsx'
import type { BranchCode } from '@/lib/roles'
import { type FuelIssuance, type IssuanceInput, type FuelReceipt, kmMoved, kmPerLitre } from './types'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function parseDate(v: any): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})$/) // 1-Mar-26
  if (m) { let [, d, mon, y] = m; const mi = MONTHS.indexOf(mon.slice(0, 3).toLowerCase()); if (mi >= 0) { if (y.length === 2) y = '20' + y; return `${y}-${String(mi + 1).padStart(2, '0')}-${d.padStart(2, '0')}` } }
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/) // dd/mm/yyyy
  if (m) { let [, d, mo, y] = m; if (y.length === 2) y = '20' + y; return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}` }
  const dt = new Date(s)
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10)
}
function pick(row: Record<string, any>, ...names: string[]): any {
  const map: Record<string, any> = {}
  for (const k of Object.keys(row)) map[k.trim().toLowerCase()] = row[k]
  for (const n of names) { const v = map[n.trim().toLowerCase()]; if (v !== undefined && v !== '') return v }
  return ''
}
const num = (v: any) => { const n = Number(String(v).replace(/[, ]/g, '')); return Number.isFinite(n) ? n : 0 }

export interface IssuanceImport { valid: IssuanceInput[]; errors: { row: number; reason: string }[] }

export async function parseIssuances(file: File, branch: BranchCode, defaults: { fleet_no: string; vehicle_reg: string; fuel_attendant: string }): Promise<IssuanceImport> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })
  const valid: IssuanceInput[] = []
  const errors: { row: number; reason: string }[] = []
  raw.forEach((r, i) => {
    const rowNo = i + 2
    const dateRaw = pick(r, 'Date')
    const litresRaw = pick(r, 'Liters Given', 'Litres Given', 'Litres', 'Liters')
    if (!dateRaw && !litresRaw) return
    const date = parseDate(dateRaw)
    if (!date) return // header/blank — skip
    const om = num(pick(r, 'Opening Mileage', 'Opening Mile'))
    const cm = num(pick(r, 'Closing Mileage', 'Closing Mile'))
    valid.push({
      branch, date,
      fleet_no: String(pick(r, 'Fleet No', 'Fleet Number', 'Fleet') || defaults.fleet_no).trim(),
      vehicle_reg: String(pick(r, 'Reg No', 'V.Reg', 'Reg', 'Registration') || defaults.vehicle_reg).trim(),
      driver: String(pick(r, 'Driver', 'Driver Name')).trim(),
      fuel_attendant: String(pick(r, 'Attendant', 'Fuel Attendant') || defaults.fuel_attendant).trim(),
      trip_number: pick(r, 'Trip Number', 'Trip') === '' ? null : num(pick(r, 'Trip Number', 'Trip')),
      route: String(pick(r, 'Route', 'Location')).trim(),
      opening_fuel_level: String(pick(r, 'Opening Fuel Level', 'Opening Fuel')).trim(),
      closing_fuel_level: String(pick(r, 'Closing Fuel Level', 'Closing Fuel')).trim(),
      opening_mileage: om,
      closing_mileage: cm,
      liters_given: num(litresRaw),
      notes: '',
    })
  })
  return { valid, errors }
}

export function downloadIssuanceTemplate() {
  const rows = [
    { Date: '1-Mar-26', 'Fleet No': 'INZ 120', 'Reg No': 'BCG 4270', Driver: 'Gibson Kasongo', Attendant: 'Asford', 'Trip Number': 4, Route: 'Pineapple', 'Opening Fuel Level': 'Below half tank', 'Closing Fuel Level': 'Half tank', 'Opening Mileage': 141446, 'Closing Mileage': 141610, 'Liters Given': 20 },
  ]
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Fuel')
  XLSX.writeFile(wb, 'INZU_Fuel_Issuance_Template.xlsx')
}

export function exportIssuances(items: FuelIssuance[], branchLabel: string) {
  const rows = items.map((i) => ({
    Date: i.date, 'Fleet No': i.fleet_no, 'Reg No': i.vehicle_reg, Driver: i.driver, Attendant: i.fuel_attendant,
    'Trip Number': i.trip_number ?? '', Route: i.route, 'Opening Fuel Level': i.opening_fuel_level, 'Closing Fuel Level': i.closing_fuel_level,
    'Opening Mileage': i.opening_mileage, 'Closing Mileage': i.closing_mileage, 'Liters Given': i.liters_given,
    'KM Moved': kmMoved(i), 'KM/L': kmPerLitre(i)?.toFixed(2) ?? '',
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Fuel')
  XLSX.writeFile(wb, `INZU_Fuel_${branchLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

/** Export the fuel deliveries register (receipts into the depot). */
export function exportReceipts(items: FuelReceipt[], branchLabel: string) {
  const rows = items.map((r) => ({
    Date: r.date, Supplier: r.supplier, 'Litres Received': r.litres,
    'Unit Cost (USD/L)': r.unit_cost_usd ?? '', 'Total Cost (USD)': r.unit_cost_usd != null ? +(r.litres * r.unit_cost_usd).toFixed(2) : '',
    'Delivery Note': r.delivery_note_file ? 'Attached' : '', Notes: r.notes, 'Recorded By': r.created_by, 'Recorded At': r.created_at,
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Deliveries')
  XLSX.writeFile(wb, `INZU_Fuel_Deliveries_${branchLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
