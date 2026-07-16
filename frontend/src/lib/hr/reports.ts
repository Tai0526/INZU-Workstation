import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import type { BranchCode } from '@/lib/roles'
import { esc } from '@/lib/reports/exporter'

// ── Structured HR report (weekly or monthly) ────────────────────────────
// Models the department's HR report template: staff attendance, recruitment,
// employee relations, training, payroll, H&S, movements, key activities,
// challenges, planned activities and a management summary. The numeric metrics
// are auto-filled from live data for the period (see deriveReportMetrics on the
// page) and stay editable; the narrative fields are entered by the HR officer.
// Persisted as an app_config list (no dedicated table → no migration).

export type HrPeriod = 'weekly' | 'monthly'
export type HrReportStatus = 'draft' | 'final'

export interface HrChallenge { issue: string; action: string }

export interface HrReport {
  id: string
  branch: BranchCode
  period: HrPeriod
  period_start: string // yyyy-mm-dd (inclusive)
  period_end: string   // yyyy-mm-dd (inclusive)
  prepared_by: string
  reviewed_by: string
  status: HrReportStatus

  // 1. Staff attendance
  scheduled: number
  present: number
  absent: number
  sick_leave: number
  annual_leave: number
  compassionate_leave: number
  parental_leave: number // maternity / paternity
  suspended: number
  late_arrivals: number
  attendance_comments: string

  // 2. Recruitment
  vacancies_advertised: number
  applications_received: number
  candidates_shortlisted: number
  interviews_conducted: number
  offers_issued: number
  new_hires: number
  recruitment_comments: string

  // 3. Employee relations
  grievances_received: number
  grievances_resolved: number
  disciplinary_hearings: number
  warning_letters: number
  counselling_sessions: number
  employee_meetings: number
  relations_comments: string

  // 4. Training & development
  training_sessions: number
  employees_trained: number
  safety_briefings: number
  inductions: number
  training_comments: string

  // 5. Payroll & benefits (narrative)
  payroll_updates: string
  records_updated: string
  benefits_activities: string
  overtime_reviewed: string
  leave_records_updated: string

  // 6. Health, safety & compliance
  safety_incidents: number
  safety_investigations: number
  ppe_checks: number
  policy_violations: number
  hsc_comments: string

  // 7. Employee movements
  movements_new: number
  resignations: number
  terminations: number
  transfers: number
  promotions: number
  movements_comments: string

  // 8/9/10 lists + challenges
  key_activities: string[]
  challenges: HrChallenge[]
  planned_activities: string[]

  // Management summary
  total_present: number
  total_absent: number
  outstanding_matters: string
  recommendations: string

  created_by: string; created_at: string; updated_by: string; updated_at: string
}

export type HrReportInput = Omit<HrReport, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

// ── Store (app_config list) ─────────────────────────────────────────────
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `hrr_${Date.now()}_${Math.round(Math.random() * 1e6)}`)
const stampNow = () => new Date().toISOString()
const who = () => getActor().name
const cfg = createSyncConfig<HrReport[]>({ key: 'hr_reports', lsKey: 'inzu_hr_reports', default: [] })

export const hrReportsStore = {
  get: cfg.get,
  subscribe: cfg.subscribe,
  list: () => cfg.get(),
  add(data: HrReportInput): HrReport {
    const now = stampNow()
    const item: HrReport = { ...data, id: newId(), created_by: who(), created_at: now, updated_by: who(), updated_at: now }
    cfg.set([...cfg.get(), item]); return item
  },
  update(id: string, patch: Partial<HrReport>) {
    cfg.set(cfg.get().map((x) => (x.id === id ? { ...x, ...patch, id: x.id, updated_by: who(), updated_at: stampNow() } : x)))
  },
  remove(id: string) { cfg.set(cfg.get().filter((x) => x.id !== id)) },
}
export const useHrReports = () => useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)

// ── Period helpers ──────────────────────────────────────────────────────
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parse = (s: string) => new Date(`${s}T00:00:00`)

