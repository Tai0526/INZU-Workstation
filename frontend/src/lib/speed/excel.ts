import * as XLSX from 'xlsx'
import type { BranchCode } from '@/lib/roles'
import { driversStore } from '@/lib/drivers/store'
import { vehiclesStore } from '@/lib/fleet/store'
import { type SpeedEvent, type SpeedEventInput, type SpeedStatus, STATUS_META, overBy } from './types'

const COLUMNS = ['Date/Time', 'Driver', 'Vehicle', 'Route', 'Recorded Speed', 'Speed Limit', 'Status', 'Source', 'Notes']

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// ── Export ─────────────────────────────────────────────────────────────
export function exportEvents(events: SpeedEvent[], branchLabel: string) {
  const rows = events.map((e) => ({
    'Date/Time': e.event_datetime.replace('T', ' '),
    Driver: e.driver_name,
    Vehicle: e.vehicle_label,
    Route: e.route,
    'Recorded Speed': e.recorded_speed,
    'Speed Limit': e.speed_limit,
    'Over By': overBy(e),
    Status: STATUS_META[e.status].label,
    Source: e.source,
    Notes: e.notes,
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Speed Events')
  XLSX.writeFile(wb, `INZU_Speed_Events_${branchLabel}_${todayStr()}.xlsx`)
}

export function downloadTemplate() {
  const example = {
    'Date/Time': '2026-05-12 07:30',
    Driver: 'John Tembo',
    Vehicle: 'INZ 101',
    Route: 'Inside the Mine',
    'Recorded Speed': 78,
    'Speed Limit': 60,
    Status: 'Flagged',
    Source: 'Geotab',
    Notes: 'Delete this example row before uploading',
  }
  const ws = XLSX.utils.json_to_sheet([example], { header: COLUMNS })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Speed Events')
  XLSX.writeFile(wb, 'INZU_Speed_Events_Template.xlsx')
}

// ── Import ─────────────────────────────────────────────────────────────
export interface ImportResult {
  valid: SpeedEventInput[]
  errors: { row: number; reason: string }[]
}

function pick(row: Record<string, any>, ...names: string[]): any {
  const map: Record<string, any> = {}
  for (const k of Object.keys(row)) map[k.trim().toLowerCase()] = row[k]
  for (const n of names) {
    const v = map[n.trim().toLowerCase()]
    if (v !== undefined && v !== '') return v
  }
  return ''
}

function normStatus(s: string): SpeedStatus {
  const t = String(s).trim().toLowerCase()
  if (t.startsWith('conf')) return 'confirmed'
  if (t.startsWith('disp')) return 'disputed'
  if (t.startsWith('clos')) return 'closed'
  return 'flagged'
}

function toIso(v: any): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 16)
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 16)
}

export async function parseImportFile(file: File, branch: BranchCode): Promise<ImportResult> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })

  // Resolve names to ids within the branch
  const drivers = driversStore.list().filter((d) => d.branch === branch)
  const vehicles = vehiclesStore.list().filter((v) => v.branch === branch)
  const driverByName = new Map(drivers.map((d) => [d.full_name.trim().toLowerCase(), d]))
  const vehicleByFleet = new Map(vehicles.map((v) => [v.fleet_no.trim().toLowerCase(), v]))

  const valid: SpeedEventInput[] = []
  const errors: { row: number; reason: string }[] = []

  raw.forEach((r, i) => {
    const rowNo = i + 2
    const driver_name = String(pick(r, 'Driver', 'Driver Name')).trim()
    const dtRaw = pick(r, 'Date/Time', 'Date', 'Datetime', 'Date Time')
    if (!driver_name && !dtRaw) return // blank row
    const iso = toIso(dtRaw)
    if (!iso) { errors.push({ row: rowNo, reason: 'Missing or invalid Date/Time' }); return }
    if (!driver_name) { errors.push({ row: rowNo, reason: 'Missing Driver' }); return }
    const recorded = Number(pick(r, 'Recorded Speed', 'Speed', 'Recorded'))
    const limit = Number(pick(r, 'Speed Limit', 'Limit'))
    if (!Number.isFinite(recorded) || !Number.isFinite(limit)) {
      errors.push({ row: rowNo, reason: `${driver_name}: recorded speed and limit must be numbers` })
      return
    }
    const vehicle_label = String(pick(r, 'Vehicle', 'Fleet No', 'Fleet Number')).trim()
    const driver = driverByName.get(driver_name.toLowerCase())
    const vehicle = vehicleByFleet.get(vehicle_label.toLowerCase())

    valid.push({
      branch,
      event_datetime: iso,
      driver_id: driver?.id ?? '',
      driver_name,
      vehicle_id: vehicle?.id ?? '',
      vehicle_label: vehicle?.fleet_no ?? vehicle_label,
      route: String(pick(r, 'Route', 'Area', 'Location')).trim(),
      recorded_speed: recorded,
      speed_limit: limit,
      status: normStatus(pick(r, 'Status')),
      source: String(pick(r, 'Source')).trim() || 'Geotab',
      notes: String(pick(r, 'Notes')).trim(),
      resolved_by: '',
      resolved_at: '',
    })
  })

  return { valid, errors }
}
