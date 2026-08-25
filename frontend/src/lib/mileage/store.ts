import { useMemo, useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import type { BranchCode } from '@/lib/roles'
import type { Audited } from '@/lib/operations/types'
import {
  type MileageTrip, type MileageTripInput, type MileageRoute, type MileageRates, type Signatories,
  type SeatClass, type Shift, DEFAULT_RATES, DEFAULT_SIGNATORIES,
} from './types'
import { TRIDENT_BUSES, JUNE_WEEKDAYS, type DemoBus } from '@/lib/demo/buses'
import { createSyncTable, createSyncConfig } from '@/lib/supabase/syncTable'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mil_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}
const stampNow = () => new Date().toISOString()
const who = () => getActor().name
type Input<T extends Audited> = Omit<T, keyof Audited> & Partial<Pick<T, 'id'>>

function makeStore<T extends Audited>(key: string, seed: T[]) {
  const { load, commit, subscribe } = createSyncTable<T>({ table: key.replace(/^inzu_/, ''), lsKey: key, seed })
  return {
    list: () => load(),
    add(data: Input<T>): T {
      const now = stampNow()
      // A caller may pass a stable id (the catalogue heal does, so re-adding is
      // an idempotent upsert rather than a duplicate); otherwise one is minted.
      const item = { ...(data as object), id: data.id ?? newId(), created_by: who(), created_at: now, updated_by: who(), updated_at: now } as T
      commit([...load(), item]); return item
    },
    bulkAdd(items: Input<T>[]): T[] {
      const now = stampNow()
      const created = items.map((d) => ({ ...(d as object), id: newId(), created_by: who(), created_at: now, updated_by: who(), updated_at: now } as T))
      commit([...load(), ...created]); return created
    },
    update(id: string, patch: Partial<T>) { commit(load().map((x) => (x.id === id ? { ...x, ...patch, id: x.id, updated_by: who(), updated_at: stampNow() } : x))) },
    remove(id: string) { commit(load().filter((x) => x.id !== id)) },
    /** Delete many rows in ONE commit — a bulk clear must not race itself row by row. */
    removeMany(ids: string[]) {
      if (!ids.length) return
      const gone = new Set(ids)
      commit(load().filter((x) => !gone.has(x.id)))
    },
    subscribe,
    snapshot: () => load(),
  }
}

const A = '2026-01-01T00:00:00.000Z'
const audit = { created_by: 'System (seed)', created_at: A, updated_by: 'System (seed)', updated_at: A }

// ── Route catalogue seed (per project; internal/external split) ────────
function rt(id: string, project: string, name: string, internal: number, external: number): MileageRoute {
  return { id, branch: 'trident', project, name, internal_km: internal, external_km: external, ...audit }
}
const ROUTE_SEED: MileageRoute[] = [
  // Enterprise — buses cross the mine gate, so most runs split internal/external
  rt('MR-E1', 'Enterprise', 'Resettlement - Housing', 120, 70),
  rt('MR-E2', 'Enterprise', 'Resettlement - Housing/Housing', 120, 60),
  rt('MR-E3', 'Enterprise', 'Main Gate - Enterprise x2', 150, 0),
  rt('MR-E4', 'Enterprise', 'Kisasa - Main Gate x2', 0, 160),
  rt('MR-E5', 'Enterprise', 'Lumwana East - Main Gate x2', 0, 200),
  rt('MR-E6', 'Enterprise', 'Enterprise - Main Gate x2', 130, 40),
  rt('MR-E7', 'Enterprise', 'Holy Family - Main Gate x2', 0, 180),
  // Sentinel — external-only buses (internal always 0)
  rt('MR-S1', 'Sentinel', 'Lumwana East - Main Gate x2', 0, 200),
  rt('MR-S2', 'Sentinel', 'Kisasa - Main Gate x2', 0, 160),
  rt('MR-S3', 'Sentinel', 'Main Gate Shuttle x3', 0, 300),
  rt('MR-S4', 'Sentinel', 'Holy Family/Lumwana - Main Gate', 0, 220),
]

