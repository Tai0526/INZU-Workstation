import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import type { BranchCode } from '@/lib/roles'
import type { Audited } from '@/lib/operations/types'
import {
  type MileageTrip, type MileageTripInput, type MileageRoute, type MileageRates, type Signatories,
  type SeatClass, type Shift, DEFAULT_RATES, DEFAULT_SIGNATORIES,
} from './types'
import { TRIDENT_BUSES, JUNE_WEEKDAYS, type DemoBus } from '@/lib/demo/buses'
import { registerCrossTabSync } from '@/lib/storage/sync'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mil_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}
const stampNow = () => new Date().toISOString()
const who = () => getActor().name
type Input<T extends Audited> = Omit<T, keyof Audited>

function makeStore<T extends Audited>(key: string, seed: T[]) {
  let cache: T[] | null = null
  const listeners = new Set<() => void>()
  function load(): T[] {
    if (cache) return cache
    try { const raw = localStorage.getItem(key); cache = raw ? (JSON.parse(raw) as T[]) : seed } catch { cache = seed }
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(cache))
    return cache!
  }
  function commit(next: T[]) { cache = next; localStorage.setItem(key, JSON.stringify(next)); listeners.forEach((l) => l()) }
  registerCrossTabSync(key, () => { cache = null; load(); listeners.forEach((l) => l()) })
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
    subscribe(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) },
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
const RATES_KEY = 'inzu_mileage_rates'
let ratesCache: Record<string, MileageRates> | null = null
const ratesListeners = new Set<() => void>()
function loadRates(): Record<string, MileageRates> {
  if (ratesCache) return ratesCache
  try { const raw = localStorage.getItem(RATES_KEY); ratesCache = raw ? JSON.parse(raw) : {} } catch { ratesCache = {} }
  return ratesCache!
}
export function getMileageRates(branch: BranchCode): MileageRates {
  return loadRates()[branch] ?? DEFAULT_RATES
}
export function setMileageRates(branch: BranchCode, rates: MileageRates) {
  const next = { ...loadRates(), [branch]: rates }
  ratesCache = next
  localStorage.setItem(RATES_KEY, JSON.stringify(next))
  ratesListeners.forEach((l) => l())
}
export function useMileageRates(branch: BranchCode): MileageRates {
  return useSyncExternalStore(
    (cb) => { ratesListeners.add(cb); return () => ratesListeners.delete(cb) },
    () => getMileageRates(branch),
    () => getMileageRates(branch),
  )
}

// ── Signatories (per branch:project) ───────────────────────────────────
const SIGN_KEY = 'inzu_mileage_signatories'
let signCache: Record<string, Signatories> | null = null
const signListeners = new Set<() => void>()
const signKey = (branch: string, project: string) => `${branch}:${project}`
const SIGN_SEED: Record<string, Signatories> = {
  'trident:Enterprise': { inzu_prepared: 'Taizya Kasitu', inzu_checked: 'James Nsalamba', inzu_authorised: 'Chibwe Kasanda', inzu_approved: 'Shaft Mbongu', fqm_checked: 'Anna Banda', fqm_approved: 'Dominica Spivey' },
  'trident:Sentinel': { inzu_prepared: 'Taizya Kasitu', inzu_checked: 'James Nsalamba', inzu_authorised: 'Chibwe Kasanda', inzu_approved: 'Shaft Mbongu', fqm_checked: 'Anna Banda', fqm_approved: 'Dominica Spivey' },
}
function loadSign(): Record<string, Signatories> {
  if (signCache) return signCache
  try { const raw = localStorage.getItem(SIGN_KEY); signCache = raw ? JSON.parse(raw) : { ...SIGN_SEED } } catch { signCache = { ...SIGN_SEED } }
  if (!localStorage.getItem(SIGN_KEY)) localStorage.setItem(SIGN_KEY, JSON.stringify(signCache))
  return signCache!
}
export function getSignatories(branch: string, project: string): Signatories {
  return loadSign()[signKey(branch, project)] ?? DEFAULT_SIGNATORIES
}
export function setSignatories(branch: string, project: string, s: Signatories) {
  const next = { ...loadSign(), [signKey(branch, project)]: s }
  signCache = next
  localStorage.setItem(SIGN_KEY, JSON.stringify(next))
  signListeners.forEach((l) => l())
}
export function useSignatories(branch: string, project: string): Signatories {
  return useSyncExternalStore(
    (cb) => { signListeners.add(cb); return () => signListeners.delete(cb) },
    () => getSignatories(branch, project),
    () => getSignatories(branch, project),
  )
}

export type { MileageTripInput }
