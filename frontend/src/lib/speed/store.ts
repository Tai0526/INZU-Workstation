import { useSyncExternalStore } from 'react'
import type { BranchCode } from '@/lib/roles'
import { getActor } from '@/lib/audit/actor'
import { type SpeedEvent, type SpeedEventInput, type SpeedStatus } from './types'
import { createSyncTable } from '@/lib/supabase/syncTable'

/** Mock data layer for speed events — localStorage-backed, reactive, audit-stamped. */

const KEY = 'inzu_speed_events'

function mk(
  id: string, branch: BranchCode, datetime: string, driver_id: string, driver_name: string,
  vehicle: string, recorded: number, limit: number, status: SpeedStatus, route: string,
): SpeedEvent {
  const created = `${datetime.slice(0, 10)}T00:00:00.000Z`
  return {
    id, branch, event_datetime: datetime, driver_id, driver_name,
    vehicle_id: vehicle, vehicle_label: vehicle, route, recorded_speed: recorded, speed_limit: limit,
    status, source: 'Geotab', notes: '',
    resolved_by: status === 'closed' || status === 'confirmed' ? 'System (seed)' : '',
    resolved_at: status === 'closed' || status === 'confirmed' ? created : '',
    created_by: 'System (seed)', created_at: created, updated_by: 'System (seed)', updated_at: created,
  }
}

const SEED: SpeedEvent[] = [
  // ── Kansanshi ──
  mk('S-K01', 'kansanshi', '2026-02-11T07:20', 'INZ-D104', 'John Tembo', 'INZ 101', 58, 40, 'confirmed', 'Inside the Mine'), // +18
  mk('S-K02', 'kansanshi', '2026-03-19T15:40', 'INZ-D104', 'John Tembo', 'INZ 101', 52, 40, 'confirmed', 'Inside the Mine'), // +12
  mk('S-K03', 'kansanshi', '2026-04-02T06:55', 'INZ-D101', 'Kelvin Mumba', 'INZ 102', 87, 80, 'closed', 'Outside the Mine'), // +7
  mk('S-K04', 'kansanshi', '2026-05-08T17:10', 'INZ-D104', 'John Tembo', 'INZ 101', 78, 60, 'confirmed', 'Inside the Mine'), // +18
  mk('S-K05', 'kansanshi', '2026-05-22T08:05', 'INZ-D106', 'Felix Daka', 'INZ 114', 86, 80, 'disputed', 'Outside the Mine'), // +6
  mk('S-K06', 'kansanshi', '2026-06-04T16:30', 'INZ-D103', 'Mercy Chanda', 'INZ 102', 71, 60, 'flagged', 'Inside the Mine'), // +11
  mk('S-K07', 'kansanshi', '2026-06-15T07:45', 'INZ-D104', 'John Tembo', 'INZ 101', 63, 40, 'flagged', 'Inside the Mine'), // +23

  // ── Trident (Davies Ngosa escalates to dismissal on repeat 20+) ──
  mk('S-T01', 'trident', '2026-01-28T05:30', 'INZ-D205', 'Davies Ngosa', 'INZ 121', 88, 60, 'confirmed', 'Pit'), // +28
  mk('S-T02', 'trident', '2026-02-14T19:50', 'INZ-D205', 'Davies Ngosa', 'INZ 121', 84, 60, 'confirmed', 'Pit'), // +24
  mk('S-T03', 'trident', '2026-03-09T14:20', 'INZ-D202', 'Grace Mwila', 'INZ 127', 67, 60, 'closed', 'Sentinel'), // +7
  mk('S-T04', 'trident', '2026-03-30T20:15', 'INZ-D205', 'Davies Ngosa', 'INZ 121', 90, 60, 'confirmed', 'Pit'), // +30
  mk('S-T05', 'trident', '2026-04-17T08:40', 'INZ-D208', 'Lydia Tembo', 'INZ 131', 72, 60, 'disputed', 'Enterprise'), // +12
  mk('S-T06', 'trident', '2026-05-03T16:05', 'INZ-D204', 'Ruth Kabwe', 'INZ 122', 73, 60, 'confirmed', 'Security'), // +13
  mk('S-T07', 'trident', '2026-05-19T21:30', 'INZ-D209', 'Moses Phiri', 'INZ 127', 70, 60, 'closed', 'Security'), // +10
  mk('S-T08', 'trident', '2026-05-27T06:10', 'INZ-D205', 'Davies Ngosa', 'INZ 121', 79, 60, 'confirmed', 'Pit'), // +19
  mk('S-T09', 'trident', '2026-06-08T15:25', 'INZ-D203', 'Emmanuel Lungu', 'INZ 127', 68, 60, 'flagged', 'Omega'), // +8
  mk('S-T10', 'trident', '2026-06-12T19:40', 'INZ-D208', 'Lydia Tembo', 'INZ 131', 72, 60, 'flagged', 'Enterprise'), // +12

  // ── More Trident events clustered at shift-change windows (May = last month) ──
  mk('S-T11', 'trident', '2026-05-06T06:10', 'INZ-D205', 'Davies Ngosa', 'INZ 121', 86, 80, 'confirmed', 'Open road'),
  mk('S-T12', 'trident', '2026-05-08T06:40', 'INZ-D202', 'Grace Mwila', 'INZ 127', 70, 60, 'confirmed', 'Sentinel'),
  mk('S-T13', 'trident', '2026-05-08T17:20', 'INZ-D204', 'Ruth Kabwe', 'INZ 122', 72, 60, 'confirmed', 'Security'),
  mk('S-T14', 'trident', '2026-05-09T17:50', 'INZ-D209', 'Moses Phiri', 'INZ 127', 88, 80, 'confirmed', 'Open road'),
  mk('S-T15', 'trident', '2026-05-19T06:05', 'INZ-D205', 'Davies Ngosa', 'INZ 121', 84, 60, 'confirmed', 'Pit'),
  mk('S-T16', 'trident', '2026-05-20T18:10', 'INZ-D203', 'Emmanuel Lungu', 'INZ 131', 51, 40, 'confirmed', 'Ring road'),
  mk('S-T17', 'trident', '2026-05-21T06:30', 'INZ-D208', 'Lydia Tembo', 'INZ 131', 67, 60, 'confirmed', 'Enterprise'),
  mk('S-T18', 'trident', '2026-05-28T17:35', 'INZ-D205', 'Davies Ngosa', 'INZ 121', 90, 80, 'confirmed', 'Open road'),
  mk('S-T19', 'trident', '2026-06-03T06:20', 'INZ-D204', 'Ruth Kabwe', 'INZ 122', 71, 60, 'confirmed', 'Security'),
  mk('S-T20', 'trident', '2026-06-11T17:15', 'INZ-D202', 'Grace Mwila', 'INZ 127', 86, 80, 'flagged', 'Open road'),

  // ── Tracker glitches (excluded from analysis — implausible for a governed bus) ──
  mk('S-G01', 'trident', '2026-05-14T11:02', 'INZ-D205', 'Davies Ngosa', 'INZ 122', 227, 80, 'flagged', 'Inzu Workshop, Kalumbila'),
  mk('S-G02', 'trident', '2026-06-02T09:30', 'INZ-D203', 'Emmanuel Lungu', 'INZ 127', 146, 60, 'flagged', 'Inzu Workshop, Kalumbila'),
]

