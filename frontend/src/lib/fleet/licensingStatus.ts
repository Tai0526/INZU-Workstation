import type { Vehicle } from '@/lib/fleet/types'
import { daysUntil, type DocumentRecord } from '@/lib/documents/types'
import type { LicCat } from '@/lib/documents/licensingConfig'

/**
 * Licensing expiry status — the single source of truth for BOTH the on-screen
 * grid and the exported spreadsheet, so a bus can never look compliant on one
 * and overdue on the other. Deliberately free of any spreadsheet dependency:
 * the page imports this directly, and only pulls the (heavy) export module in
 * when someone actually exports.
 */

export type CellTone = 'valid' | 'expiring' | 'today' | 'expired' | 'missing' | 'quiet' | 'nodate'

/** Days-left inside which a document counts as "expiring soon". */
export const EXPIRING_WINDOW_DAYS = 30

export interface LicCell {
  expiry: string
  days: number | null
  status: string
  tone: CellTone
}

export interface LicRow {
  fleet: string
  reg: string
  make: string
  cells: LicCell[]
}

/** Plain-words status for one vehicle × category. Pure — unit-tested. */
export function cellStatus(expiry: string | undefined, required: boolean, today = new Date()): LicCell {
  if (!expiry) return { expiry: '', days: null, status: required ? 'MISSING' : 'Not on file', tone: required ? 'missing' : 'quiet' }
  const days = daysUntil(expiry, today)
  if (days === null) return { expiry, days: null, status: 'No expiry date', tone: 'nodate' }
  if (days < 0) return { expiry, days, status: `EXPIRED ${-days} day${days === -1 ? '' : 's'} ago`, tone: 'expired' }
  if (days === 0) return { expiry, days, status: 'Expires TODAY', tone: 'today' }
  if (days <= EXPIRING_WINDOW_DAYS) return { expiry, days, status: `Expiring in ${days} day${days === 1 ? '' : 's'}`, tone: 'expiring' }
  return { expiry, days, status: 'Valid', tone: 'valid' }
}

/** Rows for the grid/sheet: every vehicle × the chosen categories. Pure. */
export function buildLicensingRows(
  vehicles: Vehicle[],
  docs: Pick<DocumentRecord, 'entity_id' | 'category' | 'superseded' | 'expiry_date'>[],
  cats: LicCat[],
  today = new Date(),
): LicRow[] {
  return [...vehicles]
    .sort((a, b) => a.fleet_no.localeCompare(b.fleet_no, undefined, { numeric: true }))
    .map((v) => ({
      fleet: v.fleet_no,
      reg: v.reg_plate,
      make: [v.make, v.model].filter(Boolean).join(' '),
      cells: cats.map((cat) => {
        const cur = docs.find((d) => d.entity_id === v.id && d.category === cat.key && !d.superseded)
        return cellStatus(cur?.expiry_date, cat.required, today)
      }),
    }))
}

// ── Vehicle-level flags & filtering ─────────────────────────────────────────
/**
 * Flags OVERLAP on purpose: a bus with one expired document and another never
 * uploaded is both "expired" and "missing", and must appear under either
 * filter — you're chasing work, not sorting into exclusive buckets.
 */
export interface LicFlags {
  expired: boolean
  expiring: boolean // includes "expires today"
  missing: boolean // a REQUIRED document not on file
  noneOnFile: boolean // nothing uploaded at all
  compliant: boolean
  /** Sort key: missing first, then soonest expiry (negative = already expired). */
  urgency: number
}

export function rowFlags(cells: LicCell[]): LicFlags {
  const expired = cells.some((c) => c.tone === 'expired')
  const expiring = cells.some((c) => c.tone === 'expiring' || c.tone === 'today')
  const missing = cells.some((c) => c.tone === 'missing')
  const noneOnFile = cells.every((c) => c.tone === 'missing' || c.tone === 'quiet')
  const dayValues = cells.map((c) => c.days).filter((d): d is number => d != null)
  return {
    expired, expiring, missing, noneOnFile,
    compliant: !expired && !expiring && !missing,
    urgency: missing ? -100_000 : dayValues.length ? Math.min(...dayValues) : 100_000,
  }
}

export type LicFilter = 'all' | 'compliant' | 'expiring' | 'expired' | 'missing'

/** URL/legacy aliases — `?filter=noncompliant` predates the split into expired/missing. */
export function normaliseFilter(raw: string | null | undefined): LicFilter {
  switch (raw) {
    case 'compliant': case 'expiring': case 'expired': case 'missing': return raw
    case 'noncompliant': case 'none': return 'missing'
    default: return 'all'
  }
}

export function matchesFilter(f: LicFlags, filter: LicFilter): boolean {
  switch (filter) {
    case 'compliant': return f.compliant
    case 'expiring': return f.expiring
    case 'expired': return f.expired
    case 'missing': return f.missing
    default: return true
  }
}

export const FILTER_LABEL: Record<LicFilter, string> = {
  all: 'All vehicles', compliant: 'Compliant', expiring: 'Expiring soon', expired: 'Expired', missing: 'Missing documents',
}

/** Short label for a days-left chip: "12d", "today", "-8d", "—". */
export function daysChip(cell: LicCell): string {
  if (cell.days == null) return cell.tone === 'missing' ? '—' : 'no date'
  if (cell.days === 0) return 'today'
  return cell.days > 0 ? `${cell.days}d` : `${cell.days}d`
}
