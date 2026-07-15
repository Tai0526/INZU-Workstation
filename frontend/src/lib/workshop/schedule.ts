// Auto-scheduling for the monthly vehicle inspection.
//
// Each non-grounded bus must be inspected at least once a month. This spreads the
// buses across the available mechanics — randomly, but balanced — placing each one
// on a day the assigned mechanic is actually rostered to work, and spacing the
// dates across the month so it isn't all bunched up. Pure (no store access) so the
// page can preview a plan before committing it.

/** A mechanic and the days they can work this month (yyyy-mm-dd, from their roster). */
export interface MechAvail { id: string; name: string; days: string[] }
/** One planned inspection: which bus, which mechanic, which day. */
export interface PlanEntry { fleet_no: string; reg_no: string; mechanic: string; scheduled_date: string }

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Randomly assign each vehicle to an available mechanic on one of their working
 * days — load balanced across mechanics (round-robin over a shuffled order) and
 * with each mechanic's buses spread evenly across their rostered days.
 */
export function buildInspectionPlan(vehicles: { fleet_no: string; reg_plate: string }[], mechs: MechAvail[]): PlanEntry[] {
  const avail = shuffle(mechs.filter((m) => m.days.length > 0))
  if (!avail.length || !vehicles.length) return []

  const order = shuffle(vehicles)
  const buckets = new Map<string, { fleet_no: string; reg_plate: string }[]>(avail.map((m) => [m.id, []]))
  order.forEach((v, i) => buckets.get(avail[i % avail.length].id)!.push(v))

  const plan: PlanEntry[] = []
  for (const m of avail) {
    const list = buckets.get(m.id)!
    const wd = m.days.slice().sort()
    list.forEach((v, j) => {
      const idx = Math.min(wd.length - 1, Math.floor(((j + 0.5) * wd.length) / list.length))
      plan.push({ fleet_no: v.fleet_no, reg_no: v.reg_plate, mechanic: m.name, scheduled_date: wd[idx] })
    })
  }
  return plan.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.fleet_no.localeCompare(b.fleet_no, undefined, { numeric: true }))
}
