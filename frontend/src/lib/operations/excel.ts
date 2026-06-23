import * as XLSX from 'xlsx'
import type { BranchCode } from '@/lib/roles'
import type { MileageEntry, Allocation, AllocationInput, DailyPlanTrip } from './types'
import { APPROVAL_META } from './types'
import { routesStore } from './store'

function save(rows: object[], sheet: string, file: string) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, file)
}
const today = () => new Date().toISOString().slice(0, 10)

export function exportMileage(entries: MileageEntry[], branchLabel: string) {
  save(
    entries.map((e) => ({
      Date: e.date, Vehicle: e.vehicle_label, Driver: e.driver_name,
      'Actual km': e.actual_km, Status: APPROVAL_META[e.status].label, Notes: e.notes,
    })),
    'Mileage', `INZU_Mileage_${branchLabel}_${today()}.xlsx`,
  )
}

// ── Allocations (daily bus log) ────────────────────────────────────────
const ALLOC_COLS = ['Date', 'Type', 'Driver', 'Fleet No', 'Reg No', 'Location', 'Time', 'Passengers']

export function exportAllocations(entries: Allocation[], branchLabel: string) {
  save(
    entries.map((e) => ({
      Date: e.date, Type: e.trip_type === 'knockoff' ? 'Knock-off' : 'Pickup', Driver: e.driver_name,
      'Fleet No': e.fleet_no, 'Reg No': e.reg_no, Location: e.location, Time: e.departure_time,
      'Mileage (km)': e.planned_km || '', Passengers: e.passengers ?? '',
    })),
    'Allocations', `INZU_Bus_Allocation_${branchLabel}_${today()}.xlsx`,
  )
}

// ── Daily plan (intended movements) ────────────────────────────────────
export function exportDailyPlan(entries: DailyPlanTrip[], branchLabel: string) {
  save(
    entries.map((e) => ({
      Date: e.date, Type: e.trip_type === 'knockoff' ? 'Knock-off' : 'Pickup', Driver: e.driver_name, 'Fleet No': e.fleet_no, 'Reg No': e.reg_no,
      From: e.from_location, To: e.to_location, 'Departure Time': e.departure_time,
    })),
    'Daily Plan', `INZU_Daily_Plan_${branchLabel}_${today()}.xlsx`,
  )
}

export function downloadAllocTemplate() {
  const ws = XLSX.utils.json_to_sheet(
    [
      { Date: '19/06/2026', Type: 'Pickup', Driver: 'KASWEKA', 'Fleet No': 'INZ 226', 'Reg No': 'BCG 4666', Location: 'MUSELE JUNCTION', Time: '04:20', Passengers: 45 },
      { Date: '19/06/2026', Type: 'Knock-off', Driver: 'MBUZI', 'Fleet No': 'INZ 122', 'Reg No': 'BCG 4272', Location: 'LUMWANA', Time: '16:20', Passengers: '' },
    ],
    { header: ALLOC_COLS },
  )
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Allocations')
  XLSX.writeFile(wb, 'INZU_Bus_Allocation_Template.xlsx')
}

function normTripType(v: any, time: string): 'pickup' | 'knockoff' {
  const t = String(v).trim().toLowerCase()
  if (t.startsWith('knock') || t.startsWith('drop')) return 'knockoff'
  if (t.startsWith('pick')) return 'pickup'
  // Infer from time: morning runs are pickups, afternoon/evening are knock-offs
  const h = Number(time.slice(0, 2))
  return Number.isFinite(h) && h >= 12 ? 'knockoff' : 'pickup'
}

function pickA(row: Record<string, any>, ...names: string[]): any {
  const map: Record<string, any> = {}
  for (const k of Object.keys(row)) map[k.trim().toLowerCase()] = row[k]
  for (const n of names) { const v = map[n.trim().toLowerCase()]; if (v !== undefined && v !== '') return v }
  return ''
}
function parseDate(v: any): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m) { let [, d, mo, y] = m; if (y.length === 2) y = '20' + y; return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}` }
  const dt = new Date(s)
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10)
}
function parseTime(v: any): string {
  const m = String(v).match(/(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

export interface AllocImportResult { valid: AllocationInput[]; errors: { row: number; reason: string }[] }

export async function parseAllocations(file: File, branch: BranchCode): Promise<AllocImportResult> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })
  const routes = routesStore.list().filter((r) => r.branch === branch)
  const routeByName = new Map(routes.map((r) => [r.name.trim().toLowerCase(), r]))

  const valid: AllocationInput[] = []
  const errors: { row: number; reason: string }[] = []
  raw.forEach((r, i) => {
    const rowNo = i + 2
    const dateRaw = pickA(r, 'Date')
    const fleet = String(pickA(r, 'Fleet No', 'Fleet Number', 'Fleet')).trim()
    if (!dateRaw && !fleet) return // blank / spacer row
    const date = parseDate(dateRaw)
    if (!date) return // header repeat or invalid date — skip silently
    if (!fleet) { errors.push({ row: rowNo, reason: 'Missing Fleet No' }); return }
    const location = String(pickA(r, 'Location')).trim()
    const time = parseTime(pickA(r, 'Time', 'Departure Time'))
    const paxRaw = pickA(r, 'Passengers', 'Number of Passengers', 'No of Passengers')
    const pax = paxRaw === '' || paxRaw == null ? null : Number(paxRaw)
    const route = routeByName.get(location.toLowerCase())
    valid.push({
      branch, date,
      trip_type: normTripType(pickA(r, 'Type', 'Trip Type', 'Trip'), time),
      driver_name: String(pickA(r, 'Driver', 'Driver Name', 'Drivers Names', 'Drivers Name')).trim(),
      fleet_no: fleet,
      reg_no: String(pickA(r, 'Reg No', 'Reg Number', 'Registration')).trim(),
      route_id: route?.id ?? '',
      location,
      departure_time: time,
      passengers: Number.isFinite(pax as number) ? (pax as number) : null,
      planned_km: route?.distance_km ?? 0,
      notes: '',
    })
  })
  return { valid, errors }
}

