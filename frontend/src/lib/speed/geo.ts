import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * Per-event Geotab detail that the base `speed_events` columns don't hold:
 * coordinates (for the hotspot map), how long the speeding lasted, how far it
 * ran, the source location text, and a stable `ref` used to de-duplicate repeat
 * imports of the same event. Kept in an `app_config` map keyed by event id so it
 * needs no schema change (see the sync-schema rule).
 */
export interface SpeedGeo {
  lat: number
  lng: number
  dur: number // seconds the event lasted
  dist: number // km travelled while over the limit
  ref: string // dedup key: fleet|startISO|maxSpeed
  loc: string // full location text from the report
}

const cfg = createSyncConfig<Record<string, SpeedGeo>>({ key: 'speed_geo', lsKey: 'inzu_speed_geo', default: {} })

export const speedGeoStore = {
  get: () => cfg.get(),
  /** Merge in new per-event detail (keyed by the event id). */
  setMany(entries: Record<string, SpeedGeo>) {
    if (Object.keys(entries).length === 0) return
    cfg.set({ ...cfg.get(), ...entries })
  },
  remove(ids: string[]) {
    const m = { ...cfg.get() }
    let changed = false
    for (const id of ids) if (id in m) { delete m[id]; changed = true }
    if (changed) cfg.set(m)
  },
  /** The set of Geotab refs already imported — used to skip duplicates. */
  refs(): Set<string> {
    return new Set(Object.values(cfg.get()).map((g) => g.ref).filter(Boolean))
  },
  subscribe: cfg.subscribe,
}

export function useSpeedGeo(): Record<string, SpeedGeo> {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}

// ── Driver suggestion ──────────────────────────────────────────────────
// The Geotab report never says who was driving. Suggest the most likely driver
// from operational data so the reviewer has a starting point to confirm against.
export interface DriverSuggestion { name: string; basis: string; score: number }

const normFleet = (s: string) => {
  const m = String(s || '').toUpperCase().match(/INZ\s*0*(\d+)/)
  return m ? `INZ${parseInt(m[1], 10)}` : String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function suggestDrivers(
  fleetLabel: string,
  dateISO: string,
  data: {
    allocations?: { fleet_no: string; date: string; driver_name: string }[]
    weekly?: { fleet_no: string; driver_name: string; week_start: string; week_end: string }[]
    events?: { vehicle_label: string; driver_name: string; status: string }[]
  },
): DriverSuggestion[] {
  const target = normFleet(fleetLabel)
  if (!target) return []
  const day = dateISO.slice(0, 10)
  const best = new Map<string, DriverSuggestion>()
  const add = (name: string, basis: string, score: number) => {
    const clean = (name || '').trim()
    if (!clean) return
    const k = clean.toLowerCase()
    const cur = best.get(k)
    if (!cur || score > cur.score) best.set(k, { name: clean, basis, score })
  }

  // 1. Allocated to this exact bus on this exact day — strongest signal.
  for (const a of data.allocations ?? []) {
    if (normFleet(a.fleet_no) === target && a.date.slice(0, 10) === day) add(a.driver_name, 'Allocated to this bus that day', 100)
  }
  // 2. Weekly assignment covering the day.
  for (const w of data.weekly ?? []) {
    if (normFleet(w.fleet_no) === target && day >= w.week_start && day <= w.week_end) add(w.driver_name, 'Assigned to this bus that week', 80)
  }
  // 3. Usually drives this bus (allocation frequency, any day).
  const allocCount = new Map<string, number>()
  for (const a of data.allocations ?? []) if (normFleet(a.fleet_no) === target && a.driver_name) allocCount.set(a.driver_name.trim(), (allocCount.get(a.driver_name.trim()) || 0) + 1)
  ;[...allocCount.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).forEach(([name, c]) => add(name, `Usually drives this bus (${c}×)`, 40 + Math.min(c, 10)))
  // 4. Previously confirmed speeding on this bus.
  const evtCount = new Map<string, number>()
  for (const e of data.events ?? []) if (normFleet(e.vehicle_label) === target && e.driver_name && e.status === 'confirmed') evtCount.set(e.driver_name.trim(), (evtCount.get(e.driver_name.trim()) || 0) + 1)
  ;[...evtCount.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).forEach(([name, c]) => add(name, `Confirmed on this bus before (${c}×)`, 20 + Math.min(c, 10)))

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 5)
}
