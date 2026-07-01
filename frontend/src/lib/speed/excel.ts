import * as XLSX from 'xlsx'
import { type SpeedEvent, STATUS_META, overBy } from './types'

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

// ── Geotab overspeeding-report import ──────────────────────────────────
// The daily Geotab export (sheet "Data") carries one row per speeding exception:
// device (bus), NO driver, the exception rule (encodes the zone), coordinates,
// start time (Excel serial), duration (fraction of a day) and max speed. We parse
// every row into a candidate; the import modal then applies the filter rules
// (min km/h over the limit + min duration) and de-dupes against prior imports.

export interface GeoCandidate {
  startISO: string // yyyy-mm-ddThh:mm (site wall-clock)
  date: string // yyyy-mm-dd
  fleet: string // parsed label e.g. "INZ 229"
  vehicle_id: string // matched vehicle id, or ''
  vehicle_label: string // matched fleet_no, or the parsed label
  maxSpeed: number
  limit: number // posted zone limit (40 / 60 / 80)
  over: number // maxSpeed − min(limit, 80)
  durSec: number
  distKm: number
  lat: number
  lng: number
  loc: string // short location (for the event's route field)
  locFull: string // full location text (kept in geo detail)
  rule: string
  ref: string // dedup key
}

export interface GeoParseResult {
  format: 'geotab' | 'unknown'
  candidates: GeoCandidate[]
  total: number // rows read
  devices: number
  from: string
  to: string
  message?: string
}

const numFrom = (v: any): number | null => {
  const m = String(v ?? '').match(/(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : null
}

/** Excel serial → site wall-clock ISO (no timezone shift, so hour-of-day is right). */
function serialToLocalISO(serial: number): string {
  const d = new Date(Math.round((serial - 25569) * 86400) * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** Posted zone limit from the Geotab rule threshold (82→80, 62→60, else 40). */
function zoneFromThreshold(thr: number | null): number {
  if (thr == null) return 40
  if (thr >= 80) return 80
  if (thr >= 60) return 60
  return 40
}

function parseFleet(device: string): { label: string; canon: string } {
  const m = String(device || '').toUpperCase().match(/INZ\s*(\d+)/)
  if (m) return { label: `INZ ${m[1]}`, canon: `INZ${parseInt(m[1], 10)}` }
  const canon = String(device || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return { label: String(device || '').trim(), canon }
}
const canonFleet = (s: string) => parseFleet(s).canon

/** Shorten the long location string to the leading, most specific segment. */
function shortLoc(full: string): string {
  const before = String(full || '').split(':')[0]
  return before.split(',')[0].trim() || String(full || '').trim()
}

function firstCell<T = any>(row: Record<string, any>, keys: string[]): T | null {
  for (const k of keys) { const v = row[k]; if (v !== undefined && v !== null && v !== '') return v as T }
  return null
}

/** Locate the report sheet + header row (works for both the "Data" and "Report" tabs). */
function findGeotabRows(wb: XLSX.WorkBook): Record<string, any>[] | null {
  for (const name of ['Data', 'Report', ...wb.SheetNames]) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null, raw: true })
    const hdr = grid.findIndex((r) => Array.isArray(r) && r.some((c) => c === '.Device.DeviceName' || c === 'Device'))
    if (hdr < 0) continue
    return XLSX.utils.sheet_to_json<Record<string, any>>(ws, { range: hdr, defval: null, raw: true })
  }
  return null
}

export async function parseGeotab(file: File, vehicles: { id: string; fleet_no: string }[]): Promise<GeoParseResult> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', raw: true })
  const rows = findGeotabRows(wb)
  if (!rows) return { format: 'unknown', candidates: [], total: 0, devices: 0, from: '', to: '', message: 'This is not a Geotab overspeeding report. Use the daily export (it has a “Data” sheet).' }

  const vehByCanon = new Map(vehicles.map((v) => [canonFleet(v.fleet_no), v]))
  const candidates: GeoCandidate[] = []
  const seenDevices = new Set<string>()

  for (const r of rows) {
    const device = firstCell<string>(r, ['.Device.DeviceName', 'Device'])
    const startRaw = firstCell<number>(r, ['ExceptionDetailStartTime', 'Start Time', 'Date'])
    const maxSpeed = numFrom(firstCell(r, ['ExceptionDetailExtraInfo', 'Max Speed', 'Extra Info']))
    if (!device || typeof startRaw !== 'number' || maxSpeed == null) continue

    const rule = String(firstCell(r, ['.ExceptionRule.ExceptionRuleName', 'ExceptionRule', 'Details']) ?? '')
    const limit = zoneFromThreshold(numFrom(rule))
    const durSec = Number(firstCell(r, ['ExceptionDuration', 'Duration']) ?? 0) * 86400
    const distKm = Number(firstCell(r, ['ExceptionDistance', 'Distance']) ?? 0)
    const lat = Number(firstCell(r, ['ExceptionDetailLatitude', 'Latitude']) ?? 0)
    const lng = Number(firstCell(r, ['ExceptionDetailLongitude', 'Longitude']) ?? 0)
    const locFull = String(firstCell(r, ['ExceptionDetailLocation', 'Location']) ?? '')

    const { label, canon } = parseFleet(device)
    const veh = vehByCanon.get(canon)
    const startISO = serialToLocalISO(startRaw)

    candidates.push({
      startISO, date: startISO.slice(0, 10),
      fleet: label, vehicle_id: veh?.id ?? '', vehicle_label: veh?.fleet_no ?? label,
      maxSpeed, limit, over: Math.max(0, Math.round(maxSpeed - Math.min(limit, 80))),
      durSec: Math.round(durSec * 10) / 10, distKm: Math.round(distKm * 1000) / 1000,
      lat, lng, loc: shortLoc(locFull), locFull, rule,
      ref: `${canon}|${startISO}|${maxSpeed}`,
    })
    seenDevices.add(canon)
  }

  const dates = candidates.map((c) => c.date).sort()
  return {
    format: 'geotab', candidates, total: rows.length, devices: seenDevices.size,
    from: dates[0] ?? '', to: dates[dates.length - 1] ?? '',
  }
}
