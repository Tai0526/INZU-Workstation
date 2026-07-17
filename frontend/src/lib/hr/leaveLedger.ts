import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import type { BranchCode } from '@/lib/roles'

/**
 * Leave ledger — the dated history of leave taken, pay-outs and adjustments per
 * person. The old single-period stores (drivers/leave, hr/leave) still drive the
 * roster ("who's off now"); this ledger is what balances and analytics are built
 * on. Every grant here also updates the matching single-period store so nothing
 * else has to change. Persisted migration-free in app_config.
 *
 * Entitlement: 24 annual-leave days a year, accruing +2 each month. Only ANNUAL
 * leave draws the balance down; sick / compassionate / maternity etc. are separate
 * entitlements that are tracked for analytics but don't reduce the annual balance.
 */

export type LeaveType = 'annual' | 'sick' | 'compassionate' | 'maternity' | 'paternity' | 'unpaid' | 'other'
export const LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'compassionate', 'maternity', 'paternity', 'unpaid', 'other']
export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: 'Annual leave', sick: 'Sick leave', compassionate: 'Compassionate leave',
  maternity: 'Maternity leave', paternity: 'Paternity leave', unpaid: 'Unpaid leave', other: 'Other',
}
/** Only these leave types draw down the accrued 24-day annual balance. */
export const DRAWS_BALANCE: LeaveType[] = ['annual']

export type LeaveKind = 'leave' | 'payout' | 'adjustment'
export interface LeaveAttachment { file_id: string; file_name: string }
export interface LeaveEntry {
  id: string
  branch: BranchCode
  person_id: string
  person_name: string
  source: 'emp' | 'driver'
  kind: LeaveKind
  type: LeaveType     // for kind='leave'
  start: string       // yyyy-mm-dd (kind='leave')
  end: string         // yyyy-mm-dd (kind='leave')
  days: number        // leave days / days paid out / +/- adjustment
  note: string
  attachment: LeaveAttachment | null // e.g. a sick note
  by: string
  at: string
  created_by: string; created_at: string; updated_by: string; updated_at: string
}
export type LeaveEntryInput = Omit<LeaveEntry, 'id' | 'by' | 'at' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `lv_${Date.now()}_${Math.round(Math.random() * 1e6)}`)
const stampNow = () => new Date().toISOString()
const who = () => getActor().name
const cfg = createSyncConfig<LeaveEntry[]>({ key: 'leave_ledger', lsKey: 'inzu_leave_ledger', default: [] })

export const leaveLedgerStore = {
  get: cfg.get,
  subscribe: cfg.subscribe,
  list: () => cfg.get(),
  add(data: LeaveEntryInput): LeaveEntry {
    const now = stampNow()
    const item: LeaveEntry = { ...data, id: newId(), by: who(), at: now, created_by: who(), created_at: now, updated_by: who(), updated_at: now }
    cfg.set([...cfg.get(), item]); return item
  },
  update(id: string, patch: Partial<LeaveEntry>) {
    cfg.set(cfg.get().map((x) => (x.id === id ? { ...x, ...patch, id: x.id, updated_by: who(), updated_at: stampNow() } : x)))
  },
  remove(id: string) { cfg.set(cfg.get().filter((x) => x.id !== id)) },
}
export const useLeaveLedger = () => useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)

// ── Accrual & balance ───────────────────────────────────────────────────
export const ANNUAL_ENTITLEMENT = 24
export const ACCRUAL_PER_MONTH = 2
/** Days accrued so far this year — +2 per month, capped at the yearly entitlement. */
export function accruedByMonth(asOfISO: string): number {
  const months = new Date(`${asOfISO}T00:00:00`).getMonth() + 1 // Jan = 1 … current month
  return Math.min(ANNUAL_ENTITLEMENT, months * ACCRUAL_PER_MONTH)
}
const yearOf = (e: LeaveEntry) => Number((e.kind === 'leave' ? e.start : e.at || e.start || '').slice(0, 4))
const entryDate = (e: LeaveEntry) => (e.kind === 'leave' ? e.start : e.at || e.start || '').slice(0, 10)

/** Whole months elapsed between two ISO dates (never negative). */
export function monthsElapsed(fromISO: string, toISO: string): number {
  const a = new Date(`${(fromISO || '').slice(0, 10)}T00:00:00`), b = new Date(`${(toISO || '').slice(0, 10)}T00:00:00`)
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()))
}

const daysInclusive = (a: string, b: string) => Math.max(1, Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000) + 1)

