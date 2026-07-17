import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import { esc } from '@/lib/reports/exporter'
import { freepay, round2, type PayLine, type TaxConfig } from './tax'
import type { EmployeeFile } from '@/lib/hr/employeeFile'

/**
 * Payslips — the per-employee pay statement built from the live pay run. Every
 * figure is pulled from its one master source: the employee's file (identity,
 * bank, salary + allowances), the leave ledger (days due / taken / paid out) and
 * Payroll → Taxes (PAYE bands, NAPSA, NHIS, gratuity).
 *
 * The layout, codes and rules follow INZU's own statement — the November 2024
 * slip reproduces to the ngwee. Styles share one builder; only the layout differs.
 */

export const COMPANY_NAME = 'INZU MINING CONSTRUCTION AND SUPPLIERS LIMITED'
export const STATEMENT_HEADING = 'PAY STATEMENT FOR THE MONTH ENDING:'

export type PayslipTemplate = 'statement' | 'modern' | 'compact'
export const PAYSLIP_TEMPLATES: { key: PayslipTemplate; label: string; blurb: string }[] = [
  { key: 'statement', label: 'Statement', blurb: "INZU's own layout — the labelled detail block over the full code / payments / deductions / YTD / balances table." },
  { key: 'modern', label: 'Modern', blurb: 'The same figures in a boxed grid — easier to scan, still one page per employee.' },
  { key: 'compact', label: 'Compact', blurb: 'Payments vs deductions and net pay only — a short handout for bulk printing.' },
]

// ── Line codes ─────────────────────────────────────────────────────────
// INZU's scheme: P… = payments, D… = deductions. Allowances are matched by name so
// an employee's "Housing allowance" always prints as P112 no matter who typed it;
// anything unrecognised gets a stable P15N code.
const ALLOWANCE_CODES: { re: RegExp; code: string }[] = [
  { re: /transport|travel|fare/i, code: 'P111' },
  { re: /hous|accommodat|rent/i, code: 'P112' },
  { re: /lunch|meal|food|subsist/i, code: 'P113' },
  { re: /overtime/i, code: 'P114' },
  { re: /respons|acting|special/i, code: 'P115' },
  { re: /phone|airtime|communicat/i, code: 'P116' },
]
export const allowanceCode = (name: string, i: number): string => ALLOWANCE_CODES.find((a) => a.re.test(name))?.code ?? `P${150 + i}`
/** Allowances with a reserved payslip code — offered as one-click adds on the employee file. */
export const STANDARD_ALLOWANCES = ['Transport', 'Housing allowance', 'Lunch allowance', 'Overtime', 'Responsibility allowance']
const CODE = { basic: 'P101', gratuity: 'P005', leavePay: 'P120', paye: 'D101', napsa: 'D002', nhis: 'D006', fine: 'D201' }

/** Gratuity is computed (25% of basic), never a hand-typed allowance — this keeps it from doubling up. */
export const isGratuity = (name: string): boolean => /gratuit/i.test(name || '')

// Department numbers for the statement's "DEPT" — a sensible default so HR only
// types one when their own numbering differs (file.dept_no overrides).
const DEPT_NO: Record<string, string> = {
  Operations: '010', Workshop: '020', Safety: '030', Fuel: '040', HR: '050', IT: '001', Management: '070', 'General Workers': '080',
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
  install: number | null   // outstanding instalment — ditto
  recovered: number | null // total recoveries to date — ditto
}

export interface Payslip {
  month: string; monthLabel: string; currency: string; branchLabel: string; ytdMonths: number
  // identity
  name: string; employee_no: string; nrc: string; job_title: string; department: string; dept_no: string
  pay_point: string; cost_centre: string; salary_scale: string
  // payment
  pay_method: string; payment_type: string; bank_name: string; bank_account: string; bank_branch: string; social_security: string
  // year to date
  grossYtd: number; taxableYtd: number; freepayYtd: number; taxPaidYtd: number; taxableMonth: number; freepayMonth: number
  // leave — `leaveRate` is the ACCRUAL (days earned per month), as on the statement
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
  /** `accrual` = leave days earned per month (the statement's LEAVE RATE); `rate` = what a day costs. */
  leave: { accrual: number; rate: number; due: number; taken: number; paidDays: number; paidDaysYtd: number }
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

