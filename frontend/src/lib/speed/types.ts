import type { BranchCode } from '@/lib/roles'
import type { StatusTone } from '@/components/ui/StatusBadge'

// ── Event lifecycle (spec §4.4.2) ──────────────────────────────────────
// Tracker logs a Geotab-flagged event → Safety Officer confirms or it is
// disputed → it is closed out.
export type SpeedStatus = 'flagged' | 'confirmed' | 'disputed' | 'closed'

export const STATUS_META: Record<SpeedStatus, { label: string; tone: StatusTone }> = {
  flagged: { label: 'Flagged', tone: 'neutral' },
  confirmed: { label: 'Confirmed', tone: 'good' },
  disputed: { label: 'Disputed', tone: 'warning' },
  closed: { label: 'Closed', tone: 'good' },
}

export interface SpeedEvent {
  id: string
  branch: BranchCode
  event_datetime: string // ISO datetime
  driver_id: string // '' if not matched to a roster driver
  driver_name: string // denormalised for display / historical events
  vehicle_id: string // fleet number (vehicles use fleet_no as id)
  vehicle_label: string
  route: string // route / area at the time
  recorded_speed: number
  speed_limit: number
  status: SpeedStatus
  source: string // e.g. Geotab
  notes: string
  resolved_by: string
  resolved_at: string
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

export type SpeedEventInput = Omit<SpeedEvent, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

// ── Speed zones & the binding cap ──────────────────────────────────────
// A bus must never exceed 80 km/h while carrying clients, regardless of the
// posted limit — so the limit used for charging is min(posted, 80).
export const MAX_ALLOWED_SPEED = 80

export const SPEED_ZONES: { label: string; limit: number }[] = [
  { label: '40 km/h — Inside the mine (restricted)', limit: 40 },
  { label: '60 km/h — Inside the mine', limit: 60 },
  { label: '80 km/h — Outside the mine', limit: 80 },
]

export function effectiveLimit(limit: number): number {
  return Math.min(limit || MAX_ALLOWED_SPEED, MAX_ALLOWED_SPEED)
}

export function overBy(e: SpeedEvent): number {
  return Math.max(0, Math.round(e.recorded_speed - effectiveLimit(e.speed_limit)))
}

// ── Penalty matrix (INZU over-speeding policy) ─────────────────────────
// Escalates by how far over the limit (band) AND the driver's offence number
// within that band. Under 5 km/h over carries no charge.
export interface PenaltyStep { action: string; fine: number }
export interface PenaltyBand { key: string; label: string; min: number; max: number; ladder: PenaltyStep[] }

export const PENALTY_BANDS: PenaltyBand[] = [
  {
    key: '5-9', label: '5–9 km/h over', min: 5, max: 9,
    ladder: [
      { action: 'Verbal warning & counselling memo', fine: 0 },
      { action: 'Written warning & fine', fine: 500 },
      { action: 'Final written warning & fine', fine: 1000 },
      { action: 'Dismissal', fine: 0 },
    ],
  },
  {
    key: '10-19', label: '10–19 km/h over', min: 10, max: 19,
    ladder: [
      { action: 'Written warning & fine', fine: 1500 },
      { action: 'Final written warning & fine', fine: 2000 },
      { action: 'Dismissal', fine: 0 },
    ],
  },
  {
    key: '20+', label: '20+ km/h over', min: 20, max: Infinity,
    ladder: [
      { action: 'Final written warning & fine', fine: 2000 },
      { action: 'Dismissal', fine: 0 },
    ],
  },
]

export function bandFor(over: number): PenaltyBand | null {
  return PENALTY_BANDS.find((b) => over >= b.min && over <= b.max) ?? null
}

export interface Penalty {
  bandKey: string
  offence: number // offence number within the band
  action: string
  fine: number
  dismissal: boolean
}

/** Resolve the penalty for an over-amount + the offence number within that band. */
export function penaltyFor(over: number, offenceInBand: number): Penalty | null {
  const band = bandFor(over)
  if (!band || offenceInBand < 1) return null
  const step = band.ladder[Math.min(offenceInBand - 1, band.ladder.length - 1)]
  return { bandKey: band.key, offence: offenceInBand, action: step.action, fine: step.fine, dismissal: step.action.includes('Dismissal') }
}

/**
 * Offence number within the band for a given event = chronological position
 * among the driver's events in the same band that count against them.
 * Returns 0 if the event itself doesn't count (disputed / cleared) or is < 5 over.
 */
export function offenceNumberInBand(events: SpeedEvent[], event: SpeedEvent): number {
  const band = bandFor(overBy(event))
  if (!band || !countsAgainstDriver(event)) return 0
  const key = event.driver_id || event.driver_name
  const same = events
    .filter((e) => (e.driver_id || e.driver_name) === key && countsAgainstDriver(e) && bandFor(overBy(e))?.key === band.key)
    .sort((a, b) => a.event_datetime.localeCompare(b.event_datetime))
  return same.findIndex((e) => e.id === event.id) + 1
}

export function penaltyTone(p: Penalty | null): StatusTone {
  if (!p) return 'neutral'
  if (p.dismissal || p.action.includes('Final')) return 'critical'
  if (p.fine > 0) return 'warning'
  return 'neutral'
}

export function penaltyLabel(p: Penalty | null): string {
  if (!p) return 'No charge'
  return p.fine > 0 ? `${p.action} · K${p.fine.toLocaleString()}` : p.action
}

// A governed mine bus (Tata LP909 / LPO1318) cannot plausibly exceed ~100 km/h.
// Readings beyond this are GPS faults (cold-start / multipath), not real speeding.
export const GLITCH_SPEED = 105
export function isGlitch(e: SpeedEvent): boolean {
  return e.recorded_speed >= GLITCH_SPEED
}

/** A confirmed (or still-open) event counts against a driver; disputed/closed/glitches don't. */
export function countsAgainstDriver(e: SpeedEvent): boolean {
  return !isGlitch(e) && (e.status === 'flagged' || e.status === 'confirmed')
}

// Speed zones map to the three FQM speeding rules (by effective limit).
export function zoneOf(e: SpeedEvent): 'open' | 'site' | 'ring' | 'other' {
  const lim = effectiveLimit(e.speed_limit)
  if (lim >= 80) return 'open'
  if (lim >= 60) return 'site'
  if (lim >= 40) return 'ring'
  return 'other'
}
export const ZONE_META = {
  open: { label: 'Open road (>80)', fill: '#B3261E' },
  site: { label: 'General site (>60)', fill: '#C9A227' },
  ring: { label: 'Ring road (>40)', fill: '#0F1B33' },
  other: { label: 'Other', fill: '#6B7280' },
} as const

// ── Month helpers (for month-on-month trends) ──────────────────────────
export function monthKey(iso: string): string {
  return iso.slice(0, 7) // YYYY-MM
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short', year: '2-digit' })
}

/** Last n month keys ending at `end` (default now), oldest first. */
export function lastMonths(n: number, end = new Date()): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}
