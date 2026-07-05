import * as XS from 'xlsx-js-style'
import { type Requisition, type LedgerEntry, REQ_STATUS_META, LEDGER_KIND_LABEL, balanceOf, arrearsOf, withRunningBalance } from './types'

/**
 * Styled petty-cash workbook for stakeholders — the "books": a requisition
 * register (who requested, how much, how much given, where it is) and a
 * reconciliation ledger with a running balance and a summary of money in/out,
 * current balance and outstanding arrears.
 */

const CLR = { navy: '0F1B33', brand: 'D16B21', tint: 'F8E7D7', grey: 'EEF1F5', border: 'D7DBE3', white: 'FFFFFF', good: '2E7D4F', bad: 'B3261E' }
const FMT = { money: '"K"#,##0.00', int: '#,##0' }
const B = { style: 'thin', color: { rgb: CLR.border } }
const borders = { top: B, bottom: B, left: B, right: B }
const title = { font: { bold: true, sz: 15, color: { rgb: CLR.navy } } }
const sub = { font: { sz: 10, color: { rgb: '6B7280' } } }
const header = { font: { bold: true, color: { rgb: CLR.white } }, fill: { fgColor: { rgb: CLR.navy } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: borders }
const cell = { font: { color: { rgb: CLR.navy } }, alignment: { vertical: 'center', wrapText: true }, border: borders }
const cellC = { ...cell, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } }
const money = { ...cell, alignment: { horizontal: 'right', vertical: 'center' }, numFmt: FMT.money }
const label = { font: { bold: true, color: { rgb: CLR.navy } }, alignment: { horizontal: 'right' } }
const total = { font: { bold: true, color: { rgb: CLR.navy } }, fill: { fgColor: { rgb: CLR.grey } }, alignment: { horizontal: 'right' }, numFmt: FMT.money, border: borders }

const put = (ws: any, r: number, c: number, v: any, s: any) => { ws[XS.utils.encode_cell({ r, c })] = { v, s, ...(typeof v === 'number' ? { t: 'n' } : {}) } }

export function exportPettyCash(opts: { reqs: Requisition[]; ledger: LedgerEntry[]; branchLabel: string }) {
  const wb = XS.utils.book_new()
  const today = new Date().toISOString().slice(0, 10)

  // ── Requisitions register ──
  const rHead = ['Date', 'Requester', 'Department', 'Position', 'Purpose', 'Requested', 'Given', 'Status', 'Authorised by', 'Checked by', 'Approved by']
  const rRows = [...opts.reqs].sort((a, b) => b.date.localeCompare(a.date))
  const wsR: any = {}
  put(wsR, 0, 0, `Petty Cash Requisitions — ${opts.branchLabel}`, title)
  put(wsR, 1, 0, `Generated ${today}`, sub)
  rHead.forEach((h, c) => put(wsR, 3, c, h, header))
  rRows.forEach((q, i) => {
    const r = 4 + i
    put(wsR, r, 0, q.date, cellC)
    put(wsR, r, 1, q.requester_name, cell)
    put(wsR, r, 2, q.department, cell)
    put(wsR, r, 3, q.position, cell)
    put(wsR, r, 4, q.purpose, cell)
    put(wsR, r, 5, q.amount, money)
    put(wsR, r, 6, q.status === 'paid' ? q.paid_amount : 0, money)
    put(wsR, r, 7, REQ_STATUS_META[q.status].label, cellC)
    put(wsR, r, 8, q.authorised_by, cell)
    put(wsR, r, 9, q.checked_by, cell)
    put(wsR, r, 10, q.approved_by, cell)
  })
  const rTotalRow = 4 + rRows.length
  put(wsR, rTotalRow, 4, 'TOTAL', label)
  put(wsR, rTotalRow, 5, rRows.reduce((s, q) => s + q.amount, 0), total)
  put(wsR, rTotalRow, 6, rRows.filter((q) => q.status === 'paid').reduce((s, q) => s + q.paid_amount, 0), total)
  wsR['!ref'] = XS.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rTotalRow, c: 10 } })
  wsR['!cols'] = [{ wch: 11 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 40 }, { wch: 13 }, { wch: 13 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }]
  wsR['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }]
  XS.utils.book_append_sheet(wb, wsR, 'Requisitions')

  // ── Reconciliation ledger ──
  const lRows = withRunningBalance(opts.ledger)
  const bal = balanceOf(opts.ledger)
  const arrears = arrearsOf(opts.ledger)
  const totalIn = opts.ledger.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0)
  const totalOut = opts.ledger.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0)
  const lHead = ['Date', 'Type', 'Detail', 'Party / source', 'Money in', 'Money out', 'Balance']
  const wsL: any = {}
  put(wsL, 0, 0, `Petty Cash Reconciliation — ${opts.branchLabel}`, title)
  put(wsL, 1, 0, `Generated ${today}`, sub)
  // Summary block
  const sum: [string, number][] = [['Current balance', bal], ['Total received', totalIn], ['Total paid out', totalOut], ['Arrears outstanding', arrears]]
  sum.forEach(([k, v], i) => { put(wsL, 3 + i, 0, k, label); put(wsL, 3 + i, 1, v, { ...money, font: { bold: true, color: { rgb: v < 0 || (k === 'Arrears outstanding' && v > 0) ? CLR.bad : CLR.navy } } }) })
  const hr = 8
  lHead.forEach((h, c) => put(wsL, hr, c, h, header))
  lRows.forEach((e, i) => {
    const r = hr + 1 + i
    put(wsL, r, 0, e.date, cellC)
    put(wsL, r, 1, e.direction === 'in' ? 'IN' : 'OUT', cellC)
    put(wsL, r, 2, LEDGER_KIND_LABEL[e.kind] + (e.note ? ` — ${e.note}` : ''), cell)
    put(wsL, r, 3, e.party, cell)
    put(wsL, r, 4, e.direction === 'in' ? e.amount : '', money)
    put(wsL, r, 5, e.direction === 'out' ? e.amount : '', money)
    put(wsL, r, 6, e.balance, { ...money, font: { bold: true, color: { rgb: e.balance < 0 ? CLR.bad : CLR.navy } } })
  })
  const lTotalRow = hr + 1 + lRows.length
  put(wsL, lTotalRow, 3, 'TOTAL', label)
  put(wsL, lTotalRow, 4, totalIn, total)
  put(wsL, lTotalRow, 5, totalOut, total)
  put(wsL, lTotalRow, 6, bal, total)
  wsL['!ref'] = XS.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lTotalRow, c: 6 } })
  wsL['!cols'] = [{ wch: 11 }, { wch: 7 }, { wch: 40 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
  wsL['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }]
  XS.utils.book_append_sheet(wb, wsL, 'Reconciliation')

  XS.writeFile(wb, `Petty Cash - ${opts.branchLabel} (${today}).xlsx`)
}