const { load, commit, subscribe } = createSyncTable<SpeedEvent>({ table: 'speed_events', lsKey: KEY, seed: SEED })

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `s_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}
const stamp = () => new Date().toISOString()

export const speedStore = {
  list: (): SpeedEvent[] => load(),

  add(data: SpeedEventInput): SpeedEvent {
    const now = stamp()
    const who = getActor().name
    const e: SpeedEvent = { ...data, id: newId(), created_by: who, created_at: now, updated_by: who, updated_at: now }
    commit([...load(), e])
    return e
  },

  update(id: string, patch: Partial<SpeedEvent>) {
    const who = getActor().name
    commit(load().map((e) => (e.id === id ? { ...e, ...patch, id: e.id, updated_by: who, updated_at: stamp() } : e)))
  },

  /** Set status, stamping who resolved it for confirm/dispute/close. */
  setStatus(id: string, status: SpeedStatus) {
    const who = getActor().name
    const now = stamp()
    commit(load().map((e) => (e.id === id ? { ...e, status, resolved_by: who, resolved_at: now, updated_by: who, updated_at: now } : e)))
  },

  remove(id: string) {
    commit(load().filter((e) => e.id !== id))
  },

  bulkAdd(items: SpeedEventInput[]) {
    const now = stamp()
    const who = getActor().name
    const created = items.map((d) => ({ ...d, id: newId(), created_by: who, created_at: now, updated_by: who, updated_at: now }))
    commit([...load(), ...created])
    return created
  },
}

export function useSpeedEvents(): SpeedEvent[] {
  return useSyncExternalStore(subscribe, load, load)
}
