import { useMemo } from 'react'
import type { BranchCode } from '@/lib/roles'
import { useSpeedEvents } from './store'
import { useCases } from '@/lib/safety/cases'
import { escalatedIds, tripView, type TripView } from './trips'

/**
 * React binding for the journey rules in ./trips. The rules themselves stay
 * free of React and of the stores so they can be run and checked on their own.
 */

/**
 * Journeys, with the escalated ones frozen. Pass a branch to scope it; leave it
 * off where all that's wanted is a driver's offence tally (HR files, the
 * dashboard), which would otherwise report fifteen offences where the Speed
 * Events page shows one.
 */
export function useSpeedTrips(branch?: BranchCode): TripView {
  const all = useSpeedEvents()
  const cases = useCases()
  return useMemo(() => tripView(all, escalatedIds(cases), branch), [all, cases, branch])
}

/** Every reading that rides inside another journey, across all branches. */
export function useAbsorbedSpeedIds(): Set<string> {
  return useSpeedTrips().absorbed
}
