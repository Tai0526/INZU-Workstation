import { useMemo } from 'react'
import type { BranchCode } from '@/lib/roles'
import { useCases, type DisciplinaryCase, type CaseStage } from './cases'
import { useSpeedTrips } from '@/lib/speed/useTrips'
import type { SpeedTrip } from '@/lib/speed/trips'

/**
 * One journey, one incident.
 *
 * Before the tracker's readings were grouped into journeys, a run that crossed
 * the limit a dozen times could be escalated a dozen times over — and the
 * incident list would show the same piece of driving twelve times, each with
 * its own charge and its own decision to make. Those cases are real and their
 * proceedings stand, so they are not merged or deleted: they are shown together,
 * as the one incident they always were.
 *
 * A group is only as far along as its least-advanced case. If eleven were closed
 * and one is still with Safety, there is still work to do — and the queue must
 * say so.
 */

export interface CaseGroup {
  /** The lead case's id — what opens when the row is clicked. */
  id: string
  lead: DisciplinaryCase
  /** Every case raised on this journey, earliest first. */
  cases: DisciplinaryCase[]
  /** The journey the charge came from, when the incident started as a speed event. */
  trip?: SpeedTrip
  /** Where the group really is: the least advanced of its cases. */
  stage: CaseStage
  /** How many of its cases still need someone to act. */
  openCount: number
  /** Earliest event in the group — how long this has been sitting. */
  when: string
  /** Fines approved across the group. */
  fine: number
}

const RANK: Record<CaseStage, number> = { safety_review: 0, ops_review: 1, closed: 2 }

/** The case that answers for the journey: the one on its worst reading, else the worst charge. */
function leadOf(cases: DisciplinaryCase[], trip?: SpeedTrip): DisciplinaryCase {
  if (trip) {
    const onWorst = cases.find((c) => c.event_id === trip.lead.id)
    if (onWorst) return onWorst
  }
  return cases.reduce((best, c) => {
    const d = (c.over_by ?? 0) - (best.over_by ?? 0)
    if (d > 0) return c
    if (d === 0 && c.event_datetime < best.event_datetime) return c
    return best
  }, cases[0])
}

export function groupCases(cases: DisciplinaryCase[], tripOf: (eventId: string) => SpeedTrip | undefined): CaseGroup[] {
  const buckets = new Map<string, { cases: DisciplinaryCase[]; trip?: SpeedTrip }>()
  for (const c of cases) {
    const trip = c.source === 'speed' && c.event_id ? tripOf(c.event_id) : undefined
    const key = trip ? `journey:${trip.id}` : `case:${c.id}`
    const b = buckets.get(key)
    if (b) b.cases.push(c)
    else buckets.set(key, { cases: [c], trip })
  }

  const groups: CaseGroup[] = []
  for (const { cases: list, trip } of buckets.values()) {
    list.sort((a, b) => a.event_datetime.localeCompare(b.event_datetime))
    const lead = leadOf(list, trip)
    groups.push({
      id: lead.id,
      lead,
      cases: list,
      trip,
      stage: list.reduce((s, c) => (RANK[c.stage] < RANK[s] ? c.stage : s), 'closed' as CaseStage),
      openCount: list.filter((c) => c.stage !== 'closed').length,
      when: list[0].event_datetime,
      fine: list.reduce((s, c) => s + (c.verdict?.outcome === 'approved' ? c.verdict.fine_amount ?? 0 : 0), 0),
    })
  }
  return groups.sort((a, b) => b.when.localeCompare(a.when))
}

/** Whole days an incident has been sitting unresolved. */
export function daysOpen(g: CaseGroup, now = new Date()): number {
  const started = new Date(g.lead.created_at || g.when).getTime()
  if (!Number.isFinite(started)) return 0
  return Math.max(0, Math.floor((now.getTime() - started) / 86_400_000))
}

export function useCaseGroups(branch: BranchCode): CaseGroup[] {
  const cases = useCases()
  const { tripOf } = useSpeedTrips()
  return useMemo(() => groupCases(cases.filter((c) => c.branch === branch), tripOf), [cases, tripOf, branch])
}
