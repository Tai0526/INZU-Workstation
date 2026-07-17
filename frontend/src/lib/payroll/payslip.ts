import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import { esc } from '@/lib/reports/exporter'
import { freepay, type PayLine, type TaxConfig } from './tax'
import type { EmployeeFile } from '@/lib/hr/employeeFile'

/**
 * Payslips — the per-employee statement built from the live pay run. Everything is
 * pulled from one place each: the employee's file (identity, bank, salary +
 * allowances), the leave ledger (rate, days due, days taken, days paid out) and
 * Payroll → Taxes (PAYE bands, NAPSA, NHIS). Nothing is typed twice.
 *
 * Three templates share one builder — only the layout differs:
 *   detailed — the full statement: every YTD figure + the code/detail/payments/
 *              deductions/YTD/outstanding-balance/recoveries table.
 *   standard — the essentials plus YTD amounts.
 *   compact  — a payments-vs-deductions handout for bulk printing.
 */

export type PayslipTemplate = 'detailed' | 'standard' | 'compact'
export const PAYSLIP_TEMPLATES: { key: PayslipTemplate; label: string; blurb: string }[] = [
  { key: 'detailed', label: 'Detailed', blurb: 'Full statement — all YTD figures, leave, and the complete payments / deductions / balances table.' },
  { key: 'standard', label: 'Standard', blurb: 'The essentials plus YTD amounts — one clean page per employee.' },
  { key: 'compact', label: 'Compact', blurb: 'Payments vs deductions and net pay only — a short handout for bulk printing.' },
]

// ── Line codes ─────────────────────────────────────────────────────────
// Matched by allowance name so an employee's "Housing allowance" always prints as
// 004 no matter who typed it; anything unrecognised gets a stable 0NN code.
const ALLOWANCE_CODES: { re: RegExp; code: string }[] = [
  { re: /gratuit/i, code: '002' },
  { re: /transport|travel|fare/i, code: '003' },
  { re: /hous|accommodat|rent/i, code: '004' },
  { re: /lunch|meal|food|subsist/i, code: '005' },
  { re: /overtime/i, code: '006' },
  { re: /respons|acting|special/i, code: '007' },
  { re: /phone|airtime|communicat/i, code: '008' },
]
export const allowanceCode = (name: string, i: number): string => ALLOWANCE_CODES.find((a) => a.re.test(name))?.code ?? String(10 + i).padStart(3, '0')
/** Allowances with a reserved payslip code — offered as one-click adds on the employee file. */
export const STANDARD_ALLOWANCES = ['Gratuity', 'Transport', 'Housing allowance', 'Lunch allowance', 'Overtime', 'Responsibility allowance']
const CODE = { basic: '001', leavePay: '020', paye: '101', napsa: '102', nhis: '103', fine: '201' }

// Department numbers for the payslip's "Dept num" — a sensible default so HR only
// types one when their own numbering differs (file.dept_no overrides).
const DEPT_NO: Record<string, string> = {
  Operations: '10', Workshop: '20', Safety: '30', Fuel: '40', HR: '50', IT: '60', Management: '70', 'General Workers': '80',
}
export const deptNo = (department: string, override: string): string => (override || '').trim() || DEPT_NO[department] || ''

/** Months counted into YTD: the tax year up to and including `month`, but never before `since`. */
export function ytdMonths(month: string, since: string): number {
  const from = (since || '').slice(0, 7)
  const yearStart = `${month.slice(0, 4)}-01`
  const start = from && from > yearStart ? from : yearStart
  if (start > month) return 0
  const [sy, sm] = start.split('-').map(Number)
  const [my, mm] = month.split('-').map(Number)
  return (my - sy) * 12 + (mm - sm) + 1
}

export interface SlipLine {
  code: string
  detail: string
  payment: number
  deduction: number
  ytd: number
  balance: number | null   // outstanding balance — only meaningful on recoverable items
  recovered: number | null // total recoveries to date — ditto
}

export interface Payslip {
  month: string; monthLabel: string; currency: string; branchLabel: string; ytdMonths: number
  // identity
  name: string; employee_no: string; nrc: string; job_title: string; department: string; dept_no: string
  // payment
  pay_method: string; payment_type: string; bank_name: string; bank_account: string; bank_branch: string; social_security: string
  // year to date
  grossYtd: number; taxableYtd: number; freepayYtd: number; taxPaidYtd: number; taxableMonth: number; freepayMonth: number
  // leave
  leaveRate: number; leaveDue: number; leaveTaken: number; leavePaidDays: number; leavePaidAmount: number
  // lines
  lines: SlipLine[]; totalPayments: number; totalDeductions: number; totalRecoveries: number; net: number
}

