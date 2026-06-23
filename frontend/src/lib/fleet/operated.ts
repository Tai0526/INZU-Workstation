import { useSyncExternalStore } from 'react'
import type { BranchCode } from '@/lib/roles'
import { getActor } from '@/lib/audit/actor'
import { registerCrossTabSync } from '@/lib/storage/sync'

/**
 * Operated (not owned) vehicles — contract assets we only PROVIDE DRIVERS for
 * (Pit, Security, Dewatering). They don't carry our licensing documents, but we
 * still track availability (active / in workshop / grounded) and who owns them,
 * and we plan drivers against them in the Weekly Plan. Kept separate from the
 * owned fleet so the owned-fleet pages and dashboard counts stay clean.
 */

export type OperatedStatus = 'active' | 'under_repair' | 'grounded'
export const OPERATED_STATUS_LABEL: Record<OperatedStatus, string> = {
  active: 'Active', under_repair: 'In workshop', grounded: 'Grounded',
}

export interface OperatedVehicle {
  id: string
  branch: BranchCode
  fleet_no: string
  reg_plate: string
  owner: string // company the vehicle belongs to
  section: string // operating section (Pit (Enterprise Mine), Pit (Sentinel Mine), Security, Dewatering…)
  status: OperatedStatus
  notes: string
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}
export type OperatedVehicleInput = Omit<OperatedVehicle, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

const KEY = 'inzu_operated_vehicles'
const A = '2026-01-01T00:00:00.000Z'

function op(id: string, branch: BranchCode, fleet: string, reg: string, owner: string, section: string, status: OperatedStatus): OperatedVehicle {
  return { id, branch, fleet_no: fleet, reg_plate: reg, owner, section, status, notes: '', created_by: 'System (seed)', created_at: A, updated_by: 'System (seed)', updated_at: A }
}

const SEED: OperatedVehicle[] = [
  op('OV1', 'trident', 'HT-101', 'BCK 1201 ZM', 'FQM Trident', 'Pit (Enterprise Mine)', 'active'),
  op('OV2', 'trident', 'HT-108', 'BCK 1209 ZM', 'FQM Trident', 'Pit (Enterprise Mine)', 'active'),
  op('OV3', 'trident', 'HT-205', 'BCK 1340 ZM', 'FQM Trident', 'Pit (Sentinel Mine)', 'active'),
  op('OV4', 'trident', 'HT-212', 'BCK 1352 ZM', 'FQM Trident', 'Pit (Sentinel Mine)', 'under_repair'),
  op('OV5', 'trident', 'DW-02', 'BCK 2210 ZM', 'FQM Trident', 'Dewatering', 'active'),
  op('OV6', 'trident', 'SEC-7', 'BCK 3110 ZM', 'FQM Trident', 'Security', 'active'),
]

let cache: OperatedVehicle[] | null = null
const listeners = new Set<() => void>()

function load(): OperatedVehicle[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? (JSON.parse(raw) as OperatedVehicle[]) : SEED
  } catch {
    cache = SEED
  }
  if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(cache))
  return cache!
}
function commit(next: OperatedVehicle[]) {
  cache = next
  localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
}
registerCrossTabSync(KEY, () => { cache = null; load(); listeners.forEach((l) => l()) })

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `ov_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}
const stamp = () => new Date().toISOString()

export const operatedVehiclesStore = {
  list: (): OperatedVehicle[] => load(),
  add(data: OperatedVehicleInput): OperatedVehicle {
    const now = stamp(); const who = getActor().name
    const v: OperatedVehicle = { ...data, id: newId(), created_by: who, created_at: now, updated_by: who, updated_at: now }
    commit([...load(), v])
    return v
  },
  update(id: string, patch: Partial<OperatedVehicle>) {
    const who = getActor().name
    commit(load().map((v) => (v.id === id ? { ...v, ...patch, id: v.id, updated_by: who, updated_at: stamp() } : v)))
  },
  remove(id: string) { commit(load().filter((v) => v.id !== id)) },
  conflict(fleet_no: string, exceptId?: string): boolean {
    const f = fleet_no.trim().toLowerCase()
    return load().some((v) => v.id !== exceptId && v.fleet_no.trim().toLowerCase() === f)
  },
}

function subscribe(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) }
export function useOperatedVehicles(): OperatedVehicle[] {
  return useSyncExternalStore(subscribe, load, load)
}