/** Monday–Sunday week containing `dateISO`. */
export function weekRange(dateISO: string): { start: string; end: string } {
  const d = parse(dateISO)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // back to Monday
  const s = new Date(d); const e = new Date(d); e.setDate(d.getDate() + 6)
  return { start: iso(s), end: iso(e) }
}
/** First–last day of the month containing `dateISO` (or a yyyy-mm string). */
export function monthRange(monthOrDate: string): { start: string; end: string } {
  const ym = monthOrDate.slice(0, 7)
  const [y, m] = ym.split('-').map(Number)
  return { start: `${ym}-01`, end: iso(new Date(y, m, 0)) }
}
export function rangeFor(period: HrPeriod, anchorISO: string): { start: string; end: string } {
  return period === 'weekly' ? weekRange(anchorISO) : monthRange(anchorISO)
}
const fmtDate = (s: string) => { try { return parse(s).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return s } }
/** Human label for a report's period, e.g. "Week of 13–19 Jul 2026" / "July 2026". */
export function periodLabel(r: Pick<HrReport, 'period' | 'period_start' | 'period_end'>): string {
  if (r.period === 'monthly') return parse(r.period_start).toLocaleDateString('en', { month: 'long', year: 'numeric' })
  const s = parse(r.period_start), e = parse(r.period_end)
  const sameMonth = s.getMonth() === e.getMonth()
  const left = s.toLocaleDateString('en', sameMonth ? { day: '2-digit' } : { day: '2-digit', month: 'short' })
  return `Week of ${left}–${e.toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' })}`
}
/** Does a [start,end] leave/record range overlap the report period? */
export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && bStart <= aEnd

// ── Blank report factory ────────────────────────────────────────────────
export function blankReport(branch: BranchCode, period: HrPeriod, anchorISO: string, preparedBy = ''): HrReportInput {
  const { start, end } = rangeFor(period, anchorISO)
  const z = 0
  return {
    branch, period, period_start: start, period_end: end, prepared_by: preparedBy, reviewed_by: '', status: 'draft',
    scheduled: z, present: z, absent: z, sick_leave: z, annual_leave: z, compassionate_leave: z, parental_leave: z, suspended: z, late_arrivals: z, attendance_comments: '',
    vacancies_advertised: z, applications_received: z, candidates_shortlisted: z, interviews_conducted: z, offers_issued: z, new_hires: z, recruitment_comments: '',
    grievances_received: z, grievances_resolved: z, disciplinary_hearings: z, warning_letters: z, counselling_sessions: z, employee_meetings: z, relations_comments: '',
    training_sessions: z, employees_trained: z, safety_briefings: z, inductions: z, training_comments: '',
    payroll_updates: '', records_updated: '', benefits_activities: '', overtime_reviewed: '', leave_records_updated: '',
    safety_incidents: z, safety_investigations: z, ppe_checks: z, policy_violations: z, hsc_comments: '',
    movements_new: z, resignations: z, terminations: z, transfers: z, promotions: z, movements_comments: '',
    key_activities: [], challenges: [], planned_activities: [],
    total_present: z, total_absent: z, outstanding_matters: '', recommendations: '',
  }
}