export interface PayslipInput {
  month: string
  branchLabel: string
  person: { full_name: string; employee_no: string; department: string; role: string }
  file: EmployeeFile
  line: PayLine
  /** A normal month for this salary (no fines, no leave pay-out) — the basis for prior-month YTD. */
  recurring: PayLine
  tax: TaxConfig
  leave: { rate: number; due: number; taken: number; paidDays: number; paidDaysYtd: number }
  fines: { detail: string; amount: number }[]
  /** Fines already recovered earlier in the year (applied deductions). */
  finesRecoveredYtd: number
}

const monthName = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' }) }

export function buildPayslip(inp: PayslipInput): Payslip {
  const { month, file, line, recurring, tax, leave, person } = inp
  const sal = file.salary
  // YTD covers the tax year, or from the hire date if they joined mid-year. It is
  // PROJECTED from the standing salary — no locked runs are stored yet, so a
  // mid-year raise back-dates at the new rate. The salary's `effective` date is
  // deliberately not used: HR sets it when entering the record, which would cut
  // every YTD down to a single month.
  const n = ytdMonths(month, file.start_date)
  const prior = Math.max(0, n - 1)
  const priorLeavePay = Math.max(0, leave.paidDaysYtd - leave.paidDays) * leave.rate

  const grossYtd = recurring.gross * prior + line.gross + priorLeavePay
  const freepayMonth = freepay(line.gross, tax.paye_bands)
  const freepayYtd = freepay(recurring.gross, tax.paye_bands) * prior + freepayMonth
  const taxPaidYtd = recurring.paye * prior + line.paye

  const lines: SlipLine[] = []
  const pay = (code: string, detail: string, amount: number, ytd: number) => lines.push({ code, detail, payment: amount, deduction: 0, ytd, balance: null, recovered: null })
  const ded = (code: string, detail: string, amount: number, ytd: number, balance: number | null = null, recovered: number | null = null) =>
    lines.push({ code, detail, payment: 0, deduction: amount, ytd, balance, recovered })

  pay(CODE.basic, 'Basic pay', line.basic, line.basic * n)
  ;(sal?.allowances ?? []).forEach((a, i) => { if (a.amount) pay(allowanceCode(a.name, i), a.name || 'Allowance', a.amount, a.amount * n) })
  if (line.leavePay > 0) pay(CODE.leavePay, `Leave paid out (${leave.paidDays} day${leave.paidDays === 1 ? '' : 's'} @ ${leave.rate.toLocaleString()})`, line.leavePay, leave.paidDaysYtd * leave.rate)

  ded(CODE.paye, 'PAYE', line.paye, taxPaidYtd)
  ded(CODE.napsa, 'NAPSA', line.napsa, recurring.napsa * prior + line.napsa)
  ded(CODE.nhis, 'NHIS', line.nhima, recurring.nhima * prior + line.nhima)
  // Fines are recoveries: each is settled in full this month, so nothing is left
  // outstanding — the recoveries column carries what has been taken back this year.
  let recovered = inp.finesRecoveredYtd
  for (const f of inp.fines) {
    recovered += f.amount
    ded(CODE.fine, f.detail, f.amount, recovered, 0, f.amount)
  }

  const totalPayments = lines.reduce((s, l) => s + l.payment, 0)
  const totalDeductions = lines.reduce((s, l) => s + l.deduction, 0)
  const totalRecoveries = lines.reduce((s, l) => s + (l.recovered ?? 0), 0)

  return {
    month, monthLabel: monthName(month), currency: sal?.currency || tax.currency || 'ZMW', branchLabel: inp.branchLabel, ytdMonths: n,
    name: person.full_name, employee_no: person.employee_no, nrc: file.national_id, job_title: file.job_title || person.role,
    department: person.department, dept_no: deptNo(person.department, file.dept_no),
    pay_method: file.pay_method || (file.bank_account ? 'Bank transfer' : ''), payment_type: file.payment_type || 'Monthly salary',
    bank_name: file.bank_name, bank_account: file.bank_account, bank_branch: file.bank_branch, social_security: file.napsa,
    grossYtd, taxableYtd: grossYtd, freepayYtd, taxPaidYtd, taxableMonth: line.gross, freepayMonth,
    leaveRate: leave.rate, leaveDue: leave.due, leaveTaken: leave.taken, leavePaidDays: leave.paidDays, leavePaidAmount: line.leavePay,
    lines, totalPayments, totalDeductions, totalRecoveries, net: totalPayments - totalDeductions,
  }
}

