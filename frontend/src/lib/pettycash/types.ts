import type { BranchCode } from '@/lib/roles'
import type { StatusTone } from '@/components/ui/StatusBadge'

/**
 * Petty cash: a request-first requisition workflow (request → authorise → check
 * → approve → pay) plus a Safety-run reconciliation ledger (money in / out with a
 * running balance, and overdraft "borrowed" cover tracked as arrears). Everything
 * lives in app_config lists (no DB table), so it needs no migration.
 */

export interface Audited {
  id: string
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

// ── Requisition workflow ────────────────────────────────────────────────
export type ReqStatus = 'pending' | 'authorised' | 'checked' | 'approved' | 'paid' | 'rejected'

export const REQ_STATUS_META: Record<ReqStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Pending authorisation', tone: 'warning' },
  authorised: { label: 'Authorised · to check', tone: 'warning' },
  checked: { label: 'Checked · to approve', tone: 'warning' },
  approved: { label: 'Approved · to pay', tone: 'good' },
  paid: { label: 'Paid', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'critical' },
}
/** The stages that still need someone to act (drives the notifications). */
export const OPEN_STATUSES: ReqStatus[] = ['pending', 'authorised', 'checked', 'approved']

export interface Requisition extends Audited {
  branch: BranchCode
  date: string // date requested (yyyy-mm-dd)
  requester_name: string
  department: string
  position: string
  purpose: string
  amount: number // amount requested
  status: ReqStatus
  // Sign-offs (each stamps who + when)
  authorised_by: string; authorised_at: string
  checked_by: string; checked_at: string
  approved_by: string; approved_at: string
  paid_by: string; paid_at: string; paid_amount: number // amount actually given
  rejected_by: string; rejected_at: string; rejected_note: string
}
export type RequisitionInput = Pick<Requisition, 'branch' | 'date' | 'requester_name' | 'department' | 'position' | 'purpose' | 'amount'>

// ── Reconciliation ledger ───────────────────────────────────────────────
export type LedgerDir = 'in' | 'out'
export type LedgerKind = 'float' | 'topup' | 'borrowed' | 'disbursement' | 'repayment' | 'adjustment'
export const LEDGER_KIND_LABEL: Record<LedgerKind, string> = {
  float: 'Opening float', topup: 'Top-up received', borrowed: 'Borrowed (overdraft cover)',
  disbursement: 'Disbursement', repayment: 'Arrears repayment', adjustment: 'Adjustment',
}
/** The money-in kinds a checker can add by hand (disbursements come from paying a requisition). */
export const MONEY_IN_KINDS: LedgerKind[] = ['topup', 'float', 'borrowed']
export const MONEY_OUT_KINDS: LedgerKind[] = ['repayment', 'adjustment']

export interface LedgerEntry extends Audited {
  branch: BranchCode
  date: string // yyyy-mm-dd
  direction: LedgerDir
  kind: LedgerKind
  amount: number
  party: string // source (money in) / recipient (money out) / lender for borrowed
  note: string
  req_id?: string // linked requisition (disbursements)
}
export type LedgerEntryInput = Pick<LedgerEntry, 'branch' | 'date' | 'direction' | 'kind' | 'amount' | 'party' | 'note'> & { req_id?: string }

// ── Money helpers ───────────────────────────────────────────────────────
export const fmtK = (n: number) => `K${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

/** Running balance = all money in − all money out. */
export function balanceOf(entries: LedgerEntry[]): number {
  return entries.reduce((s, e) => s + (e.direction === 'in' ? e.amount : -e.amount), 0)
}
/** Outstanding arrears = borrowed (overdraft cover) not yet repaid. */
export function arrearsOf(entries: LedgerEntry[]): number {
  const borrowed = entries.filter((e) => e.kind === 'borrowed').reduce((s, e) => s + e.amount, 0)
  const repaid = entries.filter((e) => e.kind === 'repayment').reduce((s, e) => s + e.amount, 0)
  return Math.max(0, borrowed - repaid)
}
/** Ledger sorted oldest → newest with a running balance stamped on each row. */
export function withRunningBalance(entries: LedgerEntry[]): (LedgerEntry & { balance: number })[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))
  let bal = 0
  return sorted.map((e) => { bal += e.direction === 'in' ? e.amount : -e.amount; return { ...e, balance: bal } })
}
