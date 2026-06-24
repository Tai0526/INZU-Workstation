import { useSyncExternalStore } from 'react'
import type { BranchCode } from '@/lib/roles'
import { getActor } from '@/lib/audit/actor'
import { type Vehicle, type VehicleInput, isAvailable } from './types'
import { TRIDENT_BUSES } from '@/lib/demo/buses'
import { documentsStore } from '@/lib/documents/store'
import { createSyncTable } from '@/lib/supabase/syncTable'

/**
 * Mock data layer for vehicles — localStorage-backed, reactive via
 * useSyncExternalStore. This stands in for the backend during the shell phase;
 * swapping in real API calls later means changing only this file.
 *
 * Every module that needs vehicles should read them from here (especially
 * `availableVehicles`) so the status/availability rule stays in one place.
 */

const KEY = 'inzu_vehicles'

const TRIDENT_MODEL: Record<string, string> = { '60': 'Starbus LP 916', '40': 'Starbus LP 909', '28': 'Starbus LP 712' }

const SEED: Vehicle[] = [
  // Kansanshi (Solwezi)
  mk('INZ 101', 'BCG 4270 ZM', 'Tata', 'Starbus LP 909', 2021, 'bus', 'kansanshi', 'active', 32),
  mk('INZ 102', 'BCG 4271 ZM', 'Tata', 'Starbus LP 909', 2021, 'bus', 'kansanshi', 'active', 32),
  mk('INZ 103', 'BCG 4288 ZM', 'Tata', 'Starbus LP 909', 2022, 'bus', 'kansanshi', 'under_repair', 32),
  mk('INZ 114', 'BCD 1180 ZM', 'Tata', 'Starbus LP 712', 2020, 'bus', 'kansanshi', 'active', 24),
  // Trident (Kalumbila) — the shared demo roster (Enterprise + Sentinel)
  ...TRIDENT_BUSES.map((b) => mk(b.fleet, b.reg, 'Tata', TRIDENT_MODEL[b.seat], 2022, 'bus', 'trident', b.status, b.capacity)),
]

function mk(
  fleet_no: string, reg_plate: string, make: string, model: string, year: number,
  type: Vehicle['type'], branch: BranchCode, status: Vehicle['status'], capacity: number,
): Vehicle {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: fleet_no, fleet_no, reg_plate, make, model, year, type, branch, status,
    capacity, colour: 'White', chassis_no: '', engine_no: '',
    in_service_date: `${year}-01-15`, notes: '',
    created_by: 'System (seed)', created_at: now, updated_by: 'System (seed)', updated_at: now,
  }
}

const { load, commit, subscribe } = createSyncTable<Vehicle>({ table: 'vehicles', lsKey: KEY, seed: SEED })

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `v_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}

function stamp(): string {
  return new Date().toISOString()
}

// ── Mutations ──────────────────────────────────────────────────────────
export const vehiclesStore = {
  list: (): Vehicle[] => load(),

  add(data: VehicleInput): Vehicle {
    const now = stamp()
    const who = getActor().name
    const v: Vehicle = { ...data, id: newId(), created_by: who, created_at: now, updated_by: who, updated_at: now }
    commit([...load(), v])
    return v
  },

  update(id: string, patch: Partial<Vehicle>) {
    const who = getActor().name
    commit(load().map((v) => (v.id === id ? { ...v, ...patch, id: v.id, updated_by: who, updated_at: stamp() } : v)))
    // A branch transfer takes the vehicle's documents (licensing, etc.) with it.
    if (patch.branch) documentsStore.setBranchForEntity(id, patch.branch)
  },

  remove(id: string) {
    commit(load().filter((v) => v.id !== id))
  },

  /** Append many at once (used by Excel import). */
  bulkAdd(items: VehicleInput[]) {
    const now = stamp()
    const who = getActor().name
    const created = items.map((d) => ({ ...d, id: newId(), created_by: who, created_at: now, updated_by: who, updated_at: now }))
    commit([...load(), ...created])
    return created
  },

  /** Does a fleet number or plate already exist (optionally excluding one id)? */
  conflict(fleet_no: string, reg_plate: string, exceptId?: string): 'fleet_no' | 'reg_plate' | null {
    const list = load()
    const f = fleet_no.trim().toLowerCase()
    const p = reg_plate.trim().toLowerCase()
    for (const v of list) {
      if (v.id === exceptId) continue
      if (v.fleet_no.trim().toLowerCase() === f) return 'fleet_no'
      if (p && v.reg_plate.trim().toLowerCase() === p) return 'reg_plate'
    }
    return null
  },
}

// ── React bindings ─────────────────────────────────────────────────────
export function useVehicles(): Vehicle[] {
  return useSyncExternalStore(subscribe, load, load)
}

/** Shared selector other modules use — only available vehicles in a branch. */
export function availableVehicles(branch: BranchCode): Vehicle[] {
  return load().filter((v) => v.branch === branch && isAvailable(v))
}

/** Heal historical mismatches: align each vehicle's documents to its current branch. */
export function reconcileVehicleDocBranches() {
  const branchByVehicle = Object.fromEntries(load().map((v) => [v.id, v.branch]))
  documentsStore.syncVehicleBranches(branchByVehicle)
}