// ── Rendering ──────────────────────────────────────────────────────────
// Tables (not CSS grid) for the info panel — Word's HTML engine renders grid
// unreliably, and these slips must survive both "Save as PDF" and .doc editing.
// Prefixed so the same rules can be scoped for the in-app preview.
const payslipCss = (p = '') => `
  ${p}.slip{page-break-after:always;}
  ${p}.slip:last-child{page-break-after:auto;}
  ${p}.sname{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #0F1B33;padding-bottom:6px;margin:0 0 8px;}
  ${p}.sname h3{margin:0;font-size:14px;color:#0F1B33;}
  ${p}.sname em{font-style:normal;color:#6B7280;font-size:11px;}
  ${p}table.sinfo{border-collapse:collapse;width:100%;font-size:10px;margin-bottom:9px;}
  ${p}table.sinfo td{border:1px solid #e5e7eb;padding:4px 7px;vertical-align:top;width:25%;}
  ${p}table.sinfo span{display:block;color:#6B7280;font-size:8px;text-transform:uppercase;letter-spacing:.4px;}
  ${p}table.sinfo b{display:block;color:#0F1B33;font-size:11px;margin-top:1px;}
  ${p}.sechead td{background:#F1F3F7;font-weight:700;color:#0F1B33;font-size:9px;text-transform:uppercase;letter-spacing:.5px;}
  ${p}tr.netrow td{background:#0F1B33;color:#fff;font-weight:700;font-size:12px;}
  ${p}.sfoot{display:flex;justify-content:space-between;gap:20px;margin-top:16px;font-size:10px;color:#6B7280;}
  ${p}.sfoot div{border-top:1px solid #9aa1ad;padding-top:4px;width:44%;}
`
/** Passed to the report exporter, which supplies the base table styling. */
export const PAYSLIP_CSS = payslipCss()

// The in-app preview has no report stylesheet, so it needs the table basics too.
const baseTable = (p: string) => `
  ${p}table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:8px;}
  ${p}th,${p}td{border:1px solid #d0d4dc;padding:5px 8px;text-align:left;color:#0F1B33;}
  ${p}th{background:#0F1B33;color:#fff;font-weight:600;}
  ${p}td.num,${p}th.num{text-align:right;}
  ${p}tr.tot td{background:#F8E7D7;font-weight:700;}
`
/** Scoped styling for a `<div className="pv">` preview of a rendered payslip. */
export const PAYSLIP_PREVIEW_CSS = `.pv{background:#fff;font-family:Arial,Helvetica,sans-serif;}${baseTable('.pv ')}${payslipCss('.pv ')}`

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cell = (label: string, value: string) => `<td><span>${esc(label)}</span><b>${esc(value || '—')}</b></td>`
const trow = (cells: string[]) => `<tr>${cells.join('')}</tr>`
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

function heading(s: Payslip): string {
  return `<div class="sname"><h3>Payslip — ${esc(s.name)}</h3><em>${esc(s.monthLabel)} · ${esc(s.branchLabel)} · ${esc(s.currency)}</em></div>`
}

/** The identity / payment / YTD / leave panel. `full` adds the YTD and leave rows. */
function infoHtml(s: Payslip, full: boolean): string {
  const rows = [
    trow([cell('Company number', s.employee_no), cell('Name', s.name), cell('NRC no', s.nrc), cell('Job title', s.job_title)]),
    trow([cell('Pay method', s.pay_method), cell('Payment type', s.payment_type), cell('Bank name', s.bank_name), cell('Account info', s.bank_account ? `${s.bank_account}${s.bank_branch ? ` · Br ${s.bank_branch}` : ''}` : '')]),
    trow([cell('Social security', s.social_security), cell('Dept num', s.dept_no), cell('Department', s.department), cell('Taxable this month', money(s.taxableMonth))]),
  ]
  if (full) {
    rows.push(trow([cell('Gross pay YTD', money(s.grossYtd)), cell('Taxable YTD', money(s.taxableYtd)), cell('Freepay YTD', money(s.freepayYtd)), cell('Tax paid YTD', money(s.taxPaidYtd))]))
    rows.push(trow([cell('Leave rate', money(s.leaveRate)), cell('Leave days due', String(s.leaveDue)), cell('Leave days taken to date', String(s.leaveTaken)), cell('Leave days paid out', s.leavePaidDays ? `${days(s.leavePaidDays)} · ${money(s.leavePaidAmount)}` : 'None')]))
  }
  return `<table class="sinfo">${rows.join('')}</table>`
}

const num = (v: number | null, blank = '—') => (v === null ? blank : money(v))