// ── Trip seed (June 2026, mirrors the per-vehicle movement sheets) ─────
function tp(project: string, date: string, fleet: string, reg: string, seat: SeatClass, shift: Shift, route: string, internal: number, external: number): MileageTrip {
  return { id: newId(), branch: 'trident', project, date, fleet_no: fleet, vehicle_reg: reg, seat_class: seat, shift, route, internal_km: internal, external_km: external, ...audit }
}

// Split a bus's daily paid km into shifts (internal + external) for the movement log.
function shiftsFor(b: DemoBus): { shift: Shift; route: string; internal: number; external: number }[] {
  const paid = Math.round(b.dailyKm * b.paidFrac)
  const internal = Math.round(paid * b.internalShare)
  const external = paid - internal
  if (b.project === 'Sentinel') {
    const e1 = Math.round(external * 0.4), e2 = Math.round(external * 0.3)
    return [
      { shift: 'Morning', route: 'Lumwana East - Main Gate x2', internal: 0, external: e1 },
      { shift: 'Afternoon', route: 'Kisasa - Main Gate x2', internal: 0, external: e2 },
      { shift: 'Evening', route: 'Main Gate Shuttle x3', internal: 0, external: external - e1 - e2 },
    ]
  }
  const im = Math.round(internal * 0.5), em = Math.round(external * 0.5)
  return [
    { shift: 'Morning', route: 'Resettlement - Housing', internal: im, external: em },
    { shift: 'Afternoon', route: 'Main Gate - Enterprise x2', internal: internal - im, external: 0 },
    { shift: 'Evening', route: 'Kisasa - Main Gate x2', internal: 0, external: external - em },
  ]
}
const TRIP_SEED: MileageTrip[] = TRIDENT_BUSES.flatMap((b) =>
  JUNE_WEEKDAYS.flatMap((d) => shiftsFor(b).map((s) => tp(b.project, d, b.fleet, b.reg, b.seat, s.shift, s.route, s.internal, s.external))),
)

export const tripsStore = makeStore<MileageTrip>('inzu_mileage_trips', TRIP_SEED)
export const mileageRoutesStore = makeStore<MileageRoute>('inzu_mileage_routes', ROUTE_SEED)

export const useMileageTrips = () => useSyncExternalStore(tripsStore.subscribe, tripsStore.snapshot, tripsStore.snapshot)
export const useMileageRoutes = () => useSyncExternalStore(mileageRoutesStore.subscribe, mileageRoutesStore.snapshot, mileageRoutesStore.snapshot)

/** Edit a trip, stamping who/when (drives the "edited" tag). */
export function editTrip(id: string, patch: Partial<MileageTrip>) {
  tripsStore.update(id, { ...patch, edited_by: getActor().name, edited_at: new Date().toISOString() })
}

// ── Billing rates (per branch) ─────────────────────────────────────────
const ratesCfg = createSyncConfig<Record<string, MileageRates>>({ key: 'mileage_rates', lsKey: 'inzu_mileage_rates', default: {} })
export function getMileageRates(branch: BranchCode): MileageRates {
  return ratesCfg.get()[branch] ?? DEFAULT_RATES
}
export function setMileageRates(branch: BranchCode, rates: MileageRates) {
  ratesCfg.set({ ...ratesCfg.get(), [branch]: rates })
}
export function useMileageRates(branch: BranchCode): MileageRates {
  return useSyncExternalStore(ratesCfg.subscribe, () => getMileageRates(branch), () => getMileageRates(branch))
}

// ── Monthly billing rates (per branch, per month, tracked) ─────────────
// Rates are set FOR a month and carry forward until changed, so the billing
// summary for March always uses March's contract rates even after an April
// adjustment — and the history shows who changed what, when.
export interface MonthlyRates extends MileageRates { set_by: string; set_at: string }
const monthlyRatesCfg = createSyncConfig<Record<string, MonthlyRates>>({
  key: 'mileage_rates_monthly', lsKey: 'inzu_mileage_rates_monthly', default: {},
})
const rKey = (branch: string, month: string) => `${branch}:${month}`

/** Pure resolver (unit-tested): the month's own rates, else the latest earlier
 *  month's (carry-forward), else the legacy per-branch rates, else defaults. */
