import { useSyncExternalStore } from 'react'
import type { BranchCode } from '@/lib/roles'
import { getActor } from '@/lib/audit/actor'
import { type Driver, type DriverInput, type Crew, type DriverStatus } from './types'
import { registerCrossTabSync } from '@/lib/storage/sync'

/**
 * Mock data layer for drivers — localStorage-backed, reactive. Mirrors the
 * vehicles store pattern; swapping in a backend later means changing only this file.
 */

const KEY = 'inzu_drivers'

function mk(
  employee_no: string, full_name: string, branch: BranchCode, crew: Crew, section: string,
  status: DriverStatus, licence_expiry: string, psv_expiry: string,
  overtime = false,
): Driver {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: employee_no, employee_no, full_name, branch, phone: '', licence_no: `DL-${employee_no}`,
    licence_class: 'C1', licence_expiry, psv_expiry,
    date_hired: '2022-03-01', crew, section, status, overtime, photo_file_id: '', notes: '',
    created_by: 'System (seed)', created_at: now, updated_by: 'System (seed)', updated_at: now,
  }
}

const SEED: Driver[] = [
  // ── Kansanshi (Inside / Outside the Mine) ──
  mk('INZ-D101', 'Kelvin Mumba', 'kansanshi', 'A', 'Inside the Mine', 'active', '2026-11-10', '2027-01-15'),
  mk('INZ-D102', 'Patrick Bwalya', 'kansanshi', 'B', 'Outside the Mine', 'active', '2027-03-20', '2026-12-01'),
  mk('INZ-D103', 'Mercy Chanda', 'kansanshi', 'A', 'Inside the Mine', 'active', '2026-10-05', '2026-08-30'),
  mk('INZ-D104', 'John Tembo', 'kansanshi', 'B', 'Inside the Mine', 'active', '2027-02-12', '2027-02-12', true),
  mk('INZ-D105', 'Agnes Phiri', 'kansanshi', 'A', 'Outside the Mine', 'on_leave', '2027-05-01', '2027-04-10'),
  mk('INZ-D106', 'Felix Daka', 'kansanshi', 'B', 'Outside the Mine', 'active', '2026-07-22', '2027-03-03'),
  mk('INZ-D107', 'Brian Zulu', 'kansanshi', 'A', 'Inside the Mine', 'active', '2027-06-30', '2027-06-30'),
  mk('INZ-D108', 'Susan Banda', 'kansanshi', 'B', 'Outside the Mine', 'suspended', '2026-09-09', '2026-09-09'),

  // ── Trident (Pit / Sentinel / Enterprise / Security / Omega) ──
  mk('INZ-D201', 'Joseph Sakala', 'trident', 'A', 'Pit (Enterprise Mine)', 'active', '2027-01-30', '2027-01-30'),
  mk('INZ-D202', 'Grace Mwila', 'trident', 'B', 'Sentinel', 'active', '2026-06-25', '2026-12-19'),
  mk('INZ-D203', 'Emmanuel Lungu', 'trident', 'A', 'Enterprise', 'active', '2027-04-14', '2027-04-14'),
  mk('INZ-D204', 'Ruth Kabwe', 'trident', 'B', 'Security', 'active', '2027-02-08', '2026-11-28', true),
  mk('INZ-D205', 'Davies Ngosa', 'trident', 'A', 'Omega', 'active', '2026-08-18', '2027-05-05'),
  mk('INZ-D206', 'Charity Mulenga', 'trident', 'B', 'Pit (Sentinel Mine)', 'on_leave', '2027-03-30', '2027-03-30'),
  mk('INZ-D207', 'Peter Chibwe', 'trident', 'A', 'Sentinel', 'active', '2027-07-01', '2027-07-01'),
  mk('INZ-D208', 'Lydia Tembo', 'trident', 'B', 'Enterprise', 'active', '2026-07-05', '2026-10-30', true),
  mk('INZ-D209', 'Moses Phiri', 'trident', 'A', 'Security', 'active', '2027-05-22', '2027-05-22'),
  mk('INZ-D210', 'Esther Banda', 'trident', 'B', 'Omega', 'active', '2026-12-12', '2027-01-01'),
]

let cache: Driver[] | null = null
const listeners = new Set<() => void>()

/** Backfill the split of the old single "Pit" section → Pit (Enterprise Mine). */
function migrate(d: Driver): Driver {
  return d.section === 'Pit' ? { ...d, section: 'Pit (Enterprise Mine)' } : d
}
function load(): Driver[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const arr = JSON.parse(raw) as Driver[]
      const migrated = arr.map(migrate)
      cache = migrated
      if (migrated.some((d, i) => d !== arr[i])) localStorage.setItem(KEY, JSON.stringify(migrated)) // persist migration once
    } else {
      cache = SEED
      localStorage.setItem(KEY, JSON.stringify(SEED))
    }
  } catch {
    cache = SEED
  }
  return cache!
}

function commit(next: Driver[]) {
  cache = next
  localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
}
registerCrossTabSync(KEY, () => { cache = null; load(); listeners.forEach((l) => l()) })

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `d_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}
const stamp = () => new Date().toISOString()

export const driversStore = {
  list: (): Driver[] => load(),

  add(data: DriverInput): Driver {
    const now = stamp()
    const who = getActor().name
    const d: Driver = { ...data, id: newId(), created_by: who, created_at: now, updated_by: who, updated_at: now }
    commit([...load(), d])
    return d
  },

  update(id: string, patch: Partial<Driver>) {
    const who = getActor().name
    commit(load().map((d) => (d.id === id ? { ...d, ...patch, id: d.id, updated_by: who, updated_at: stamp() } : d)))
  },

  remove(id: string) {
    commit(load().filter((d) => d.id !== id))
  },

  conflict(employee_no: string, exceptId?: string): boolean {
    const e = employee_no.trim().toLowerCase()
    return load().some((d) => d.id !== exceptId && d.employee_no.trim().toLowerCase() === e)
  },

  /** Append many at once (Excel bulk upload). */
  bulkAdd(items: DriverInput[]): Driver[] {
    const now = stamp()
    const who = getActor().name
    const created = items.map((d) => ({ ...d, id: newId(), created_by: who, created_at: now, updated_by: who, updated_at: now }))
    commit([...load(), ...created])
    return created
  },
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useDrivers(): Driver[] {
  return useSyncExternalStore(subscribe, load, load)
}
