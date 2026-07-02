import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import type { Audited } from '@/lib/operations/types'
import { type FuelIssuance, type IssuanceInput, type FuelReceipt, type FuelConfig, type FuelRate, type GenFuel, isOpen, DEFAULT_FUEL_CONFIG, DEFAULT_FUEL_RATE, FUEL_LEVELS } from './types'
import { TRIDENT_BUSES, REFUEL_DATES } from '@/lib/demo/buses'
import { createSyncTable, createSyncConfig } from '@/lib/supabase/syncTable'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `f_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}
const stampNow = () => new Date().toISOString()
const who = () => getActor().name
type Input<T extends Audited> = Omit<T, keyof Audited>

function makeStore<T extends Audited>(key: string, seed: T[]) {
  const { load, commit, subscribe } = createSyncTable<T>({ table: key.replace(/^inzu_/, ''), lsKey: key, seed })
  return {
    list: () => load(),
    add(data: Input<T>): T {
      const now = stampNow()
      const item = { ...(data as object), id: newId(), created_by: who(), created_at: now, updated_by: who(), updated_at: now } as T
      commit([...load(), item]); return item
    },
    bulkAdd(items: Input<T>[]): T[] {
      const now = stampNow()
      const created = items.map((d) => ({ ...(d as object), id: newId(), created_by: who(), created_at: now, updated_by: who(), updated_at: now } as T))
      commit([...load(), ...created]); return created
    },
    update(id: string, patch: Partial<T>) { commit(load().map((x) => (x.id === id ? { ...x, ...patch, id: x.id, updated_by: who(), updated_at: stampNow() } : x))) },
    remove(id: string) { commit(load().filter((x) => x.id !== id)) },
    subscribe,
    snapshot: () => load(),
  }
}

const A = '2026-01-01T00:00:00.000Z'
const audit = { created_by: 'System (seed)', created_at: A, updated_by: 'System (seed)', updated_at: A }

function iss(id: string, date: string, fleet: string, reg: string, driver: string, attendant: string, trip: number, route: string, open: string, close: string, om: number, cm: number, litres: number): FuelIssuance {
  return { id, branch: 'trident', date, fleet_no: fleet, vehicle_reg: reg, driver, fuel_attendant: attendant, trip_number: trip, route, opening_fuel_level: open, closing_fuel_level: close, opening_mileage: om, closing_mileage: cm, liters_given: litres, notes: '', ...audit }
}

// June 2026 — weekly refuels per bus (each refuel's odometer closes the previous
// leg). The closed legs give the real distance driven between fills (10k–20k/month),
// which the Overview compares against the paid (billable) mileage. Built from the
// shared fleet roster so buses/regs match the Vehicle Register and Mileage.
let _fid = 0
const ISSUANCE_SEED: FuelIssuance[] = TRIDENT_BUSES.flatMap((b) => {
  const legKm = Math.round(b.dailyKm * 5.5) // one week's driving between fills
  const econ = b.seat === '28' ? 6 : 3 // km per litre
  const litres = Math.round(legKm / econ)
  const route = b.project === 'Sentinel' ? 'Lumwana' : 'Kisasa'
  return REFUEL_DATES.map((date, idx) => {
    const isLast = idx === REFUEL_DATES.length - 1
    const open = b.startOdo + idx * legKm
    const close = isLast ? 0 : b.startOdo + (idx + 1) * legKm // last one stays open
    return iss(`FI${++_fid}`, date, b.fleet, b.reg, b.driver, 'Asford', 2, route, 'Below half tank', 'Full', open, close, litres)
  })
})

// Weekly bulk deliveries into the depot — sized to cover a full fleet's monthly burn.
const RECEIPT_SEED: FuelReceipt[] = REFUEL_DATES.map((date, i) => (
  { id: `FR${i + 1}`, branch: 'trident', date, litres: 60000, supplier: 'Puma Energy', unit_cost_usd: 1.19, notes: 'Weekly bulk delivery', ...audit }
))

// Non-vehicle depot draws — generators (auto-approved) and visitor fuel (needs Ops authorization).
const GENFUEL_SEED: GenFuel[] = [
  { id: 'GF1', branch: 'trident', date: '2026-06-03', kind: 'generator', recipient: 'Generator 1', vehicle_reg: '', litres: 200, notes: 'Site genset top-up', status: 'approved', authorized_by: 'System (seed)', authorized_at: A, ...audit },
  { id: 'GF2', branch: 'trident', date: '2026-06-17', kind: 'generator', recipient: 'Generator 1', vehicle_reg: '', litres: 220, notes: '', status: 'approved', authorized_by: 'System (seed)', authorized_at: A, ...audit },
  { id: 'GF3', branch: 'trident', date: '2026-06-12', kind: 'visitor', recipient: "Director's car", vehicle_reg: 'ABZ 1234', litres: 60, notes: 'Authorised by Ops', status: 'approved', authorized_by: 'Chibwe Kasanda', authorized_at: A, ...audit },
  { id: 'GF4', branch: 'trident', date: '2026-06-19', kind: 'visitor', recipient: 'ZP Police', vehicle_reg: 'GRZ 5567', litres: 40, notes: 'Awaiting sign-off', status: 'pending', authorized_by: '', authorized_at: '', ...audit },
]

export const issuancesStore = makeStore<FuelIssuance>('inzu_fuel_issuances', ISSUANCE_SEED)
export const receiptsStore = makeStore<FuelReceipt>('inzu_fuel_receipts', RECEIPT_SEED)
export const genFuelStore = makeStore<GenFuel>('inzu_fuel_generator', GENFUEL_SEED)

export const useIssuances = () => useSyncExternalStore(issuancesStore.subscribe, issuancesStore.snapshot, issuancesStore.snapshot)
export const useReceipts = () => useSyncExternalStore(receiptsStore.subscribe, receiptsStore.snapshot, receiptsStore.snapshot)
export const useGenFuel = () => useSyncExternalStore(genFuelStore.subscribe, genFuelStore.snapshot, genFuelStore.snapshot)

/** Ops / Asst-Ops authorize (or reject) a visitor fuel draw. */
export function authorizeDraw(id: string, approve: boolean) {
  genFuelStore.update(id, { status: approve ? 'approved' : 'rejected', authorized_by: getActor().name, authorized_at: new Date().toISOString() })
}

/**
 * Record a refuel: you only enter the odometer NOW (opening). The previous
 * still-open issuance for the same vehicle is closed with this reading
 * (its closing = this opening), and a new open issuance is created.
 */
export function recordRefuel(input: IssuanceInput) {
  const prevOpen = issuancesStore.list()
    .filter((i) => i.branch === input.branch && i.fleet_no === input.fleet_no && isOpen(i))
    .sort((a, b) => b.opening_mileage - a.opening_mileage)[0]
  if (prevOpen && input.opening_mileage > prevOpen.opening_mileage) {
    // Only the CLOSING MILEAGE is deferred to the next refuel. Both fuel
    // levels are captured at the refuel itself, so we never touch them here.
    // (Not a user edit, so don't stamp edited_*.)
    issuancesStore.update(prevOpen.id, { closing_mileage: input.opening_mileage })
  }
  issuancesStore.add({ ...input, closing_mileage: 0 }) // open on mileage; both levels kept from input
}

/** Edit an issuance and stamp who changed it + when (drives the "edited" tag). */
export function editIssuance(id: string, patch: Partial<FuelIssuance>) {
  issuancesStore.update(id, { ...patch, edited_by: getActor().name, edited_at: new Date().toISOString() })
}

// ── Config (per branch) ────────────────────────────────────────────────
const fuelCfg = createSyncConfig<Record<string, FuelConfig>>({ key: 'fuel_config', lsKey: 'inzu_fuel_config', default: {} })
export function getFuelConfig(branch: string): FuelConfig {
  return fuelCfg.get()[branch] ?? DEFAULT_FUEL_CONFIG
}
export function setFuelConfig(branch: string, cfg: FuelConfig) {
  fuelCfg.set({ ...fuelCfg.get(), [branch]: cfg })
}
export function useFuelConfig(branch: string): FuelConfig {
  return useSyncExternalStore(fuelCfg.subscribe, () => getFuelConfig(branch), () => getFuelConfig(branch))
}

// ── Tank reading levels (editable) ─────────────────────────────────────
// The before/after gauge readings offered in every refuel form. Seeded from the
// built-in ladder but fully editable (add / remove / reorder) and stored in
// app_config, so changes sync everywhere and need no DB migration.
const fuelLevelsCfg = createSyncConfig<string[]>({
  key: 'fuel_tank_levels', lsKey: 'inzu_fuel_tank_levels', default: FUEL_LEVELS,
  merge: (saved) => (Array.isArray(saved) && saved.length ? saved : FUEL_LEVELS),
})
export const fuelLevelsStore = {
  get: () => fuelLevelsCfg.get(),
  subscribe: fuelLevelsCfg.subscribe,
  set: (levels: string[]) => fuelLevelsCfg.set(levels),
  add(level: string) {
    const v = level.trim()
    if (!v) return
    const cur = fuelLevelsCfg.get()
    if (cur.some((l) => l.toLowerCase() === v.toLowerCase())) return // no duplicates
    fuelLevelsCfg.set([...cur, v])
  },
  remove: (level: string) => fuelLevelsCfg.set(fuelLevelsCfg.get().filter((l) => l !== level)),
  move(level: string, dir: -1 | 1) {
    const cur = [...fuelLevelsCfg.get()]
    const i = cur.indexOf(level)
    const j = i + dir
    if (i < 0 || j < 0 || j >= cur.length) return
    const tmp = cur[i]; cur[i] = cur[j]; cur[j] = tmp
    fuelLevelsCfg.set(cur)
  },
  reset: () => fuelLevelsCfg.set([...FUEL_LEVELS]),
}
export const useFuelLevels = () => useSyncExternalStore(fuelLevelsCfg.subscribe, fuelLevelsCfg.get, fuelLevelsCfg.get)

// ── Fuel route catalogue (per branch) — fuel-only, separate from Mileage ─
// Fuel controllers manage these routes for the refuel forms. Stored in app_config
// (keyed by branch) so it needs no DB migration and never touches existing
// issuance records — their `route` is plain text and stays exactly as entered.
const fuelRoutesCfg = createSyncConfig<Record<string, string[]>>({ key: 'fuel_routes', lsKey: 'inzu_fuel_routes', default: {} })
export function getFuelRoutes(branch: string): string[] {
  return fuelRoutesCfg.get()[branch] ?? []
}
export const fuelRoutesStore = {
  get: getFuelRoutes,
  subscribe: fuelRoutesCfg.subscribe,
  add(branch: string, name: string) {
    const v = name.trim()
    if (!v) return
    const all = fuelRoutesCfg.get()
    const cur = all[branch] ?? []
    if (cur.some((r) => r.toLowerCase() === v.toLowerCase())) return // no duplicates
    fuelRoutesCfg.set({ ...all, [branch]: [...cur, v].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) })
  },
  remove(branch: string, name: string) {
    const all = fuelRoutesCfg.get()
    fuelRoutesCfg.set({ ...all, [branch]: (all[branch] ?? []).filter((r) => r !== name) })
  },
}
export function useFuelRoutes(branch: string): string[] {
  return useSyncExternalStore(fuelRoutesCfg.subscribe, () => getFuelRoutes(branch), () => getFuelRoutes(branch))
}

// ── Monthly rates (per branch:YYYY-MM) — ERB diesel price + BoZ FX ──────
const rateKey = (branch: string, ym: string) => `${branch}:${ym}`
const RATE_SEED: Record<string, FuelRate> = {
  'trident:2026-02': { diesel_zmw: 31.84, fx_zmw_per_usd: 26.6, source: 'ERB + Bank of Zambia', updated_at: '2026-02-01T08:00:00.000Z' },
  'trident:2026-03': { diesel_zmw: 32.13, fx_zmw_per_usd: 27.0, source: 'ERB + Bank of Zambia', updated_at: '2026-03-01T08:00:00.000Z' },
  'trident:2026-04': { diesel_zmw: 33.05, fx_zmw_per_usd: 27.4, source: 'ERB + Bank of Zambia', updated_at: '2026-04-01T08:00:00.000Z' },
  'trident:2026-06': { diesel_zmw: 33.50, fx_zmw_per_usd: 27.5, source: 'ERB + Bank of Zambia', updated_at: '2026-06-01T08:00:00.000Z' },
}
const ratesCfg = createSyncConfig<Record<string, FuelRate>>({ key: 'fuel_rates', lsKey: 'inzu_fuel_rates', default: RATE_SEED })

/**
 * The month's rate. If a month hasn't been set yet, carry forward the most recent
 * earlier month for that branch (so a new month starts from the last known figures
 * until they're updated). Falls back to the built-in default if there's nothing.
 */
export function getFuelRate(branch: string, ym: string): FuelRate {
  const all = ratesCfg.get()
  const exact = all[rateKey(branch, ym)]
  if (exact) return exact
  const prefix = `${branch}:`
  const prior = Object.keys(all).filter((k) => k.startsWith(prefix) && k.slice(prefix.length) <= ym).sort()
  return prior.length ? all[prior[prior.length - 1]] : DEFAULT_FUEL_RATE
}
export function setFuelRate(branch: string, ym: string, rate: FuelRate) {
  ratesCfg.set({ ...ratesCfg.get(), [rateKey(branch, ym)]: rate })
}
export function useFuelRate(branch: string, ym: string): FuelRate {
  return useSyncExternalStore(ratesCfg.subscribe, () => getFuelRate(branch, ym), () => getFuelRate(branch, ym))
}

/**
 * Live USD→ZMW from a free, CORS-enabled FX feed (market/interbank rate — very
 * close to, but not identical to, the Bank of Zambia official mid-rate, which has
 * no public API). The diesel pump price (ERB) is not published as a feed the app
 * can fetch, so it's entered/confirmed manually each month.
 */
export async function fetchLiveUsdZmw(): Promise<number> {
  const res = await fetch('https://open.er-api.com/v6/latest/USD', { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`Rate service error (${res.status})`)
  const data = await res.json()
  const zmw = data?.rates?.ZMW
  if (typeof zmw !== 'number' || !isFinite(zmw)) throw new Error('USD→ZMW not available right now')
  return +zmw.toFixed(2)
}