// ── Metric layout (single source of truth for form + exports) ───────────
export interface MetricField { key: keyof HrReport; label: string }
export interface MetricSection { title: string; fields: MetricField[]; comment?: keyof HrReport }
export const METRIC_SECTIONS: MetricSection[] = [
  { title: '1. Staff attendance', comment: 'attendance_comments', fields: [
    { key: 'scheduled', label: 'Employees scheduled' }, { key: 'present', label: 'Present' }, { key: 'absent', label: 'Absent' },
    { key: 'sick_leave', label: 'Sick leave' }, { key: 'annual_leave', label: 'Annual leave' }, { key: 'compassionate_leave', label: 'Compassionate leave' },
    { key: 'parental_leave', label: 'Maternity / paternity leave' }, { key: 'suspended', label: 'Suspended employees' }, { key: 'late_arrivals', label: 'Late arrivals' },
  ] },
  { title: '2. Recruitment activities', comment: 'recruitment_comments', fields: [
    { key: 'vacancies_advertised', label: 'Vacancies advertised' }, { key: 'applications_received', label: 'Applications received' }, { key: 'candidates_shortlisted', label: 'Candidates shortlisted' },
    { key: 'interviews_conducted', label: 'Interviews conducted' }, { key: 'offers_issued', label: 'Job offers issued' }, { key: 'new_hires', label: 'New employees hired' },
  ] },
  { title: '3. Employee relations', comment: 'relations_comments', fields: [
    { key: 'grievances_received', label: 'Grievances received' }, { key: 'grievances_resolved', label: 'Grievances resolved' }, { key: 'disciplinary_hearings', label: 'Disciplinary hearings conducted' },
    { key: 'warning_letters', label: 'Warning letters issued' }, { key: 'counselling_sessions', label: 'Counselling sessions conducted' }, { key: 'employee_meetings', label: 'Employee meetings held' },
  ] },
  { title: '4. Training & development', comment: 'training_comments', fields: [
    { key: 'training_sessions', label: 'Training sessions conducted' }, { key: 'employees_trained', label: 'Employees trained' }, { key: 'safety_briefings', label: 'Safety briefings conducted' }, { key: 'inductions', label: 'Employee inductions conducted' },
  ] },
  { title: '6. Health, safety & compliance', comment: 'hsc_comments', fields: [
    { key: 'safety_incidents', label: 'Safety incidents reported' }, { key: 'safety_investigations', label: 'Safety investigations conducted' }, { key: 'ppe_checks', label: 'PPE compliance checks conducted' }, { key: 'policy_violations', label: 'Policy violations reported' },
  ] },
  { title: '7. Employee movements', comment: 'movements_comments', fields: [
    { key: 'movements_new', label: 'New employees' }, { key: 'resignations', label: 'Resignations' }, { key: 'terminations', label: 'Terminations' }, { key: 'transfers', label: 'Transfers' }, { key: 'promotions', label: 'Promotions' },
  ] },
]
// 5. Payroll & benefits — narrative fields
export const PAYROLL_FIELDS: MetricField[] = [
  { key: 'payroll_updates', label: 'Payroll updates processed' }, { key: 'records_updated', label: 'Employee records updated' },
  { key: 'benefits_activities', label: 'Benefits administration activities' }, { key: 'overtime_reviewed', label: 'Overtime records reviewed' }, { key: 'leave_records_updated', label: 'Leave records updated' },
]

