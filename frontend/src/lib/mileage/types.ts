import type { BranchCode } from '@/lib/roles'
import type { Audited } from '@/lib/operations/types'

/**
 * Mileage reconciliation for FQM billing. This mirrors the monthly
 * "Route and Kilometer Reconciliation" workbook: a per-vehicle movement
 * log (split into internal / external kilometres), rolled up into a costed
 * monthly summary per bus class, with VAT, ready to export to FQM Trident.
 *
 * Internal = inside the mine; External = outside (residential pickups).
 * Some projects (e.g. Sentinel) run external-only buses, so internal is 0.
 */

// ── Projects (a billing contract within a branch) ──────────────────────
export const PROJECTS_BY_BRANCH: Record<BranchCode, string[]> = {
  trident: ['Enterprise', 'Sentinel'],
  kansanshi: ['Kansanshi'],
}

// ── Bus seat classes & contract rates (USD per km) ─────────────────────
export const SEAT_CLASSES = ['60', '40', '28'] as const
export type SeatClass = (typeof SEAT_CLASSES)[number]
export const SEAT_LABEL: Record<SeatClass, string> = {
  '60': '60 Seater', '40': '40 Seater', '28': '15–28 Seater',
}

export interface MileageRates {
  rate60: number
  rate40: number
  rate28: number
  vat_pct: number
}
export const DEFAULT_RATES: MileageRates = { rate60: 2.62, rate40: 2.24, rate28: 1.85, vat_pct: 16 }
export function rateFor(r: MileageRates, s: SeatClass): number {
  return s === '60' ? r.rate60 : s === '40' ? r.rate40 : r.rate28
}

/** Best-guess seat class from a vehicle's seat capacity. Anything 15–28 → the 15–28 band. */
export function classFromCapacity(cap: number | null): SeatClass {
  if (!cap) return '40'
  if (cap >= 50) return '60'
  if (cap >= 29) return '40'
  return '28'
}

// ── Shifts (a bus runs several runs across the day) ────────────────────
export const SHIFTS = ['Morning', 'Afternoon', 'Evening', 'Night'] as const
export type Shift = (typeof SHIFTS)[number]

// ── Route catalogue (per project) with internal/external split ─────────
export interface MileageRoute extends Audited {
  branch: BranchCode
  project: string
  name: string
  internal_km: number
  external_km: number
}
export type MileageRouteInput = Omit<MileageRoute, keyof Audited>
export const routeTotal = (r: { internal_km: number; external_km: number }) => r.internal_km + r.external_km

// ── A single bus movement (one run / shift) ────────────────────────────
export interface MileageTrip extends Audited {
  branch: BranchCode
  project: string
  date: string // yyyy-mm-dd
  fleet_no: string
  vehicle_reg: string
  seat_class: SeatClass
  shift: Shift
  route: string
  internal_km: number
  external_km: number
  // stamped only on a genuine user edit (drives the "edited" tag)
  edited_by?: string
  edited_at?: string
}
export type MileageTripInput = Omit<MileageTrip, keyof Audited | 'edited_by' | 'edited_at'>
export const tripKm = (t: { internal_km: number; external_km: number }) => t.internal_km + t.external_km

// ── Signatories on the reconciliation (per branch + project) ───────────
export interface Signatories {
  inzu_prepared: string
  inzu_checked: string
  inzu_authorised: string
  inzu_approved: string
  fqm_checked: string
  fqm_approved: string
}
export const DEFAULT_SIGNATORIES: Signatories = {
  inzu_prepared: '', inzu_checked: '', inzu_authorised: '', inzu_approved: '', fqm_checked: '', fqm_approved: '',
}

// ── Summary computation ────────────────────────────────────────────────
export interface ClassTotals {
  seat_class: SeatClass
  qty: number // distinct buses in this class that ran in the month
  internal_km: number
  external_km: number
  rate: number
  internal_amt: number
  external_amt: number
  subtotal: number
}
export interface DayRow {
  date: string
  perFleet: Record<string, number> // fleet_no -> total km that day
  internal: number
  external: number
  claimable: number
  amount: number
}
/** A day's mileage + cost for one bus class. */
export interface DayClassCell { internal: number; external: number; claimable: number; amount: number }
export interface DayClassRow {
  date: string
  byClass: Partial<Record<SeatClass, DayClassCell>>
  claimable: number // combined km across classes
  amount: number // combined cost across classes
}
export interface MileageSummary {
  fleets: { fleet_no: string; vehicle_reg: string; seat_class: SeatClass }[]
  classes: ClassTotals[]
  days: DayRow[]
  dailyByClass: DayClassRow[]
  internal_km: number
  external_km: number
  total_km: number
  subtotal: number
  vat: number
  total: number
  vat_pct: number
  hasInternal: boolean
}

function fleetSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true })
}