export interface LeaveBalance { entitlement: number; accrued: number; annualTaken: number; paidOut: number; adjust: number; balance: number; since: string; openingBalance: number }
/**
 * Annual-leave balance from a person's opening date: the carried-in opening balance
 * (set when the system went live) + 2 days/month accrued since − annual taken − paid
 * out + adjustments. Annual leave reduces the balance as soon as it's approved (past
 * OR future dated). `currentLeave` is the person's single-period roster leave — if it
 * predates the ledger it's counted too (as annual) so the balance still drops.
 */
export function leaveBalance(entries: LeaveEntry[], personId: string, opts: { openingBalance?: number; openingAt?: string; asOf: string; currentLeave?: { start: string; end: string } | null }): LeaveBalance {
  const since = (opts.openingAt || '').slice(0, 10) || `${opts.asOf.slice(0, 4)}-01-01`
  const opening = opts.openingBalance || 0
  const accrued = opening + ACCRUAL_PER_MONTH * monthsElapsed(since, opts.asOf)
  const mine = entries.filter((e) => e.person_id === personId)
  const leaveStarts = new Set(mine.filter((e) => e.kind === 'leave').map((e) => e.start))
  let annualTaken = mine.filter((e) => e.kind === 'leave' && DRAWS_BALANCE.includes(e.type) && e.start >= since).reduce((s, e) => s + (e.days || 0), 0)
  // Roster leave set before the ledger existed (single period, no type) — count as annual so taken subtracts.
  const cl = opts.currentLeave
  if (cl && cl.start && cl.start >= since && !leaveStarts.has(cl.start)) annualTaken += daysInclusive(cl.start, cl.end)
  const paidOut = mine.filter((e) => e.kind === 'payout' && entryDate(e) >= since && entryDate(e) <= opts.asOf.slice(0, 10)).reduce((s, e) => s + (e.days || 0), 0)
  const adjust = mine.filter((e) => e.kind === 'adjustment' && entryDate(e) >= since && entryDate(e) <= opts.asOf.slice(0, 10)).reduce((s, e) => s + (e.days || 0), 0)
  return { entitlement: ANNUAL_ENTITLEMENT, accrued, annualTaken, paidOut, adjust, balance: accrued - annualTaken - paidOut + adjust, since, openingBalance: opening }
}

/**
 * Leave days paid out to a person — in a given month (`yyyy-mm`) or, with no month,
 * across a whole year. Payroll turns these into a taxable "leave paid out" payment
 * line on the payslip.
 */
export function leavePayoutDays(entries: LeaveEntry[], personId: string, opts: { month?: string; year?: number }): number {
  return entries
    .filter((e) => e.person_id === personId && e.kind === 'payout')
    .filter((e) => (opts.month ? entryDate(e).slice(0, 7) === opts.month : Number(entryDate(e).slice(0, 4)) === opts.year))
    .reduce((s, e) => s + (e.days || 0), 0)
}

/** Phase of a leave period relative to today: 'current' | 'upcoming' | 'ended' | 'none'. */
export function leavePhase(period: { start: string; end: string } | null | undefined, todayISO: string): 'current' | 'upcoming' | 'ended' | 'none' {
  if (!period || !period.start) return 'none'
  if (period.start > todayISO) return 'upcoming'
  if (period.end < todayISO) return 'ended'
  return 'current'
}

// ── Per-person analytics (feeds the employee "at-risk" flag) ────────────
export interface LeaveStats {
  spells: number          // number of leave spells (kind='leave')
  days: number            // total leave days
  sickSpells: number      // sick-leave spells
  sickDays: number
  sickNotes: number       // sick spells with an attached sick note
  byType: Record<LeaveType, { spells: number; days: number }>
}
export function leaveStats(entries: LeaveEntry[], personId: string, year: number): LeaveStats {
  const mine = entries.filter((e) => e.person_id === personId && e.kind === 'leave' && yearOf(e) === year)
  const byType = Object.fromEntries(LEAVE_TYPES.map((t) => [t, { spells: 0, days: 0 }])) as LeaveStats['byType']
  for (const e of mine) { byType[e.type].spells++; byType[e.type].days += e.days || 0 }
  return {
    spells: mine.length,
    days: mine.reduce((s, e) => s + (e.days || 0), 0),
    sickSpells: byType.sick.spells,
    sickDays: byType.sick.days,
    sickNotes: mine.filter((e) => e.type === 'sick' && !!e.attachment).length,
    byType,
  }
}