// ── Formal document (HTML body) for exportReportPDF / exportReportWord ──
function tbl(rows: [string, string | number][]): string {
  return `<table><tbody>${rows.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="num">${esc(v)}</td></tr>`).join('')}</tbody></table>`
}
function comments(v: string): string { return v.trim() ? `<div class="kv"><b>Comments:</b> ${esc(v)}</div>` : '' }
function orderedList(items: string[]): string {
  const rows = items.filter((x) => x.trim())
  if (!rows.length) return '<div class="kv" style="color:#6B7280">None recorded.</div>'
  return `<table><tbody>${rows.map((t, i) => `<tr><td class="num" style="width:26px">${i + 1}</td><td>${esc(t)}</td></tr>`).join('')}</tbody></table>`
}

/** Build the full formal HR report as HTML for the PDF / Word exporter. */
export function reportBodyHtml(r: HrReport): string {
  const kv = (pairs: [string, string][]) => `<div class="kv">${pairs.map(([l, v]) => `<span><b>${esc(l)}:</b> ${esc(v || '—')}</span>`).join('')}</div>`
  const narrative = (pairs: [string, string][]) => `<table><tbody>${pairs.map(([l, v]) => `<tr><td style="width:38%">${esc(l)}</td><td>${esc(v || '—')}</td></tr>`).join('')}</tbody></table>`

  return [
    kv([['Period', periodLabel(r)], ['From', fmtDate(r.period_start)], ['To', fmtDate(r.period_end)], ['Department', 'Human Resources'], ['Status', r.status === 'final' ? 'Final' : 'Draft']]),

    '<h2>1. Staff attendance</h2>',
    tbl([['Employees scheduled', r.scheduled], ['Present', r.present], ['Absent', r.absent], ['Sick leave', r.sick_leave], ['Annual leave', r.annual_leave], ['Compassionate leave', r.compassionate_leave], ['Maternity / paternity leave', r.parental_leave], ['Suspended employees', r.suspended], ['Late arrivals', r.late_arrivals]]),
    comments(r.attendance_comments),

    '<h2>2. Recruitment activities</h2>',
    tbl([['Vacancies advertised', r.vacancies_advertised], ['Applications received', r.applications_received], ['Candidates shortlisted', r.candidates_shortlisted], ['Interviews conducted', r.interviews_conducted], ['Job offers issued', r.offers_issued], ['New employees hired', r.new_hires]]),
    comments(r.recruitment_comments),

    '<h2>3. Employee relations</h2>',
    tbl([['Grievances received', r.grievances_received], ['Grievances resolved', r.grievances_resolved], ['Disciplinary hearings conducted', r.disciplinary_hearings], ['Warning letters issued', r.warning_letters], ['Counselling sessions conducted', r.counselling_sessions], ['Employee meetings held', r.employee_meetings]]),
    comments(r.relations_comments),

    '<h2>4. Training & development</h2>',
    tbl([['Training sessions conducted', r.training_sessions], ['Employees trained', r.employees_trained], ['Safety briefings conducted', r.safety_briefings], ['Employee inductions conducted', r.inductions]]),
    comments(r.training_comments),

    '<h2>5. Payroll & benefits</h2>',
    narrative([['Payroll updates processed', r.payroll_updates], ['Employee records updated', r.records_updated], ['Benefits administration activities', r.benefits_activities], ['Overtime records reviewed', r.overtime_reviewed], ['Leave records updated', r.leave_records_updated]]),

    '<h2>6. Health, safety & compliance</h2>',
    tbl([['Safety incidents reported', r.safety_incidents], ['Safety investigations conducted', r.safety_investigations], ['PPE compliance checks conducted', r.ppe_checks], ['Policy violations reported', r.policy_violations]]),
    comments(r.hsc_comments),

    '<h2>7. Employee movements</h2>',
    tbl([['New employees', r.movements_new], ['Resignations', r.resignations], ['Terminations', r.terminations], ['Transfers', r.transfers], ['Promotions', r.promotions]]),
    comments(r.movements_comments),

    '<h2>8. Key activities completed</h2>',
    orderedList(r.key_activities),

    '<h2>9. Challenges / issues requiring management attention</h2>',
    r.challenges.filter((c) => c.issue.trim() || c.action.trim()).length
      ? `<table><thead><tr><th style="width:50%">Issue</th><th>Action required</th></tr></thead><tbody>${r.challenges.filter((c) => c.issue.trim() || c.action.trim()).map((c) => `<tr><td>${esc(c.issue)}</td><td>${esc(c.action)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="kv" style="color:#6B7280">None recorded.</div>',

    `<h2>10. Planned activities for the next ${r.period === 'monthly' ? 'month' : 'week'}</h2>`,
    orderedList(r.planned_activities),

    '<h2>Management summary</h2>',
    tbl([['Total employees present', r.total_present], ['Total employees absent', r.total_absent]]),
    r.outstanding_matters.trim() ? `<div class="kv"><b>Outstanding HR matters:</b> ${esc(r.outstanding_matters)}</div>` : '',
    r.recommendations.trim() ? `<div class="kv"><b>Recommendations:</b> ${esc(r.recommendations)}</div>` : '',

    `<table style="margin-top:18px"><tbody>
      <tr><td style="width:50%">Prepared by (HR Officer): <b>${esc(r.prepared_by || '')}</b></td><td>Reviewed by: <b>${esc(r.reviewed_by || '')}</b></td></tr>
      <tr><td style="height:34px">Signature: __________________________</td><td>Signature: __________________________</td></tr>
      <tr><td>Date: ______________________</td><td>Date: ______________________</td></tr>
    </tbody></table>`,
  ].join('\n')
}
