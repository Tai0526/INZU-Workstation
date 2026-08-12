import type { BranchCode } from '@/lib/roles'
import { type SpeedEvent, overBy, isGlitch, countsAgainstDriver } from './types'
import type { SpeedGeo } from './geo'

/**
 * One journey, one offence.
 *
 * Geotab raises an exception every time a bus crosses the limit, so a single
 * run from Kisasa to the main gate can throw fifteen of them. Charged one by
 * one they would walk a driver to dismissal for what was really one bad
 * journey — while the policy deliberately gives three chances before it comes
 * to that. So events from the same bus close together in time are read as the
 * journey they belong to: the worst reading answers for it, and the rest stay
 * attached as evidence of how sustained the speeding was.
 *
 * Nothing is deleted or rewritten. Every original event stays in the record;
 * grouping only decides which one carries the charge.
 */

/**
 * A reading more than this long after the previous one starts a fresh journey.
 *
 * Set from days operations walked through rather than from theory. On 2 Aug
 * INZ125 is two journeys — 07:15–07:50 and 15:29–16:49, seven and a half hours
 * apart — while on 6 Aug INZ224 is one long run from 12:49 to 19:23 despite a
 * three-and-a-half hour quiet stretch in the middle. Four hours separates those
 * two cases; change this one number to tighten or loosen the whole page.
 */
export const TRIP_GAP_MINUTES = 240

export interface SpeedTrip {
  /** The lead event's id — used as the row key, so it survives regrouping. */
  id: string
  branch: BranchCode
  vehicle_label: string
  /** Every reading in the journey, earliest first. */
  events: SpeedEvent[]
  /** The reading that answers for the journey (worst genuine one). */
  lead: SpeedEvent
  /**
   * The readings that count as offences. Normally just the lead. A journey
   * that already went to an incident keeps whichever readings were escalated,
   * so past proceedings are never re-cut by a change in this file.
   */
  charged: SpeedEvent[]
  /** An incident already exists on this journey — leave it exactly as it was. */
  locked: boolean
  startISO: string
  endISO: string
  /** How many times the bus went over the limit during the journey. */
  breaches: number
}

const EMPTY: ReadonlySet<string> = new Set()