  const grossYtd = round2(recurring.gross * prior + line.gross + priorLeavePay)
  const taxableYtd = round2(recurring.taxable * prior + line.taxable + priorLeavePay)
  const freepayMonth = freepay(line.taxable, tax.paye_bands)
  const freepayYtd = round2(freepay(recurring.taxable, tax.paye_bands) * prior + freepayMonth)
  const taxPaidYtd = round2(recurring.paye * prior + line.paye)

  const lines: SlipLine[] = []
  const pay = (code: string, detail: string, amount: number, ytd: number) => lines.push({ code, detail, payment: amount, deduction: 0, ytd: round2(ytd), balance: null, install: null, recovered: null })
  const ded = (code: string, detail: string, amount: number, ytd: number, balance: number | null = null, install: number | null = null, recovered: number | null = null) =>
    lines.push({ code, detail, payment: 0, deduction: amount, ytd: round2(ytd), balance, install, recovered })

  pay(CODE.basic, 'BASIC PAY', line.basic, line.basic * n)
  if (line.gratuity > 0) pay(CODE.gratuity, 'GRATUITY', line.gratuity, line.gratuity * n)
  // Gratuity is computed above, so a hand-typed "Gratuity" allowance is skipped here too.
  ;(sal?.allowances ?? []).forEach((a, i) => { if (a.amount && !isGratuity(a.name)) pay(allowanceCode(a.name, i), (a.name || 'ALLOWANCE').toUpperCase(), a.amount, a.amount * n) })
  if (line.leavePay > 0) pay(CODE.leavePay, `LEAVE PAID OUT (${leave.paidDays} @ ${leave.rate.toLocaleString()})`, line.leavePay, leave.paidDaysYtd * leave.rate)

  ded(CODE.paye, 'PAYE', line.paye, taxPaidYtd)
  ded(CODE.napsa, 'NAPSA', line.napsa, recurring.napsa * prior + line.napsa)
  ded(CODE.nhis, 'NHIS', line.nhima, recurring.nhima * prior + line.nhima)
  // Fines are recoveries: each is settled in full this month, so nothing is left
  // outstanding — the recoveries column carries what has been taken back this year.
  let recovered = inp.finesRecoveredYtd
  for (const f of inp.fines) {
    recovered = round2(recovered + f.amount)
    ded(CODE.fine, (f.detail || 'FINE').toUpperCase(), f.amount, recovered, 0, 0, f.amount)
  }

  const totalPayments = round2(lines.reduce((s, l) => s + l.payment, 0))
  const totalDeductions = round2(lines.reduce((s, l) => s + l.deduction, 0))
  const totalRecoveries = round2(lines.reduce((s, l) => s + (l.recovered ?? 0), 0))

  return {
    month, monthLabel: monthName(month), currency: sal?.currency || tax.currency || 'ZMW', branchLabel: inp.branchLabel, ytdMonths: n,
    name: person.full_name, employee_no: person.employee_no, nrc: file.national_id, job_title: file.job_title || person.role,
    department: person.department, dept_no: deptNo(person.department, file.dept_no),
    pay_point: file.pay_point || inp.branchLabel, cost_centre: file.cost_centre, salary_scale: [sal?.grade, sal?.band].filter(Boolean).join(' · '),
    pay_method: file.pay_method || (file.bank_account ? 'Bank transfer' : ''), payment_type: file.payment_type || 'Monthly salary',
    bank_name: file.bank_name, bank_account: file.bank_account, bank_branch: file.bank_branch, social_security: file.napsa,
    grossYtd, taxableYtd, freepayYtd, taxPaidYtd, taxableMonth: line.taxable, freepayMonth,
    leaveRate: leave.accrual, leaveDue: leave.due, leaveTaken: leave.taken, leavePaidDays: leave.paidDays, leavePaidAmount: line.leavePay,
    lines, totalPayments, totalDeductions, totalRecoveries, net: round2(totalPayments - totalDeductions),
  }
}