export function resolveRates(
  monthly: Record<string, MonthlyRates>,
  legacy: Record<string, MileageRates>,
  branch: BranchCode,
  month: string,
): MileageRates {
  const exact = monthly[rKey(branch, month)]
  if (exact) return exact
  const prior = Object.keys(monthly)
    .filter((k) => k.startsWith(branch + ':') && k.slice(branch.length + 1) < month)
    .sort()
    .pop()
  if (prior) return monthly[prior]
  return legacy[branch] ?? DEFAULT_RATES
}

export function mileageRatesFor(branch: BranchCode, month: string): MileageRates {
  return resolveRates(monthlyRatesCfg.get(), ratesCfg.get(), branch, month)
}
export function setMonthlyRates(branch: BranchCode, month: string, rates: MileageRates) {
  monthlyRatesCfg.set({
    ...monthlyRatesCfg.get(),
    [rKey(branch, month)]: { rate60: rates.rate60, rate40: rates.rate40, rate28: rates.rate28, vat_pct: rates.vat_pct, set_by: getActor().name, set_at: new Date().toISOString() },
  })
}
export function useMileageRatesFor(branch: BranchCode, month: string): MileageRates {
  const monthly = useSyncExternalStore(monthlyRatesCfg.subscribe, monthlyRatesCfg.get, monthlyRatesCfg.get)
  const legacy = useSyncExternalStore(ratesCfg.subscribe, ratesCfg.get, ratesCfg.get)
  return useMemo(() => resolveRates(monthly, legacy, branch, month), [monthly, legacy, branch, month])
}
/**
 * Both rate maps, reactive — for month-by-month tables that need to resolve a
 * run of months in one pass (pair with the pure `resolveRates`).
 */
export function useMileageRateMaps(): { monthly: Record<string, MonthlyRates>; legacy: Record<string, MileageRates> } {
  const monthly = useSyncExternalStore(monthlyRatesCfg.subscribe, monthlyRatesCfg.get, monthlyRatesCfg.get)
  const legacy = useSyncExternalStore(ratesCfg.subscribe, ratesCfg.get, ratesCfg.get)
  return useMemo(() => ({ monthly, legacy }), [monthly, legacy])
}

/** Every explicit rate change for a branch, newest first — the audit trail. */
export function useMileageRateHistory(branch: BranchCode): { month: string; rates: MonthlyRates }[] {
  const monthly = useSyncExternalStore(monthlyRatesCfg.subscribe, monthlyRatesCfg.get, monthlyRatesCfg.get)
  return useMemo(
    () => Object.entries(monthly)
      .filter(([k]) => k.startsWith(branch + ':'))
      .map(([k, rates]) => ({ month: k.slice(branch.length + 1), rates }))
      .sort((a, b) => b.month.localeCompare(a.month)),
    [monthly, branch],
  )
}

// ── Signatories (per branch:project) ───────────────────────────────────
const signKey = (branch: string, project: string) => `${branch}:${project}`
const SIGN_SEED: Record<string, Signatories> = {
  'trident:Enterprise': { inzu_prepared: 'Taizya Kasitu', inzu_checked: 'James Nsalamba', inzu_authorised: 'Chibwe Kasanda', inzu_approved: 'Shaft Mbongu', fqm_checked: 'Anna Banda', fqm_approved: 'Dominica Spivey' },
  'trident:Sentinel': { inzu_prepared: 'Taizya Kasitu', inzu_checked: 'James Nsalamba', inzu_authorised: 'Chibwe Kasanda', inzu_approved: 'Shaft Mbongu', fqm_checked: 'Anna Banda', fqm_approved: 'Dominica Spivey' },
}
const signCfg = createSyncConfig<Record<string, Signatories>>({ key: 'mileage_signatories', lsKey: 'inzu_mileage_signatories', default: SIGN_SEED })
export function getSignatories(branch: string, project: string): Signatories {
  return signCfg.get()[signKey(branch, project)] ?? DEFAULT_SIGNATORIES
}
export function setSignatories(branch: string, project: string, s: Signatories) {
  signCfg.set({ ...signCfg.get(), [signKey(branch, project)]: s })
}
export function useSignatories(branch: string, project: string): Signatories {
  return useSyncExternalStore(signCfg.subscribe, () => getSignatories(branch, project), () => getSignatories(branch, project))
}

export type { MileageTripInput }
