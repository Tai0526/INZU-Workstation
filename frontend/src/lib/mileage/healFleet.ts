import { tripsStore } from './store'
import { vehiclesStore } from '@/lib/fleet/store'
import { canonFleetNo } from './excel'
import type { MileageTrip } from './types'

/**
 * One bus, one spelling.
 *
 * Every mileage view keys on the fleet-number STRING, so "INZ120" (as the
 * Geotab lab wrote it) and "INZ 120" (as the register spells it) rendered as
 * two different buses and split the month. Imports now resolve against the
 * register before saving; this heal repairs rows that got in before that —
 * renaming any trip whose fleet number canonically matches a registered
 * vehicle to the register's spelling, and filling a blank reg plate from the
 * register while it is there.
 *
 * Idempotent and cheap: after one pass there is nothing left to rename, so
 * running it on every Mileage visit costs a filter and writes nothing.
 */
export function healFleetSpellings(): number {
  const vehicles = vehiclesStore.list()
  if (!vehicles.length) return 0 // register not hydrated yet — never rename against an empty list
  const byCanon = new Map(vehicles.map((v) => [`${v.branch}|${canonFleetNo(v.fleet_no)}`, v]))
  const patches = new Map<string, Partial<MileageTrip>>()
  for (const t of tripsStore.list()) {
    const v = byCanon.get(`${t.branch}|${canonFleetNo(t.fleet_no)}`)
    if (!v) continue // no registered match — a genuinely new bus keeps its spelling
    const fixFleet = v.fleet_no !== t.fleet_no
    const fixReg = !t.vehicle_reg && !!v.reg_plate
    if (!fixFleet && !fixReg) continue
    patches.set(t.id, { ...(fixFleet ? { fleet_no: v.fleet_no } : {}), ...(fixReg ? { vehicle_reg: v.reg_plate } : {}) })
  }
  tripsStore.updateMany(patches)
  return patches.size
}