const normFleet = (s: string) => {
  const m = String(s || '').toUpperCase().match(/INZ\s*0*(\d+)/)
  return m ? `INZ${parseInt(m[1], 10)}` : String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const ms = (e: SpeedEvent) => new Date(e.event_datetime).getTime()

/**
 * Two readings can only belong to the same journey if nobody has said they had
 * different drivers. Once a shift change is recorded, the second driver starts
 * their own journey rather than inheriting the first one's breaches.
 */
function differentDriver(a: SpeedEvent, b: SpeedEvent): boolean {
  if (a.driver_id && b.driver_id) return a.driver_id !== b.driver_id
  const x = (a.driver_name || '').trim().toLowerCase()
  const y = (b.driver_name || '').trim().toLowerCase()
  return !!x && !!y && x !== y
}

/** The worst genuine reading — tracker glitches never answer for a journey. */
function pickLead(list: SpeedEvent[]): SpeedEvent {
  const real = list.filter((e) => !isGlitch(e))
  const pool = real.length ? real : list
  return pool.reduce((best, e) => {
    const d = overBy(e) - overBy(best)
    if (d > 0) return e
    if (d === 0 && e.event_datetime < best.event_datetime) return e
    return best
  }, pool[0])
}

function makeTrip(bucket: SpeedEvent[], escalated: ReadonlySet<string>): SpeedTrip {
  const alreadyRaised = bucket.filter((e) => escalated.has(e.id))
  const charged = alreadyRaised.length ? alreadyRaised : [pickLead(bucket)]
  const lead = alreadyRaised.length ? pickLead(alreadyRaised) : charged[0]
  return {
    id: lead.id,
    branch: lead.branch,
    vehicle_label: lead.vehicle_label,
    events: bucket,
    lead,
    charged,
    locked: alreadyRaised.length > 0,
    startISO: bucket[0].event_datetime,
    endISO: bucket[bucket.length - 1].event_datetime,
    breaches: bucket.length,
  }
}

/**
 * Group a set of events into the journeys they belong to. Escalated events do
 * NOT change how a journey is cut — they only freeze it, so an incident raised
 * last month reads the same way today.
 */
export function groupTrips(
  events: SpeedEvent[],
  escalated: ReadonlySet<string> = EMPTY,
  gapMinutes = TRIP_GAP_MINUTES,
): SpeedTrip[] {
  const gapMs = gapMinutes * 60_000
  const byBus = new Map<string, SpeedEvent[]>()
  for (const e of events) {
    const k = `${e.branch}|${normFleet(e.vehicle_label || e.vehicle_id)}`
    const arr = byBus.get(k)
    if (arr) arr.push(e)
    else byBus.set(k, [e])
  }

  const trips: SpeedTrip[] = []
  for (const list of byBus.values()) {
    list.sort((a, b) => a.event_datetime.localeCompare(b.event_datetime))
    let bucket: SpeedEvent[] = []
    for (const e of list) {
      const prev = bucket[bucket.length - 1]
      if (prev) {
        const gap = ms(e) - ms(prev)
        // An unreadable timestamp breaks the chain rather than silently
        // swallowing a reading into the journey before it.
        const apart = !Number.isFinite(gap) || gap > gapMs
        if (apart || differentDriver(prev, e)) {
          trips.push(makeTrip(bucket, escalated))
          bucket = []
        }
      }
      bucket.push(e)
    }
    if (bucket.length) trips.push(makeTrip(bucket, escalated))
  }
  return trips.sort((a, b) => a.startISO.localeCompare(b.startISO))
}

/**
 * Readings that ride along inside somebody else's journey. They stay in the
 * record and on the driver's file, but they are evidence — not separate
 * offences — so every count that drives a penalty skips them.
 */
export function absorbedIds(trips: SpeedTrip[]): Set<string> {
  const out = new Set<string>()
  for (const t of trips) {
    const keep = new Set(t.charged.map((e) => e.id))
    for (const e of t.events) if (!keep.has(e.id)) out.add(e.id)
  }
  return out
}

/** Ids of events that already went to an incident, from the case list. */
export function escalatedIds(cases: { event_id: string }[]): Set<string> {
  return new Set(cases.map((c) => c.event_id).filter(Boolean))
}

// ── Reading a journey ──────────────────────────────────────────────────

const hhmm = (iso: string) => iso.slice(11, 16)

/** "07:15 – 07:50" for a run, or just the time for a single reading. */
export function tripSpan(t: SpeedTrip): string {
  return t.breaches > 1 ? `${hhmm(t.startISO)} – ${hhmm(t.endISO)}` : hhmm(t.startISO)
}

/** How long the bus spent over the limit and how far it ran, across the journey. */
export function tripExposure(t: SpeedTrip, geo: Record<string, SpeedGeo>): { seconds: number; km: number } {
  let seconds = 0
  let km = 0
  for (const e of t.events) {
    const g = geo[e.id]
    if (!g) continue
    seconds += g.dur || 0
    km += g.dist || 0
  }
  return { seconds, km: Math.round(km * 100) / 100 }
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s ? `${m}m ${s}s` : `${m}m`
}

/**
 * A plain-English account of the journey, written onto the incident so Safety
 * and Ops see the whole pattern and not just the single worst reading.
 */
export function tripNarrative(t: SpeedTrip, geo?: Record<string, SpeedGeo>): string {
  const date = new Date(`${t.startISO.slice(0, 10)}T00:00:00`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
  if (t.breaches === 1) {
    return `${t.vehicle_label} on ${date} at ${hhmm(t.startISO)} — ${t.lead.recorded_speed} km/h in a ${t.lead.speed_limit} zone (${overBy(t.lead)} km/h over).`
  }
  const exposure = geo ? tripExposure(t, geo) : null
  const worst = `worst reading ${t.lead.recorded_speed} km/h in a ${t.lead.speed_limit} zone (${overBy(t.lead)} km/h over) at ${hhmm(t.lead.event_datetime)}`
  const tail = exposure && exposure.seconds
    ? ` The bus was over the limit for ${fmtDuration(exposure.seconds)} in total, covering ${exposure.km.toFixed(2)} km.`
    : ''
  return `One journey on ${date}: ${t.vehicle_label} crossed the limit ${t.breaches} times between ${hhmm(t.startISO)} and ${hhmm(t.endISO)} — ${worst}.${tail} The charge is raised once for the journey; the other ${t.breaches - 1} reading${t.breaches === 2 ? '' : 's'} show how sustained it was.`
}

/** Events that count against a driver, one per journey. */
export function chargeableEvents(events: SpeedEvent[], absorbed: ReadonlySet<string>): SpeedEvent[] {
  return events.filter((e) => countsAgainstDriver(e) && !absorbed.has(e.id))
}

/** Everything a screen needs to work in journeys — see useTrips for the hooks. */
export interface TripView {
  trips: SpeedTrip[]
  /** Events that ride inside another journey — never counted as an offence. */
  absorbed: Set<string>
  /** The journey a given event belongs to. */
  tripOf: (eventId: string) => SpeedTrip | undefined
}

export function tripView(events: SpeedEvent[], escalated: ReadonlySet<string>, branch?: BranchCode): TripView {
  const trips = groupTrips(branch ? events.filter((e) => e.branch === branch) : events, escalated)
  const byEvent = new Map<string, SpeedTrip>()
  for (const t of trips) for (const e of t.events) byEvent.set(e.id, t)
  return { trips, absorbed: absorbedIds(trips), tripOf: (id: string) => byEvent.get(id) }
}
