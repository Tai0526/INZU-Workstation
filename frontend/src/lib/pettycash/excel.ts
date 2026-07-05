import * as XS from 'xlsx-js-style'
import { type Requisition, type LedgerEntry, type LedgerKind, REQ_STATUS_META, balanceOf, arrearsOf, withRunningBalance } from './types'

/**
 * Accountant-facing petty-cash workbook (imprest / cash-book basis):
 *  1. Reconciliation Statement — balance b/f, receipts, payments, balance c/f.
 *  2. Petty Cash Book — the chronological cash book (Particulars, Receipts,
 *     Payments, Balance) with voucher references.
 *  3. Voucher Register — the requisitions with amounts and authorisations.
 */

const CLR = { navy: '0F1B33', brand: 'D16B21', tint: 'F8E7D7', grey: 'EEF1F5', border: 'D7DBE3', white: 'FFFFFF', bad: 'B3261E' }
const FMT = { money: '"K"#,##0.00' }
const B = { style: 'thin', color: { rgb: CLR.border } }
const borders = { top: B, bottom: B, left: B, right: B }

const S = {
  title: { font: { bold: true, sz: 15, color: { rgb: CLR.navy } } },
  sub: { font: { sz: 10, italic: true, color: { rgb: '6B7280' } } },
  head: { font: { bold: true, color: { rgb: CLR.white } }, fill: { fgColor: { rgb: CLR.navy } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: borders },
  cell: { font: { color: { rgb: CLR.navy } }, alignment: { vertical: 'center', wrapText: true }, border: borders },
  cellC: { font: { color: { rgb: CLR.navy } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: borders },
  money: { font: { color: { rgb: CLR.navy } }, alignment: { horizontal: 'right', vertical: 'center' }, numFmt: FMT.money, border: borders },
  moneyBold: { font: { bold: true, color: { rgb: CLR.navy } }, alignment: { horizontal: 'right', vertical: 'center' }, numFmt: FMT.money, border: borders },
  // statement styles (no borders — a clean statement look)
  section: { font: { bold: true, color: { rgb: CLR.navy } } },
  sLabel: { font: { color: { rgb: CLR.navy } }, alignment: { horizontal: 'left' } },
  sAmt: { font: { color: { rgb: CLR.navy } }, alignment: { horizontal: 'right' }, numFmt: FMT.money },
  sTotalLabel: { font: { bold: true, color: { rgb: CLR.navy } }, alignment: { horizontal: 'left' }, fill: { fgColor: { rgb: CLR.grey } } },
  sTotalAmt: { font: { bold: true, color: { rgb: CLR.navy } }, alignment: { horizontal: 'right' }, numFmt: FMT.money, fill: { fgColor: { rgb: CLR.grey } }, border: { top: { style: 'thin', color: { rgb: CLR.navy } } } },
}
const put = (ws: any, r: number, c: number, v: any, s: any) => { ws[XS.utils.encode_cell({ r, c })] = { v, s, ...(typeof v === 'number' ? { t: 'n' } : {}) } }
const sumBy = (es: LedgerEntry[], dir: 'in' | 'out', kind: LedgerKind) => es.filter((e) => e.direction === dir && e.kind === kind).reduce((s, e) => s + e.amount, 0)

export function exportPettyCash(opts: { reqs: Requisition[]; ledger: LedgerEntry[]; branchLabel: string }) {
  const { reqs, ledger, branchLabel } = opts
  const wb = XS.utils.book_new()
  const today = new Date().toISOString().slice(0, 10)
  const dates = [...ledger.map((e) => e.date), ...reqs.map((r) => r.date)].filter(Boolean).sort()
  const period = dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : today

  const float = sumBy(ledger, 'in', 'float'), topup = sumBy(ledger, 'in', 'topup'), borrowed = sumBy(ledger, 'in', 'borrowed')
  const disb = sumBy(ledger, 'out', 'disbursement'), repay = sumBy(ledger, 'out', 'repayment'), adj = sumBy(ledger, 'out', 'adjustment')
  const receipts = float + topup + borrowed, payments = disb + repay + adj
  const closing = balanceOf(ledger)
  const arrears = arrearsOf(ledger)

  // ── 1. Reconciliation Statement ──
  const wsS: any = {}
  let r = 0
  put(wsS, r++, 0, 'PETTY CASH RECONCILIATION STATEMENT', S.title)
  put(wsS, r++, 0, `${branchLabel} · period ${period} · prepared ${today} · imprest (cash-book) basis`, S.sub)
  r++
  const line = (label: string, amt: number, total = false) => { put(wsS, r, 0, label, total ? S.sTotalLabel : S.sLabel); put(wsS, r, 1, amt, total ? S.sTotalAmt : S.sAmt); r++ }
  line('Balance brought forward (b/f)', 0)
  r++
  put(wsS, r++, 0, 'Add: Receipts', S.section)
  line('   Opening float', float)
  line('   Reimbursements received', topup)
  line('   Borrowed (overdraft cover)', borrowed)
  line('Total receipts', receipts, true)
  r++
  put(wsS, r++, 0, 'Less: Payments', S.section)
  line('   Petty cash disbursements', disb)
  line('   Arrears repayments', repay)
  line('   Adjustments', adj)
  line('Total payments', payments, true)
  r++
  line('Balance carried forward (c/f) — cash on hand', closing, true)
  r += 2
  put(wsS, r++, 0, 'Memoranda', S.section)
  line('   Total requisitions raised', reqs.reduce((s, q) => s + q.amount, 0))
  line('   Requisitions paid (disbursed)', reqs.filter((q) => q.status === 'paid').reduce((s, q) => s + q.paid_amount, 0))
  put(wsS, r, 0, '   Outstanding arrears (payable to lenders)', S.sLabel)
  put(wsS, r, 1, arrears, { ...S.sAmt, font: { color: { rgb: arrears > 0 ? CLR.bad : CLR.navy } } }); r++
  wsS['!ref'] = XS.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r, c: 1 } })
  wsS['!cols'] = [{ wch: 44 }, { wch: 18 }]
  XS.utils.book_append_sheet(wb, wsS, 'Reconciliation')

  // ── 2. Petty Cash Book (chronological cash book) ──
  const book = withRunningBalance(ledger)
  const wsB: any = {}
  put(wsB, 0, 0, `PETTY CASH BOOK — ${branchLabel}`, S.title)
  put(wsB, 1, 0, `Period ${period} · prepared ${today}`, S.sub)
  const bHead = ['Date', 'Voucher', 'Particulars', 'Payee / received from', 'Receipts (Dr)', 'Payments (Cr)', 'Balance']
  bHead.forEach((h, c) => put(wsB, 3, c, h, S.head))
  // opening balance b/f
  put(wsB, 4, 0, dates[0] ?? today, S.cellC); put(wsB, 4, 2, 'Balance brought forward', { ...S.cell, font: { italic: true, color: { rgb: CLR.navy } } })
  put(wsB, 4, 3, '', S.cell); put(wsB, 4, 4, '', S.money); put(wsB, 4, 5, '', S.money); put(wsB, 4, 6, 0, S.moneyBold)
  let vIn = 0, vOut = 0
  book.forEach((e, i) => {
    const row = 5 + i
    const ref = e.req_id ? `PV-${String(++vOut).padStart(3, '0')}` : e.direction === 'in' ? `RV-${String(++vIn).padStart(3, '0')}` : `PV-${String(++vOut).padStart(3, '0')}`
    put(wsB, row, 0, e.date, S.cellC)
    put(wsB, row, 1, ref, S.cellC)
    put(wsB, row, 2, particulars(e.kind, e.note), S.cell)
    put(wsB, row, 3, e.party, S.cell)
    put(wsB, row, 4, e.direction === 'in' ? e.amount : '', S.money)
    put(wsB, row, 5, e.direction === 'out' ? e.amount : '', S.money)
    put(wsB, row, 6, e.balance, { ...S.moneyBold, font: { bold: true, color: { rgb: e.balance < 0 ? CLR.bad : CLR.navy } } })
  })
  const bTot = 5 + book.length
  put(wsB, bTot, 3, 'Balance carried forward (c/f)', S.sTotalLabel)
  put(wsB, bTot, 4, receipts, S.sTotalAmt)
  put(wsB, bTot, 5, payments, S.sTotalAmt)
  put(wsB, bTot, 6, closing, S.sTotalAmt)
  wsB['!ref'] = XS.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: bTot, c: 6 } })
  wsB['!cols'] = [{ wch: 11 }, { wch: 10 }, { wch: 34 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
  XS.utils.book_append_sheet(wb, wsB, 'Petty Cash Book')

  // ── 3. Voucher Register (requisitions) ──
  const wsR: any = {}
  put(wsR, 0, 0, `PETTY CASH VOUCHER REGISTER — ${branchLabel}`, S.title)
  put(wsR, 1, 0, `Period ${period} · prepared ${today}`, S.sub)
  const rHead = ['Voucher', 'Date', 'Payee', 'Department / position', 'Particulars', 'Amount requested', 'Amount paid', 'Checked by', 'Authorised by', 'Approved by', 'Status', 'Receipt on file']
  rHead.forEach((h, c) => put(wsR, 3, c, h, S.head))
  const reg = [...reqs].sort((a, b) => a.date.localeCompare(b.date))
  reg.forEach((q, i) => {
    const row = 4 + i
    put(wsR, row, 0, `PCV-${String(i + 1).padStart(3, '0')}`, S.cellC)
    put(wsR, row, 1, q.date, S.cellC)
    put(wsR, row, 2, q.requester_name, S.cell)
    put(wsR, row, 3, [q.department, q.position].filter(Boolean).join(' · '), S.cell)
    put(wsR, row, 4, q.purpose, S.cell)
    put(wsR, row, 5, q.amount, S.money)
    put(wsR, row, 6, q.status === 'paid' ? q.paid_amount : '', S.money)
    put(wsR, row, 7, q.checked_by, S.cell)
    put(wsR, row, 8, q.authorised_skipped ? 'Skipped (Asst Ops on leave)' : q.authorised_by, S.cell)
    put(wsR, row, 9, q.approved_by, S.cell)
    put(wsR, row, 10, REQ_STATUS_META[q.status].label, S.cellC)
    put(wsR, row, 11, q.receipts && q.receipts.length ? `Yes (${q.receipts.length})` : '—', S.cellC)
  })
  const rTot = 4 + reg.length
  put(wsR, rTot, 4, 'TOTAL', S.sTotalLabel)
  put(wsR, rTot, 5, reg.reduce((s, q) => s + q.amount, 0), S.sTotalAmt)
  put(wsR, rTot, 6, reg.filter((q) => q.status === 'paid').reduce((s, q) => s + q.paid_amount, 0), S.sTotalAmt)
  wsR['!ref'] = XS.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rTot, c: 11 } })
  wsR['!cols'] = [{ wch: 10 }, { wch: 11 }, { wch: 20 }, { wch: 22 }, { wch: 38 }, { wch: 15 }, { wch: 14 }, { wch: 17 }, { wch: 17 }, { wch: 17 }, { wch: 18 }, { wch: 14 }]
  XS.utils.book_append_sheet(wb, wsR, 'Voucher Register')

  XS.writeFile(wb, `Petty Cash - ${branchLabel} (${today}).xlsx`)
}

function particulars(kind: LedgerKind, note: string): string {
  const base: Record<LedgerKind, string> = {
    float: 'Opening float', topup: 'Reimbursement received', borrowed: 'Cash borrowed (overdraft cover)',
    disbursement: 'Being petty cash paid', repayment: 'Arrears repaid', adjustment: 'Adjustment',
  }
  return note ? `${base[kind]} — ${note}` : base[kind]
}
