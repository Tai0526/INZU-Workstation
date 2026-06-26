import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import {
  type Audited, type OpRoute, type Allocation, type MileageEntry,
  type DailyPlanTrip, type WeeklyAssignment, DEFAULT_TO_LOCATION,
} from './types'
import { createSyncTable, createSyncConfig } from '@/lib/supabase/syncTable'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `o_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}
const stampNow = () => new Date().toISOString()
const who = () => getActor().name

type Input<T extends Audited> = Omit<T, keyof Audited> & Partial<Pick<T, 'id'>>

function makeStore<T extends Audited>(key: string, seed: T[]) {
  // Supabase table name = the localStorage key without the inzu_ prefix.
  const { load, commit, subscribe } = createSyncTable<T>({ table: key.replace(/^inzu_/, ''), lsKey: key, seed })
  return {
    list: () => load(),
    add(data: Input<T>): T {
      const now = stampNow()
      const item = { ...(data as object), id: data.id ?? newId(), created_by: who(), created_at: now, updated_by: who(), updated_at: now } as T
      commit([...load(), item])
      return item
    },
    bulkAdd(items: Input<T>[]): T[] {
      const now = stampNow()
      const created = items.map((d) => ({ ...(d as object), id: newId(), created_by: who(), created_at: now, updated_by: who(), updated_at: now } as T))
      commit([...load(), ...created])
      return created
    },
    update(id: string, patch: Partial<T>) {
      commit(load().map((x) => (x.id === id ? { ...x, ...patch, id: x.id, updated_by: who(), updated_at: stampNow() } : x)))
    },
    remove(id: string) {
      commit(load().filter((x) => x.id !== id))
    },
    subscribe,
    snapshot: () => load(),
  }
}

// ── Seeds ──────────────────────────────────────────────────────────────
const A = '2026-01-01T00:00:00.000Z'
const audit = { created_by: 'System (seed)', created_at: A, updated_by: 'System (seed)', updated_at: A }

// Locations library — destinations with a reference one-way distance (drives planned km).
const ROUTE_SEED: OpRoute[] = [
  { id: 'L-T1', branch: 'trident', name: 'Kisasa', code: '', distance_km: 35, notes: '', ...audit },
  { id: 'L-T2', branch: 'trident', name: 'Pineaple', code: '', distance_km: 28, notes: '', ...audit },
  { id: 'L-T3', branch: 'trident', name: 'Lumwana', code: '', distance_km: 60, notes: '', ...audit },
  { id: 'L-T4', branch: 'trident', name: 'Musele Junction', code: '', distance_km: 42, notes: '', ...audit },
  { id: 'L-T5', branch: 'trident', name: 'Shelter', code: '', distance_km: 25, notes: '', ...audit },
  { id: 'L-T6', branch: 'trident', name: 'Housing', code: '', distance_km: 20, notes: '', ...audit },
  { id: 'L-K1', branch: 'kansanshi', name: 'Inside the Mine', code: '', distance_km: 18, notes: '', ...audit },
  { id: 'L-K2', branch: 'kansanshi', name: 'Outside the Mine', code: '', distance_km: 40, notes: '', ...audit },
]

const today = '2026-06-19'
const yday = '2026-06-18'

function al(id: string, date: string, type: Allocation['trip_type'], driver: string, fleet: string, reg: string, routeId: string, location: string, time: string, pax: number | null, km: number): Allocation {
  return { id, branch: 'trident', date, trip_type: type, driver_name: driver, fleet_no: fleet, reg_no: reg, route_id: routeId, location, departure_time: time, passengers: pax, planned_km: km, notes: '', ...audit }
}

const ALLOC_SEED: Allocation[] = [
  // Morning pickups
  al('AL1', today, 'pickup', 'Kasweka', 'INZ 226', 'BCG 4666', 'L-T4', 'Musele Junction', '04:20', 45, 42),
  al('AL2', today, 'pickup', 'Nkungamina', 'INZ 220', 'BCG 5910', 'L-T3', 'Lumwana', '04:15', null, 60),
  al('AL3', today, 'pickup', 'Pelekelo', 'INZ 131', 'BCG 5198', 'L-T1', 'Kisasa', '04:15', 40, 35),
  al('AL4', today, 'pickup', 'Njongo', 'INZ 120', 'BCG 4270', 'L-T2', 'Pineaple', '04:30', null, 28),
  al('AL5', today, 'pickup', 'Kantumoya', 'INZ 230', 'BCH 7803', 'L-T1', 'Kisasa', '04:25', 60, 35),
  al('AL6', today, 'pickup', 'Kamocha', 'INZ 121', 'BCG 4271', 'L-T6', 'Housing', '05:20', null, 20),
  // Same buses again later in the morning — multiple trips
  al('AL7', today, 'pickup', 'Kasweka', 'INZ 226', 'BCG 4666', 'L-T1', 'Kisasa', '05:40', null, 35),
  al('AL8', today, 'pickup', 'Njongo', 'INZ 120', 'BCG 4270', 'L-T2', 'Pineaple', '06:30', null, 28),
  // Evening knock-offs
  al('AL9', today, 'knockoff', 'Mbuzi', 'INZ 122', 'BCG 4272', 'L-T3', 'Lumwana', '16:20', null, 60),
  al('AL10', today, 'knockoff', 'Chilengi', 'INZ 222', 'BCG 5912', 'L-T1', 'Kisasa', '16:40', null, 35),
  al('AL11', today, 'knockoff', 'Njongo', 'INZ 120', 'BCG 4270', 'L-T2', 'Pineaple', '17:10', null, 28),
]

const MILEAGE_SEED: MileageEntry[] = [
  { id: 'M1', branch: 'kansanshi', date: yday, vehicle_id: 'INZ 101', vehicle_label: 'INZ 101', driver_id: 'INZ-D101', driver_name: 'Kelvin Mumba', actual_km: 44, status: 'approved', approved_by: 'System (seed)', approved_at: A, notes: '', ...audit },
  { id: 'M2', branch: 'kansanshi', date: yday, vehicle_id: 'INZ 102', vehicle_label: 'INZ 102', driver_id: 'INZ-D102', driver_name: 'Patrick Bwalya', actual_km: 26, status: 'pending', approved_by: '', approved_at: '', notes: 'short of plan', ...audit },
  { id: 'M3', branch: 'trident', date: yday, vehicle_id: 'INZ 121', vehicle_label: 'INZ 121', driver_id: 'INZ-D201', driver_name: 'Joseph Sakala', actual_km: 41, status: 'approved', approved_by: 'System (seed)', approved_at: A, notes: '', ...audit },
  { id: 'M4', branch: 'trident', date: yday, vehicle_id: 'INZ 127', vehicle_label: 'INZ 127', driver_id: 'INZ-D202', driver_name: 'Grace Mwila', actual_km: 22, status: 'pending', approved_by: '', approved_at: '', notes: '', ...audit },
]

export const routesStore = makeStore<OpRoute>('inzu_op_routes', ROUTE_SEED)
export const allocationsStore = makeStore<Allocation>('inzu_op_allocations', ALLOC_SEED)
export const mileageStore = makeStore<MileageEntry>('inzu_op_mileage', MILEAGE_SEED)

export const useRoutes = () => useSyncExternalStore(routesStore.subscribe, routesStore.snapshot, routesStore.snapshot)
export const useAllocations = () => useSyncExternalStore(allocationsStore.subscribe, allocationsStore.snapshot, allocationsStore.snapshot)
export const useMileage = () => useSyncExternalStore(mileageStore.subscribe, mileageStore.snapshot, mileageStore.snapshot)

// ── Daily plan + weekly driver↔vehicle assignment ───────────────────────
// Dates are computed at first load so both pages show example data "today".
const _now = new Date()
const _iso = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
function _friday(dt: Date): string { const x = new Date(dt); const back = (x.getDay() - 5 + 7) % 7; x.setDate(x.getDate() - back); return _iso(x) }
const _addDays = (iso: string, n: number): string => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return _iso(d) }
const SEED_TODAY = _iso(_now)
const SEED_THIS_FRI = _friday(_now)
const SEED_LAST_FRI = _friday(new Date(_now.getTime() - 7 * 86_400_000))

function dp(id: string, type: DailyPlanTrip['trip_type'], fleet: string, reg: string, driver: string, from: string, to: string, time: string): DailyPlanTrip {
  return { id, branch: 'trident', date: SEED_TODAY, trip_type: type, driver_name: driver, fleet_no: fleet, reg_no: reg, from_location: from, to_location: to, departure_time: time, notes: '', ...audit }
}
const DAILY_PLAN_SEED: DailyPlanTrip[] = [
  dp('DP1', 'pickup', 'INZ 226', 'BCG 4666', 'Kasweka', 'Musele Junction', DEFAULT_TO_LOCATION, '04:20'),
  dp('DP2', 'pickup', 'INZ 220', 'BCG 5910', 'Nkungamina', 'Lumwana', DEFAULT_TO_LOCATION, '04:15'),
  dp('DP3', 'pickup', 'INZ 131', 'BCG 5198', 'Pelekelo', 'Kisasa', DEFAULT_TO_LOCATION, '04:15'),
  dp('DP4', 'knockoff', 'INZ 120', 'BCG 4270', 'Njongo', DEFAULT_TO_LOCATION, 'Pineaple', '16:30'),
]

function wa(id: string, week: string, fleet: string, driverId: string, driver: string, overtime = false): WeeklyAssignment {
  return { id, branch: 'trident', week_start: week, week_end: _addDays(week, 6), fleet_no: fleet, driver_id: driverId, driver_name: driver, overtime, ...audit }
}
const WEEKLY_SEED: WeeklyAssignment[] = [
  wa('WA1', SEED_THIS_FRI, 'INZ 121', 'INZ-D201', 'Joseph Sakala'),
  wa('WA2', SEED_THIS_FRI, 'INZ 127', 'INZ-D202', 'Grace Mwila'),
  // Last week — surfaces as the "last week" hint on each vehicle this week.
  wa('WA3', SEED_LAST_FRI, 'INZ 121', 'INZ-D201', 'Joseph Sakala'),
  wa('WA4', SEED_LAST_FRI, 'INZ 127', 'INZ-D207', 'Peter Chibwe'),
]

export const dailyPlanStore = makeStore<DailyPlanTrip>('inzu_op_daily_plan', DAILY_PLAN_SEED)
export const weeklyAssignStore = makeStore<WeeklyAssignment>('inzu_op_weekly_assign', WEEKLY_SEED)
export const useDailyPlan = () => useSyncExternalStore(dailyPlanStore.subscribe, dailyPlanStore.snapshot, dailyPlanStore.snapshot)
export const useWeeklyAssign = () => useSyncExternalStore(weeklyAssignStore.subscribe, weeklyAssignStore.snapshot, weeklyAssignStore.snapshot)

// ── Bus-run ↔ Daily-Plan link (migration-free) ──────────────────────────
// Maps a logged allocation id → the Daily Plan trip id it fulfils. Stored in
// app_config rather than an op_allocations column, so logging a planned run
// persists regardless of whether the optional `plan_trip_id` column exists on
// the live database. (Writing an unknown column would make the upsert fail and
// the optimistic row would be reverted on the next hydrate.)
const allocPlanLinkCfg = createSyncConfig<Record<string, string>>({ key: 'alloc_plan_links', lsKey: 'inzu_alloc_plan_links', default: {} })
export const allocPlanLinks = {
  get: () => allocPlanLinkCfg.get(),
  subscribe: allocPlanLinkCfg.subscribe,
  for: (allocId: string) => allocPlanLinkCfg.get()[allocId],
  set(allocId: string, planTripId: string) { allocPlanLinkCfg.set({ ...allocPlanLinkCfg.get(), [allocId]: planTripId }) },
  clear(allocId: string) { const m = { ...allocPlanLinkCfg.get() }; delete m[allocId]; allocPlanLinkCfg.set(m) },
}
export const useAllocPlanLinks = () => useSyncExternalStore(allocPlanLinkCfg.subscribe, allocPlanLinkCfg.get, allocPlanLinkCfg.get)
