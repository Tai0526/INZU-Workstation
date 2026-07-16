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

export interface LeaveBalance { entitlement: number; accrued: number; annualTaken: number; paidOut: number; adjust: number; balance: number }
/** Annual-leave balance for a person in a leave year (accrued − annual taken − paid out + adjustments). */
export function leaveBalance(entries: LeaveEntry[], personId: string, year: number, asOfISO: string): LeaveBalance {
  const mine = entries.filter((e) => e.person_id === personId && yearOf(e) === year)
  const annualTaken = mine.filter((e) => e.kind === 'leave' && DRAWS_BALANCE.includes(e.type)).reduce((s, e) => s + (e.days || 0), 0)
  const paidOut = mine.filter((e) => e.kind === 'payout').reduce((s, e) => s + (e.days || 0), 0)
  const adjust = mine.filter((e) => e.kind === 'adjustment').reduce((s, e) => s + (e.days || 0), 0)
  const accrued = accruedByMonth(asOfISO)
  return { entitlement: ANNUAL_ENTITLEMENT, accrued, annualTaken, paidOut, adjust, balance: accrued - annualTaken - paidOut + adjust }
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
