import { type MileageTrip, type MileageRates, tripKm, rateFor } from './types'

/**
 * Section (project) attribution shared by the Mileage & Fuel overviews.
 *
 * Revenue and billed km are summed straight from trips grouped by their
 * project — the SAME arithmetic as the Billing Summary (`summarise`), so the
 * overview always agrees with what FQM is invoiced. A bus is never the unit
 * of revenue attribution: a bus that ran for both Enterprise and Sentinel
 * contributes each trip to its own project.
 *
 * Fuel has no per-trip breakdown (a tank refuel covers the whole day), so a
 * split bus's litres are ESTIMATED across its projects in proportion to the
 * kilometres it drove for each — flagged as an estimate in the UI.
 */

/** fleet → project → paid km, for one set of (already month-filtered) trips. */
export function busProjectKm(trips: MileageTrip[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const t of trips) {
    let per = out.get(t.fleet_no)
    if (!per) { per = new Map(); out.set(t.fleet_no, per) }
    per.set(t.project, (per.get(t.project) ?? 0) + tripKm(t))
  }
  return out
}

/** A bus's km-share per project (sums to 1), or null if it logged no trips. */
export function projectShares(weights: Map<string, Map<string, number>>, fleet: string): { project: string; share: number }[] | null {
  const per = weights.get(fleet)
  if (!per || per.size === 0) return null
  const total = [...per.values()].reduce((s, k) => s + k, 0)
  if (total <= 0) return null
  return [...per.entries()].map(([project, km]) => ({ project, share: km / total }))
}

/** The projects a bus served, biggest first — for its section label ("Enterprise · Sentinel"). */
export function busSectionLabel(weights: Map<string, Map<string, number>>, fleet: string): string {
  const per = weights.get(fleet)
  if (!per || per.size === 0) return 'Other'
  return [...per.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).join(' · ')
}

export interface SectionRow {
  section: string
  buses: number // distinct buses that ran trips for this project (split buses count in each)
  paidKm: number
  revenue: number
  litres: number // includes distributed shares from split buses (estimate)
  fuelCost: number
  net: number
  fuelShare: number | null
  split: boolean // any of its fuel came from a bus shared with another project
}

/**
 * Revenue per project straight from trips; fuel distributed per bus by km
 * share. Buses that fuelled but logged no trips land in 'Other' whole.
 */
export function sectionBreakdown(opts: {
  trips: MileageTrip[] // already filtered to branch + month
  fuelByBus: { fleet_no: string; litres: number }[] // per-bus month totals
  rates: MileageRates
  priceUSD: number
  sections: string[]
}): SectionRow[] {
  const { trips, fuelByBus, rates, priceUSD, sections } = opts
  const weights = busProjectKm(trips)

  const acc = new Map<string, SectionRow>()
  const get = (section: string) => {
    let r = acc.get(section)
    if (!r) { r = { section, buses: 0, paidKm: 0, revenue: 0, litres: 0, fuelCost: 0, net: 0, fuelShare: null, split: false }; acc.set(section, r) }
    return r
  }
  for (const s of sections) get(s)

  // Billing-summary arithmetic: km × the seat-class rate, per trip, per project.
  const busesPer = new Map<string, Set<string>>()
  for (const t of trips) {
    const r = get(t.project)
    const km = tripKm(t)
    r.paidKm += km
    r.revenue += km * rateFor(rates, t.seat_class)
    let set = busesPer.get(t.project)
    if (!set) { set = new Set(); busesPer.set(t.project, set) }
    set.add(t.fleet_no)
  }
  for (const [project, set] of busesPer) get(project).buses = set.size

  // Fuel: whole bus if it served one project; km-proportional estimate if split.
  for (const f of fuelByBus) {
    const shares = projectShares(weights, f.fleet_no)
    if (!shares) {
      const r = get('Other')
      r.litres += f.litres
      r.fuelCost += f.litres * priceUSD
      r.buses += 1
      continue
    }
    for (const { project, share } of shares) {
      const r = get(project)
      r.litres += f.litres * share
      r.fuelCost += f.litres * share * priceUSD
      if (shares.length > 1) r.split = true
    }
  }

  return [...acc.values()]
    .map((r) => ({ ...r, net: r.revenue - r.fuelCost, fuelShare: r.revenue > 0 ? r.fuelCost / r.revenue : null }))
    .filter((r) => r.buses > 0 || r.paidKm > 0 || r.litres > 0 || sections.includes(r.section))
}