// ── Rendering ──────────────────────────────────────────────────────────
// Tables (not CSS grid) for the info panel — Word's HTML engine renders grid
// unreliably, and these slips must survive both "Save as PDF" and .doc editing.
// Prefixed so the same rules can be scoped for the in-app preview.
const payslipCss = (p = '') => `
  ${p}.slip{page-break-after:always;}
  ${p}.slip:last-child{page-break-after:auto;}
  ${p}table.pshead{border-collapse:collapse;width:100%;border:0;margin:0 0 10px;border-bottom:2px solid #0F1B33;}
  ${p}table.pshead td{border:0;padding:0 0 8px;vertical-align:middle;}
  ${p}table.pshead td.logo{width:1%;padding-right:14px;}
  ${p}table.pshead img{max-height:54px;max-width:150px;object-fit:contain;}
  ${p}table.pshead h1{margin:0;font-size:13px;letter-spacing:.4px;color:#0F1B33;}
  ${p}table.pshead h2{margin:4px 0 0;font-size:11px;font-weight:700;letter-spacing:.3px;color:#374151;}
  ${p}table.psinfo{border-collapse:collapse;width:100%;font-size:10px;margin-bottom:8px;}
  ${p}table.psinfo td{border:0;padding:1.5px 5px 1.5px 0;vertical-align:top;}
  ${p}table.psinfo td.l{color:#6B7280;white-space:nowrap;width:16%;letter-spacing:.2px;}
  ${p}table.psinfo td.v{color:#0F1B33;font-weight:700;width:34%;}
  ${p}table.psinfo td.n{text-align:right;padding-right:14px;}
  ${p}.psrule{border-top:1px solid #d0d4dc;margin:0 0 8px;}
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

/** Company logo + name + "PAY STATEMENT FOR THE MONTH ENDING: November, 2024". */
function companyHead(s: Payslip, logo: string): string {
  const [mon, yr] = s.monthLabel.split(' ')
  return `<table class="pshead"><tr>
    ${logo ? `<td class="logo"><img src="${logo}" alt=""></td>` : ''}
    <td><h1>${esc(COMPANY_NAME)}</h1><h2>${STATEMENT_HEADING} ${esc(mon)}, ${esc(yr)}</h2></td>
  </tr></table>`
}

// ── Statement style — INZU's own layout ────────────────────────────────
/** Label/value pairs, two to a row, exactly as they sit on the printed statement. */
function statementInfo(s: Payslip): string {
  const pair = (l1: string, v1: string, l2 = '', v2 = '') =>
    `<tr><td class="l">${esc(l1)}</td><td class="v">${esc(v1 || '')}</td><td class="l">${esc(l2)}</td><td class="v">${esc(v2 || '')}</td></tr>`
  const nums = (l1: string, v1: number, l2: string, v2: string) =>
    `<tr><td class="l">${esc(l1)}</td><td class="v n">${money(v1)}</td><td class="l">${esc(l2)}</td><td class="v n">${esc(v2)}</td></tr>`
  const acct = s.bank_account ? `${s.bank_account}${s.bank_branch ? ` (Br ${s.bank_branch})` : ''}` : ''
  return `<table class="psinfo">
      ${pair('MAN NO:', s.employee_no, 'DEPT:', s.dept_no)}
      ${pair('NAME:', s.name, 'PAY POINT:', s.pay_point)}
      ${pair('NRC NO:', s.nrc, 'COST CENTRE:', s.cost_centre)}
      ${pair('JOB TITLE:', s.job_title, 'PAYMENT TYPE:', s.payment_type)}
      ${pair('PAY METHOD:', s.pay_method, 'SALARY SCALE:', s.salary_scale)}
      ${pair('BANK NAME:', s.bank_name)}
      ${pair('ACCOUNT NO:', acct)}
      ${pair('SOCIAL SECURITY NO:', s.social_security)}
    </table>
    <div class="psrule"></div>
    <table class="psinfo">
      ${nums('GROSS PAY YTD:', s.grossYtd, 'TAXABLE THIS MONTH:', money(s.taxableMonth))}
      ${nums('TAXABLE YTD:', s.taxableYtd, 'LEAVE RATE:', s.leaveRate.toFixed(2))}
      ${nums('FREEPAY YTD:', s.freepayYtd, 'LEAVE DAYS DUE:', s.leaveDue.toFixed(2))}
      ${nums('TAX PAID YTD:', s.taxPaidYtd, 'LEAVE DAYS TAKEN TODATE:', s.leaveTaken.toFixed(2))}
    </table>`
}

/** The eight-column table from the statement, including the recovery columns. */
function statementTable(s: Payslip): string {
  const blank = (v: number | null) => (v === null ? '' : money(v))
  const body = s.lines.map((l) => `<tr><td>${esc(l.code)}</td><td>${esc(l.detail)}</td>
    <td class="num">${l.payment ? money(l.payment) : ''}</td><td class="num">${l.deduction ? money(l.deduction) : ''}</td>
    <td class="num">${money(l.ytd)}</td><td class="num">${blank(l.balance)}</td><td class="num">${blank(l.install)}</td><td class="num">${blank(l.recovered)}</td></tr>`).join('')
  return `<table>
    <thead><tr>
      <th>CODE</th><th>DETAIL</th><th class="num">PAYMENTS</th><th class="num">DEDUCTIONS</th>
      <th class="num">YR TODATE AMOUNT</th><th class="num">OUTSTDNG BALANCE</th><th class="num">OTSTDNG INSTALL</th><th class="num">TOTAL RECOVERIES</th>
    </tr></thead>
    <tbody>${body}
      <tr class="tot"><td></td><td>TOTALS</td><td class="num">${money(s.totalPayments)}</td><td class="num">${money(s.totalDeductions)}</td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num">${s.totalRecoveries ? money(s.totalRecoveries) : ''}</td></tr>
      <tr class="netrow"><td></td><td>NET PAY</td><td class="num">${money(s.net)}</td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td></tr>
    </tbody></table>`
}

/** The Modern style's boxed identity / payment / YTD / leave panel. */
function infoHtml(s: Payslip): string {
  return `<table class="sinfo">
    ${trow([cell('Man no', s.employee_no), cell('Name', s.name), cell('NRC no', s.nrc), cell('Job title', s.job_title)])}
    ${trow([cell('Pay method', s.pay_method), cell('Payment type', s.payment_type), cell('Bank name', s.bank_name), cell('Account no', s.bank_account ? `${s.bank_account}${s.bank_branch ? ` · Br ${s.bank_branch}` : ''}` : '')])}
    ${trow([cell('Social security no', s.social_security), cell('Dept', s.dept_no ? `${s.dept_no} · ${s.department}` : s.department), cell('Salary scale', s.salary_scale), cell('Taxable this month', money(s.taxableMonth))])}
    ${trow([cell('Gross pay YTD', money(s.grossYtd)), cell('Taxable YTD', money(s.taxableYtd)), cell('Freepay YTD', money(s.freepayYtd)), cell('Tax paid YTD', money(s.taxPaidYtd))])}
    ${trow([cell('Leave rate (days/month)', s.leaveRate.toFixed(2)), cell('Leave days due', s.leaveDue.toFixed(2)), cell('Leave days taken todate', s.leaveTaken.toFixed(2)), cell('Leave days paid out', s.leavePaidDays ? `${days(s.leavePaidDays)} · ${money(s.leavePaidAmount)}` : 'None')])}
  </table>`
}

/** Payments / deductions / YTD only — the Modern style's table. */
function modernTable(s: Payslip): string {
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

const signatures = `<div class="sfoot"><div>Employee signature &amp; date</div><div>For ${esc(COMPANY_NAME)}</div></div>`

/**
 * One payslip as HTML. Every style carries the company name, logo and the
 * "PAY STATEMENT FOR THE MONTH ENDING: …" heading. `logo` is a data URL for PDF
 * export, a plain path for the in-app preview, or '' for Word (which renders
 * base64 images unreliably).
 */
export function payslipHtml(s: Payslip, template: PayslipTemplate, opts: { logo?: string } = {}): string {
  const head = companyHead(s, opts.logo ?? '')
  if (template === 'compact') {
    return `${head}<table class="sinfo"><tr>${cell('Man no', s.employee_no)}${cell('Name', s.name)}${cell('Dept', s.dept_no)}${cell('Leave days due', s.leaveDue.toFixed(2))}</tr></table>${compactTable(s)}`
  }
  if (template === 'modern') return `${head}${infoHtml(s)}${modernTable(s)}${signatures}`
  return `${head}${statementInfo(s)}${statementTable(s)}${signatures}`
}

// ── Template preference ────────────────────────────────────────────────
const cfg = createSyncConfig<PayslipTemplate>({
  key: 'payslip_template', lsKey: 'inzu_payslip_template', default: 'statement',
  merge: (s) => (PAYSLIP_TEMPLATES.some((t) => t.key === s) ? s : 'statement'),
})
export const payslipTemplateStore = { get: cfg.get, set: (t: PayslipTemplate) => cfg.set(t), subscribe: cfg.subscribe }
export const usePayslipTemplate = () => useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