/** The full 7-column table from the payslip spec. */
function detailedTable(s: Payslip): string {
  const body = s.lines.map((l) => `<tr><td>${esc(l.code)}</td><td>${esc(l.detail)}</td>
    <td class="num">${l.payment ? money(l.payment) : ''}</td><td class="num">${l.deduction ? money(l.deduction) : ''}</td>
    <td class="num">${money(l.ytd)}</td><td class="num">${num(l.balance, '')}</td><td class="num">${num(l.recovered, '')}</td></tr>`).join('')
  return `<table>
    <thead><tr><th>Code</th><th>Detail</th><th class="num">Payments</th><th class="num">Deductions</th><th class="num">YTD Amount</th><th class="num">Outstanding Balance</th><th class="num">Total recoveries</th></tr></thead>
    <tbody>${body}
      <tr class="tot"><td></td><td>Totals</td><td class="num">${money(s.totalPayments)}</td><td class="num">${money(s.totalDeductions)}</td><td class="num"></td><td class="num"></td><td class="num">${s.totalRecoveries ? money(s.totalRecoveries) : ''}</td></tr>
      <tr class="netrow"><td></td><td>Net pay</td><td class="num">${money(s.net)}</td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td></tr>
    </tbody></table>`
}

/** Code / Detail / Payments / Deductions / YTD — no recoveries columns. */
function standardTable(s: Payslip): string {
  const body = s.lines.map((l) => `<tr><td>${esc(l.code)}</td><td>${esc(l.detail)}</td>
    <td class="num">${l.payment ? money(l.payment) : ''}</td><td class="num">${l.deduction ? money(l.deduction) : ''}</td><td class="num">${money(l.ytd)}</td></tr>`).join('')
  return `<table>
    <thead><tr><th>Code</th><th>Detail</th><th class="num">Payments</th><th class="num">Deductions</th><th class="num">YTD Amount</th></tr></thead>
    <tbody>${body}
      <tr class="tot"><td></td><td>Totals</td><td class="num">${money(s.totalPayments)}</td><td class="num">${money(s.totalDeductions)}</td><td class="num"></td></tr>
      <tr class="netrow"><td></td><td>Net pay</td><td class="num">${money(s.net)}</td><td class="num"></td><td class="num"></td></tr>
    </tbody></table>`
}

/** Payments above, deductions below, net in the bar — the short handout. */
function compactTable(s: Payslip): string {
  const rows = (ls: SlipLine[], col: 'payment' | 'deduction') => ls.filter((l) => l[col] > 0)
    .map((l) => `<tr><td>${esc(l.code)}</td><td>${esc(l.detail)}</td><td class="num">${money(l[col])}</td></tr>`).join('')
  return `<table>
    <thead><tr><th>Code</th><th>Detail</th><th class="num">Amount</th></tr></thead>
    <tbody>
      <tr class="sechead"><td colspan="3">Payments</td></tr>
      ${rows(s.lines, 'payment')}
      <tr class="tot"><td></td><td>Total payments</td><td class="num">${money(s.totalPayments)}</td></tr>
      <tr class="sechead"><td colspan="3">Deductions</td></tr>
      ${rows(s.lines, 'deduction')}
      <tr class="tot"><td></td><td>Total deductions</td><td class="num">${money(s.totalDeductions)}</td></tr>
      <tr class="netrow"><td></td><td>Net pay</td><td class="num">${money(s.net)}</td></tr>
    </tbody></table>`
}

const signatures = `<div class="sfoot"><div>Employee signature &amp; date</div><div>For INZU MCS Limited</div></div>`

/**
 * One payslip as HTML. `heading` prints the employee/month title inside the body —
 * needed when several slips share a document (bulk export).
 */
export function payslipHtml(s: Payslip, template: PayslipTemplate, opts: { heading?: boolean } = {}): string {
  const head = opts.heading ? heading(s) : ''
  if (template === 'compact') {
    return `${head}<table class="sinfo"><tr>${cell('Company number', s.employee_no)}${cell('Name', s.name)}${cell('Dept num', s.dept_no)}${cell('Leave days due', String(s.leaveDue))}</tr></table>${compactTable(s)}`
  }
  if (template === 'standard') return `${head}${infoHtml(s, false)}${standardTable(s)}${signatures}`
  return `${head}${infoHtml(s, true)}${detailedTable(s)}${signatures}`
}

// ── Template preference ────────────────────────────────────────────────
const cfg = createSyncConfig<PayslipTemplate>({
  key: 'payslip_template', lsKey: 'inzu_payslip_template', default: 'detailed',
  merge: (s) => (PAYSLIP_TEMPLATES.some((t) => t.key === s) ? s : 'detailed'),
})
export const payslipTemplateStore = { get: cfg.get, set: (t: PayslipTemplate) => cfg.set(t), subscribe: cfg.subscribe }
export const usePayslipTemplate = () => useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
