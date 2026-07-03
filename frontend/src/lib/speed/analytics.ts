import type { BranchCode } from '@/lib/roles'
import type { Vehicle } from '@/lib/fleet/types'
import {
  type SpeedEvent, overBy, isGlitch, zoneOf, monthKey, monthLabel, lastMonths,
} from './types'

function daysInMonthOf(key: string, now: Date): number {
  const [y, m] = key.split('-').map(Number)
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  if (key === curKey) return Math.max(1, now.getDate()) // current month: elapsed days
  return new Date(y, m, 0).getDate()
}

/** Whole months between two YYYY-MM keys (absolute). */
function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return Math.abs((by - ay) * 12 + (bm - am))
}

export interface SpeedAnalytics {
  thisKey: string; lastKey: string; thisLabel: string; lastLabel: string
  countThis: number; countLast: number
  activeBuses: number; daysThis: number; daysLast: number
  rateThis: number; rateLast: number; ratePct: number; improving: boolean; same: boolean
  avgSevThis: number; avgSevLast: number
  trend: { label: string; events: number; key: string }[]
  daily: { day: number; events: number }[]; lastDailyAvg: number
  hourly: { hour: string; thisM: number; lastM: number }[]
  zoneMix: { month: string; open: number; site: number; ring: number }[]
  byModel: { model: string; thisM: number; lastM: number }[]
  perBus: { fleet: string; last: number; this: number; change: number }[]
  watch: { fleet: string; last: number; this: number; change: number }[]
  improved: { fleet: string; last: number; this: number; change: number }[]
  busesWorse: number; busesImproved: number
  concentrationShare: number; concentrationBuses: string[]
  glitches: SpeedEvent[]
}

/**
 * Compare any two months for a branch. `thisKey` is the month under review
 * (the "Compare" pick), `lastKey` is the baseline it's measured against
 * (the "vs" pick) — by default the previous month, but the caller can pick
 * any two. The 6-month trend always spans far enough to include both.
 */
