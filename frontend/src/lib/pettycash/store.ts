import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import { createSyncConfig, createSyncTable } from '@/lib/supabase/syncTable'
import { ROLES, type RoleKey } from '@/lib/roles'
import {
  type Requisition, type RequisitionInput, type LedgerEntry, type LedgerEntryInput, type ReceiptFile,
} from './types'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `pc_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}
const now = () => new Date().toISOString()
const who = () => getActor().name

// Petty-cash records live in dedicated Supabase tables (one row per requisition /
// ledger entry) — durable, auditable, and cleared by the clean-slate reset.
// Apply migration 0007_petty_cash.sql to create them (columns mirror these types
// 1:1). This factory is a small audited list-store on top of createSyncTable:
// each write commits the whole list and the sync layer diffs + persists per row.
type WithAudit = { id: string; created_by: string; created_at: string; updated_by: string; updated_at: string }
function makeSyncedList<T extends WithAudit>(table: string, lsKey: string) {
  const t = createSyncTable<T>({ table, lsKey, seed: [] })
  return {
    get: t.load,
    subscribe: t.subscribe,
    list: () => t.load(),
    add(data: Omit<T, keyof WithAudit>): T {
      const item = { ...(data as object), id: newId(), created_by: who(), created_at: now(), updated_by: who(), updated_at: now() } as T
      t.commit([...t.load(), item]); return item
    },
    update(id: string, patch: Partial<T>) {
      t.commit(t.load().map((x) => (x.id === id ? { ...x, ...patch, id: x.id, updated_by: who(), updated_at: now() } : x)))
    },
    remove(id: string) { t.commit(t.load().filter((x) => x.id !== id)) },
  }
}

// ── Stores ──────────────────────────────────────────────────────────────
export const reqStore = makeSyncedList<Requisition>('petty_cash_requisitions', 'inzu_petty_cash_reqs')
export const ledgerStore = makeSyncedList<LedgerEntry>('petty_cash_ledger', 'inzu_petty_cash_ledger')
export const useReqs = () => useSyncExternalStore(reqStore.subscribe, reqStore.get, reqStore.get)
export const useLedger = () => useSyncExternalStore(ledgerStore.subscribe, ledgerStore.get, ledgerStore.get)

// ── Acting approver (delegate) ──────────────────────────────────────────
// When both Ops and Asst Ops are out, they leave someone in charge. That person
// is recorded here and gains authorise/approve power while set.
export interface ActingApprover { name: string; note: string; by: string; at: string }
const actingCfg = createSyncConfig<ActingApprover | null>({ key: 'petty_cash_acting', lsKey: 'inzu_petty_cash_acting', default: null })
export const actingStore = {
  get: actingCfg.get,
  subscribe: actingCfg.subscribe,
  set(name: string, note: string) {
    const v = name.trim()
    actingCfg.set(v ? { name: v, note: note.trim(), by: who(), at: now() } : null)
  },
  clear() { actingCfg.set(null) },
}
export const useActingApprover = () => useSyncExternalStore(actingCfg.subscribe, actingCfg.get, actingCfg.get)

// ── Who can do what ─────────────────────────────────────────────────────
// Authorise & approve: Ops / Asst Ops (either — first to act), admins/MD as a
// fallback when both are out, plus the named acting approver.
const APPROVER_ROLES: RoleKey[] = ['operations_manager', 'asst_operations_manager', 'administrator', 'managing_director']
export function canApprove(role: RoleKey, userName: string): boolean {
  if (APPROVER_ROLES.includes(role)) return true
  const acting = actingCfg.get()
  return !!acting && !!userName && acting.name.trim().toLowerCase() === userName.trim().toLowerCase()
}
/**
 * Authorise: the Assistant Operations Manager's step (admins / MD stand in, as
 * does the named acting approver). When the Asst Ops is on leave the step is
 * skipped instead — see `skipAuthorise`.
 */
const AUTHORISER_ROLES: RoleKey[] = ['asst_operations_manager', 'administrator', 'managing_director']
export function canAuthorise(role: RoleKey, userName: string): boolean {
  if (AUTHORISER_ROLES.includes(role)) return true
  const acting = actingCfg.get()
  return !!acting && !!userName && acting.name.trim().toLowerCase() === userName.trim().toLowerCase()
}
/** Safety Officer is the checker / custodian; admins can stand in. */
export function canCheck(role: RoleKey): boolean {
  return role === 'safety_officer' || ROLES[role].isAdmin
}
/** The reconciliation ledger + disbursing is Safety's job (admins too). */
export function canManageLedger(role: RoleKey): boolean {
  return role === 'safety_officer' || ROLES[role].isAdmin
}
/**
 * "The books" — the reconciliation ledger, the cash balance / arrears figures
 * and the Excel export. Only Safety (custodian), Ops / Asst Ops, admins and the
 * MD see these. Everyone else sees only their own requisitions and what has been
 * paid to them — never the branch float or other people's requests.
 */
const BOOKS_ROLES: RoleKey[] = ['safety_officer', 'operations_manager', 'asst_operations_manager', 'administrator', 'managing_director']
export function canSeePettyBooks(role: RoleKey): boolean {
  return BOOKS_ROLES.includes(role) || ROLES[role].isAdmin
}

// ── Requisition workflow ────────────────────────────────────────────────
export function submitReq(input: RequisitionInput): Requisition {
  return reqStore.add({
    ...input, status: 'pending',
    checked_by: '', checked_at: '', authorised_by: '', authorised_at: '', authorised_skipped: false,
    approved_by: '', approved_at: '', paid_by: '', paid_at: '', paid_amount: 0,
    rejected_by: '', rejected_at: '', rejected_note: '', receipts: [],
  })
}

/** Attach / detach a proof-of-purchase receipt (the file itself lives in fileStore). */
export function addReceipt(reqId: string, rf: ReceiptFile) {
  const req = reqStore.get().find((r) => r.id === reqId)
  reqStore.update(reqId, { receipts: [...(req?.receipts ?? []), rf] })
}
export function removeReceipt(reqId: string, fileId: string) {
  const req = reqStore.get().find((r) => r.id === reqId)
  reqStore.update(reqId, { receipts: (req?.receipts ?? []).filter((f) => f.id !== fileId) })
}
export function checkReq(id: string) { reqStore.update(id, { status: 'checked', checked_by: who(), checked_at: now() }) }
export function authoriseReq(id: string) { reqStore.update(id, { status: 'authorised', authorised_by: who(), authorised_at: now(), authorised_skipped: false }) }
/** Skip the Asst Ops authorisation (used only when the Asst Ops is on leave); stamps who skipped it. */
export function skipAuthorise(id: string) { reqStore.update(id, { status: 'authorised', authorised_by: who(), authorised_at: now(), authorised_skipped: true }) }
export function approveReq(id: string) { reqStore.update(id, { status: 'approved', approved_by: who(), approved_at: now() }) }
export function rejectReq(id: string, note: string) { reqStore.update(id, { status: 'rejected', rejected_by: who(), rejected_at: now(), rejected_note: note.trim() }) }

/** Disburse an approved requisition: mark it paid and post the money-out to the ledger. */
export function payReq(req: Requisition, paidAmount: number) {
  reqStore.update(req.id, { status: 'paid', paid_by: who(), paid_at: now(), paid_amount: paidAmount })
  ledgerStore.add({
    branch: req.branch, date: new Date().toISOString().slice(0, 10),
    direction: 'out', kind: 'disbursement', amount: paidAmount,
    party: req.requester_name, note: req.purpose.slice(0, 80), req_id: req.id,
  })
}

// ── Ledger (money in / out) ─────────────────────────────────────────────
export function addLedger(input: LedgerEntryInput): LedgerEntry {
  return ledgerStore.add(input)
}
export function removeLedger(id: string) { ledgerStore.remove(id) }