export function summarise(trips: MileageTrip[], rates: MileageRates): MileageSummary {
  const fleetMap = new Map<string, { fleet_no: string; vehicle_reg: string; seat_class: SeatClass }>()
  for (const t of trips) {
    if (!fleetMap.has(t.fleet_no)) fleetMap.set(t.fleet_no, { fleet_no: t.fleet_no, vehicle_reg: t.vehicle_reg, seat_class: t.seat_class })
  }
  const fleets = [...fleetMap.values()].sort((a, b) => fleetSort(a.fleet_no, b.fleet_no))

  const classAcc = new Map<SeatClass, { internal: number; external: number; fleets: Set<string> }>()
  for (const t of trips) {
    const c = classAcc.get(t.seat_class) ?? { internal: 0, external: 0, fleets: new Set<string>() }
    c.internal += t.internal_km
    c.external += t.external_km
    c.fleets.add(t.fleet_no)
    classAcc.set(t.seat_class, c)
  }
  const classes: ClassTotals[] = SEAT_CLASSES.filter((s) => classAcc.has(s)).map((s) => {
    const c = classAcc.get(s)!
    const rate = rateFor(rates, s)
    const internal_amt = c.internal * rate
    const external_amt = c.external * rate
    return { seat_class: s, qty: c.fleets.size, internal_km: c.internal, external_km: c.external, rate, internal_amt, external_amt, subtotal: internal_amt + external_amt }
  })

  const dayMap = new Map<string, DayRow>()
  for (const t of trips) {
    const d = dayMap.get(t.date) ?? { date: t.date, perFleet: {}, internal: 0, external: 0, claimable: 0, amount: 0 }
    d.perFleet[t.fleet_no] = (d.perFleet[t.fleet_no] || 0) + tripKm(t)
    d.internal += t.internal_km
    d.external += t.external_km
    d.amount += tripKm(t) * rateFor(rates, t.seat_class)
    dayMap.set(t.date, d)
  }
  const days = [...dayMap.values()].map((d) => ({ ...d, claimable: d.internal + d.external })).sort((a, b) => a.date.localeCompare(b.date))

  // Daily breakdown by bus class: internal/external km + costed amount per class, per day.
  const presentClasses = classes.map((c) => c.seat_class)
  const rateMap = new Map<SeatClass, number>(classes.map((c) => [c.seat_class, c.rate]))
  const dcMap = new Map<string, DayClassRow>()
  for (const t of trips) {
    let row = dcMap.get(t.date)
    if (!row) {
      row = { date: t.date, byClass: {}, claimable: 0, amount: 0 }
      presentClasses.forEach((s) => { row!.byClass[s] = { internal: 0, external: 0, claimable: 0, amount: 0 } })
      dcMap.set(t.date, row)
    }
    const cell = row.byClass[t.seat_class]
    if (!cell) continue // legacy/unknown seat class (not in the current rate bands) — skip
    cell.internal += t.internal_km
    cell.external += t.external_km
  }
  for (const row of dcMap.values()) {
    presentClasses.forEach((s) => {
      const cell = row.byClass[s]!
      const rate = rateMap.get(s) ?? 0
      cell.claimable = cell.internal + cell.external
      cell.amount = cell.claimable * rate
      row.claimable += cell.claimable
      row.amount += cell.amount
    })
  }
  const dailyByClass = [...dcMap.values()].sort((a, b) => a.date.localeCompare(b.date))

  const internal_km = classes.reduce((s, c) => s + c.internal_km, 0)
  const external_km = classes.reduce((s, c) => s + c.external_km, 0)
  const subtotal = classes.reduce((s, c) => s + c.subtotal, 0)
  const vat = subtotal * (rates.vat_pct / 100)
  return {
    fleets, classes, days, dailyByClass,
    internal_km, external_km, total_km: internal_km + external_km,
    subtotal, vat, total: subtotal + vat, vat_pct: rates.vat_pct,
    hasInternal: internal_km > 0,
  }
}

// ── Per-vehicle movement sheet ─────────────────────────────────────────
export interface VehicleDay {
  date: string
  shifts: Partial<Record<Shift, { route: string; internal: number; external: number }>>
  internal: number
  external: number
  total: number
}
export interface VehicleSheet {
  days: VehicleDay[]
  internal: number
  external: number
  total: number
}
export function vehicleSheet(trips: MileageTrip[], fleet_no: string): VehicleSheet {
  const ts = trips.filter((t) => t.fleet_no === fleet_no)
  const dayMap = new Map<string, VehicleDay>()
  for (const t of ts) {
    const d = dayMap.get(t.date) ?? { date: t.date, shifts: {}, internal: 0, external: 0, total: 0 }
    // Several trips can share a shift on the same day. Combine them so the row's
    // arithmetic adds up: join the routes with " / " (skipping duplicates) and
    // sum the internal & external kilometres, rather than overwriting the cell.
    const cur = d.shifts[t.shift]
    if (cur) {
      if (t.route && !cur.route.split(' / ').includes(t.route)) cur.route = [cur.route, t.route].filter(Boolean).join(' / ')
      cur.internal += t.internal_km
      cur.external += t.external_km
    } else {
      d.shifts[t.shift] = { route: t.route, internal: t.internal_km, external: t.external_km }
    }
    d.internal += t.internal_km
    d.external += t.external_km
    d.total += tripKm(t)
    dayMap.set(t.date, d)
  }
  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  return {
    days,
    internal: days.reduce((s, d) => s + d.internal, 0),
    external: days.reduce((s, d) => s + d.external, 0),
    total: days.reduce((s, d) => s + d.total, 0),
  }
}