export function computeSpeedAnalytics(allEvents: SpeedEvent[], allVehicles: Vehicle[], branch: BranchCode, thisKey: string, lastKey: string, today: Date = new Date(), busesOnRoad?: (mk: string) => number): SpeedAnalytics {
  // Trend ends at the later of the two months and stretches back far enough
  // (≥6 months) to cover the older pick as well.
  const endKey = thisKey >= lastKey ? thisKey : lastKey
  const [ey, em] = endKey.split('-').map(Number)
  const span = Math.max(6, monthsBetween(thisKey, lastKey) + 1)
  const months = lastMonths(span, new Date(ey, em - 1, 1))

  const branchEvents = allEvents.filter((e) => e.branch === branch)
  const glitches = branchEvents.filter(isGlitch)
  const valid = branchEvents.filter((e) => !isGlitch(e))
  const vehicles = allVehicles.filter((v) => v.branch === branch)
  const modelByFleet = new Map(vehicles.map((v) => [v.id, v.model || 'Unknown']))

  const inMonth = (e: SpeedEvent, k: string) => monthKey(e.event_datetime) === k
  const thisEvents = valid.filter((e) => inMonth(e, thisKey))
  const lastEvents = valid.filter((e) => inMonth(e, lastKey))

  // Buses actually on the road that month = distinct fleet numbers that logged
  // mileage (no duplicates), so a bus that ran both projects counts once. Falls
  // back to the whole branch fleet if mileage isn't available for that month.
  const activeBusesThis = busesOnRoad?.(thisKey) || vehicles.length || 1
  const activeBusesLast = busesOnRoad?.(lastKey) || vehicles.length || 1
  const daysThis = daysInMonthOf(thisKey, today)
  const daysLast = daysInMonthOf(lastKey, today)
  const rateThis = thisEvents.length / (activeBusesThis * daysThis)
  const rateLast = lastEvents.length / (activeBusesLast * daysLast)
  const ratePct = rateLast ? Math.round(((rateThis - rateLast) / rateLast) * 100) : rateThis ? 100 : 0
  const improving = rateThis < rateLast
  const same = Math.abs(rateThis - rateLast) < 1e-9

  const avg = (arr: SpeedEvent[]) => (arr.length ? arr.reduce((s, e) => s + overBy(e), 0) / arr.length : 0)

  // 6-month trend
  const trend = months.map((k) => ({ key: k, label: monthLabel(k), events: valid.filter((e) => inMonth(e, k)).length }))

  // Daily (current month)
  const daily = Array.from({ length: daysThis }, (_, i) => {
    const day = i + 1
    return { day, events: thisEvents.filter((e) => Number(e.event_datetime.slice(8, 10)) === day).length }
  })
  const lastDailyAvg = lastEvents.length / daysLast

  // Hourly (this vs last)
  const hourly = Array.from({ length: 24 }, (_, h) => ({
    hour: String(h).padStart(2, '0'),
    thisM: thisEvents.filter((e) => Number(e.event_datetime.slice(11, 13)) === h).length,
    lastM: lastEvents.filter((e) => Number(e.event_datetime.slice(11, 13)) === h).length,
  }))

  // Zone mix
  const zoneCounts = (arr: SpeedEvent[]) => ({
    open: arr.filter((e) => zoneOf(e) === 'open').length,
    site: arr.filter((e) => zoneOf(e) === 'site').length,
    ring: arr.filter((e) => zoneOf(e) === 'ring').length,
  })
  const zoneMix = [
    { month: monthLabel(lastKey), ...zoneCounts(lastEvents) },
    { month: monthLabel(thisKey), ...zoneCounts(thisEvents) },
  ]

  // By model
  const models = [...new Set(vehicles.map((v) => v.model || 'Unknown'))]
  const byModel = models
    .map((model) => ({
      model,
      thisM: thisEvents.filter((e) => modelByFleet.get(e.vehicle_id) === model).length,
      lastM: lastEvents.filter((e) => modelByFleet.get(e.vehicle_id) === model).length,
    }))
    .filter((m) => m.thisM || m.lastM)

  // Per-bus change
  const fleets = [...new Set([...thisEvents, ...lastEvents].map((e) => e.vehicle_label || 'Unknown'))]
  const perBus = fleets
    .map((fleet) => {
      const last = lastEvents.filter((e) => e.vehicle_label === fleet).length
      const thisC = thisEvents.filter((e) => e.vehicle_label === fleet).length
      return { fleet, last, this: thisC, change: thisC - last }
    })
    .sort((a, b) => b.change - a.change)
  const watch = perBus.filter((b) => b.change > 0).slice(0, 8)
  const improved = perBus.filter((b) => b.change < 0).sort((a, b) => a.change - b.change).slice(0, 8)
  const busesWorse = perBus.filter((b) => b.change > 0).length
  const busesImproved = perBus.filter((b) => b.change < 0).length

  const totalIncrease = watch.reduce((s, b) => s + b.change, 0)
  const top3 = watch.slice(0, 3)
  const concentrationShare = totalIncrease ? Math.round((top3.reduce((s, b) => s + b.change, 0) / totalIncrease) * 100) : 0
  const concentrationBuses = top3.map((b) => b.fleet)

  return {
    thisKey, lastKey, thisLabel: monthLabel(thisKey), lastLabel: monthLabel(lastKey),
    countThis: thisEvents.length, countLast: lastEvents.length,
    activeBuses: activeBusesThis, daysThis, daysLast,
    rateThis, rateLast, ratePct, improving, same,
    avgSevThis: avg(thisEvents), avgSevLast: avg(lastEvents),
    trend, daily, lastDailyAvg, hourly, zoneMix, byModel,
    perBus, watch, improved, busesWorse, busesImproved,
    concentrationShare, concentrationBuses, glitches,
  }
}
