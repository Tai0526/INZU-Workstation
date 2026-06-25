import type { BranchCode } from '@/lib/roles'
import type { Audited } from '@/lib/operations/types'

// Descriptive tank levels recorded at fuelling — full → empty, with the finer
// quarter steps so attendants can record exactly what the gauge shows.
export const FUEL_LEVELS = [
  'Full',
  'Above three-quarters',
  'Three-quarters',
  'Above half',
  'Half tank',
  'Below half',
  'Slightly above quarter',
  'Quarter tank',
  'Below quarter',
  'Reserve',
  'Empty',
]

// ── Per-trip fuel issuance (the detailed, per-vehicle log) ─────────────
export interface FuelIssuance extends Audited {
  branch: BranchCode
  date: string // yyyy-mm-dd
  fleet_no: string
  vehicle_reg: string
  driver: string
  fuel_attendant: string
  trip_number: number | null
  route: string
  opening_fuel_level: string
  closing_fuel_level: string
  opening_mileage: number
  closing_mileage: number // 0 / ≤ opening = still open (closed by the next refuel)
  liters_given: number
  notes: string
  // set only on a genuine user edit (not on creation or auto-close)
  edited_by?: string
  edited_at?: string
}
export type IssuanceInput = Omit<FuelIssuance, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

/** Open = no closing reading yet (the next refuel for this vehicle will set it). */
export function isOpen(i: FuelIssuance): boolean {
  return !i.closing_mileage || i.closing_mileage <= i.opening_mileage
}
export function kmMoved(i: FuelIssuance): number {
  return isOpen(i) ? 0 : i.closing_mileage - i.opening_mileage
}
export function kmPerLitre(i: FuelIssuance): number | null {
  return !isOpen(i) && i.liters_given > 0 ? kmMoved(i) / i.liters_given : null
}

// ── Fuel received into the depot tank ──────────────────────────────────
export interface FuelReceipt extends Audited {
  branch: BranchCode
  date: string
  litres: number
  supplier: string
  unit_cost_usd: number | null
  notes: string
  delivery_note_file?: string // IndexedDB file id for the scanned delivery note
}
export type ReceiptInput = Omit<FuelReceipt, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

// ── Non-fleet fuel draws from the depot ────────────────────────────────
// `generator` = the site genset (no approval needed).
// `visitor`   = a non-fleet vehicle authorised by Ops/Asst Ops (director's car,
//               police, community, etc.) — needs authorisation before it counts.
export type DrawKind = 'generator' | 'visitor'
export const DRAW_LABEL: Record<DrawKind, string> = { generator: 'Generator', visitor: 'Authorised vehicle' }
export type DrawStatus = 'approved' | 'pending' | 'rejected'
export interface GenFuel extends Audited {
  branch: BranchCode
  date: string
  kind: DrawKind
  recipient: string // generator name, or who the vehicle belongs to (Director, Police, Community…)
  vehicle_reg: string // plate of the non-fleet vehicle (blank for generators)
  litres: number
  notes: string
  status: DrawStatus // generator is auto-approved; authorised vehicles need Ops sign-off
  authorized_by: string
  authorized_at: string
}
export type GenFuelInput = Omit<GenFuel, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>
/** Only approved draws (all generators + authorized visitor fuel) affect the tank. */
export const isApprovedDraw = (g: GenFuel) => g.status === 'approved'

// ── Depot / tank configuration (per branch) ────────────────────────────
export interface FuelConfig {
  opening_stock: number // litres in tank at the baseline
  dead_stock: number // unusable bottom-of-tank reserve (excluded from "available")
  capacity?: number // physical tank capacity (L); 0/undefined = auto (opening + received)
}
export const DEFAULT_FUEL_CONFIG: FuelConfig = { opening_stock: 46000, dead_stock: 2000, capacity: 0 }

// ── Monthly rates (per branch, per month) ──────────────────────────────
// Diesel pump price (ZMW/litre) from ERB Zambia; USD↔ZMW from Bank of Zambia.
export interface FuelRate {
  diesel_zmw: number // ERB diesel price per litre, in Kwacha
  fx_zmw_per_usd: number // BoZ mid rate, Kwacha per 1 USD
  source: string // where it came from
  updated_at: string // ISO
}
export const DEFAULT_FUEL_RATE: FuelRate = { diesel_zmw: 32.13, fx_zmw_per_usd: 27, source: 'Default', updated_at: '2026-01-01T00:00:00.000Z' }

// ── Currency ───────────────────────────────────────────────────────────
export type Currency = 'USD' | 'ZMW'
export const CURRENCY_SYMBOL: Record<Currency, string> = { USD: '$', ZMW: 'K' }
/** Price per litre in the chosen currency, from the month's ERB price + BoZ rate. */
export function pricePerLitre(rate: FuelRate, cur: Currency): number {
  return cur === 'ZMW' ? rate.diesel_zmw : rate.fx_zmw_per_usd > 0 ? rate.diesel_zmw / rate.fx_zmw_per_usd : 0
}
export function money(amount: number, cur: Currency): string {
  return `${CURRENCY_SYMBOL[cur]}${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

// ── Stock running balance ──────────────────────────────────────────────
export interface StockState {
  current: number
  usable: number // current - dead stock
  totalReceived: number
  totalIssued: number
  avgDailyUsage: number
  daysLeft: number | null
}

const DAY = 86_400_000
export function computeStock(issuances: FuelIssuance[], receipts: FuelReceipt[], cfg: FuelConfig, extraIssued = 0): StockState {
  const totalIssued = issuances.reduce((s, i) => s + i.liters_given, 0) + extraIssued // extraIssued = generator draws etc.
  const totalReceived = receipts.reduce((s, r) => s + r.litres, 0)
  const current = cfg.opening_stock + totalReceived - totalIssued
  const usable = current - cfg.dead_stock // real available fuel (excludes dead stock)

  // Rolling 30-day average usage, anchored at the most recent issuance date.
  const dates = issuances.map((i) => new Date(i.date + 'T00:00:00').getTime()).filter((t) => !isNaN(t))
  const end = dates.length ? Math.max(...dates) : Date.now()
  const start = end - 30 * DAY
  const rolling = issuances.reduce((s, i) => {
    const t = new Date(i.date + 'T00:00:00').getTime()
    return t > start && t <= end ? s + i.liters_given : s
  }, 0)
  const avgDailyUsage = rolling / 30
  const daysLeft = avgDailyUsage > 0 ? Math.max(0, usable / avgDailyUsage) : null
  return { current, usable, totalReceived, totalIssued, avgDailyUsage, daysLeft }
}

// ── Per-vehicle summary aggregation ────────────────────────────────────
export interface VehicleSummary { fleet_no: string; vehicle_reg: string; litres: number; km: number; kmPerL: number | null }

export function summariseByVehicle(issuances: FuelIssuance[]): VehicleSummary[] {
  const map = new Map<string, VehicleSummary>()
  for (const i of issuances) {
    const key = i.fleet_no || i.vehicle_reg
    const cur = map.get(key) ?? { fleet_no: i.fleet_no, vehicle_reg: i.vehicle_reg, litres: 0, km: 0, kmPerL: null }
    cur.litres += i.liters_given
    cur.km += kmMoved(i)
    map.set(key, cur)
  }
  return [...map.values()]
    .map((v) => ({ ...v, kmPerL: v.litres > 0 ? v.km / v.litres : null }))
    .sort((a, b) => b.litres - a.litres)
}
