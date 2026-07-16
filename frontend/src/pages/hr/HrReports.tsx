import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { FileText, Plus, Pencil, Trash2, Wand2, X, FileDown, FileSpreadsheet, Printer, CalendarRange } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { BRANCHES, type BranchCode } from '@/lib/roles'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import Modal from '@/components/ui/Modal'
import { exportReportPDF, exportReportWord } from '@/lib/reports/exporter'
import { useHrPeople, type HrPerson } from '@/lib/hr/directory'
import { useDriverLeave } from '@/lib/drivers/leave'
import { useEmployeeLeave } from '@/lib/hr/leave'
import { useLeaveLedger } from '@/lib/hr/leaveLedger'
import { useDrivers } from '@/lib/drivers/store'
import { useCases } from '@/lib/safety/cases'
import { useTraining, useCompliance } from '@/lib/safety/registers'
import {
  useHrReports, hrReportsStore, blankReport, periodLabel, reportBodyHtml, rangeFor, overlaps,
  METRIC_SECTIONS, PAYROLL_FIELDS, type HrReport, type HrPeriod, type HrChallenge,
} from '@/lib/hr/reports'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const numCls = 'w-full rounded-lg border border-black/15 bg-white px-2 py-1.5 text-sm text-navy outline-none focus:border-brand'
const fmt = (iso: string) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso } }
const daysInclusive = (a: string, b: string) => Math.max(1, Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000) + 1)
const WARNING_DECISIONS = ['verbal_warning', 'written_warning', 'final_written_warning']

export default function HrReports() {
  const { user } = useAuth()
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short

  const people = useHrPeople(branch)
  const driverLeave = useDriverLeave()
  const empLeave = useEmployeeLeave()
  const ledger = useLeaveLedger().filter((e) => e.branch === branch)
  const drivers = useDrivers().filter((d) => d.branch === branch)
  const cases = useCases().filter((c) => c.branch === branch)
  const training = useTraining().filter((t) => t.branch === branch)
  const compliance = useCompliance().filter((c) => c.branch === branch)
  const reports = useHrReports().filter((r) => r.branch === branch)
  const today = new Date().toISOString().slice(0, 10)

  const [newOpen, setNewOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [periodFilter, setPeriodFilter] = useState<'all' | HrPeriod>('all')

  const editing = editingId ? reports.find((r) => r.id === editingId) ?? null : null

  // ── Auto-fill: derive what live data can tell us for a report's date range ──
  function deriveMetrics(start: string, end: string): Partial<HrReport> {
    const inR = (d?: string) => !!d && d.slice(0, 10) >= start && d.slice(0, 10) <= end
    const active = people.filter((p) => p.status === 'active').length
    // Leave split by type, from the leave ledger (people with any spell overlapping the period).
    const leaveInPeriod = ledger.filter((e) => e.kind === 'leave' && overlaps(e.start, e.end, start, end))
    const peopleWith = (types: string[]) => new Set(leaveInPeriod.filter((e) => types.includes(e.type)).map((e) => e.person_id)).size
    const onLeave = new Set(leaveInPeriod.map((e) => e.person_id)).size
    const suspended = drivers.filter((d) => (d.status as string) === 'suspended').length
    const present = Math.max(0, active - onLeave - suspended)
    const hired = drivers.filter((d) => inR(d.date_hired)).length
    const incidents = cases.filter((c) => inR(c.event_datetime)).length
    const verdicts = cases.filter((c) => c.verdict?.outcome === 'approved' && inR(c.verdict.decided_at))
    const decisions = verdicts.flatMap((c) => (c.verdict!.decisions as string[]))
    const trainings = training.filter((t) => inR(t.issued)).length
    const inductions = compliance.filter((c) => /induction/i.test(c.category) && inR(c.issued)).length
    return {
      scheduled: active, present, suspended,
      sick_leave: peopleWith(['sick']), annual_leave: peopleWith(['annual']), compassionate_leave: peopleWith(['compassionate']), parental_leave: peopleWith(['maternity', 'paternity']),
      new_hires: hired, movements_new: hired,
      safety_incidents: incidents,
      disciplinary_hearings: verdicts.length,
      warning_letters: decisions.filter((d) => WARNING_DECISIONS.includes(d)).length,
      counselling_sessions: decisions.filter((d) => d === 'counselling').length,
      training_sessions: trainings, employees_trained: trainings, inductions,
      total_present: present, total_absent: Math.max(0, active - present),
    }
  }
  function onLeaveCount(start: string, end: string): number {
    return new Set(ledger.filter((e) => e.kind === 'leave' && overlaps(e.start, e.end, start, end)).map((e) => e.person_id)).size
  }

  function createReport(period: HrPeriod, anchor: string) {
    const r = hrReportsStore.add(blankReport(branch, period, anchor, user!.fullName.replace(/\s*\(demo\)$/, '')))
    setNewOpen(false); setEditingId(r.id)
  }

  const rows = reports
    .filter((r) => periodFilter === 'all' || r.period === periodFilter)
    .sort((a, b) => b.period_start.localeCompare(a.period_start) || b.created_at.localeCompare(a.created_at))

  function exportAllExcel() {
    const flat = rows.map((r) => {
      const rec: Record<string, string | number> = { Period: r.period === 'monthly' ? 'Monthly' : 'Weekly', From: r.period_start, To: r.period_end, Status: r.status }
      METRIC_SECTIONS.forEach((s) => s.fields.forEach((f) => { rec[f.label] = Number(r[f.key] as number) || 0 }))
      rec['Total present'] = r.total_present; rec['Total absent'] = r.total_absent; rec['Prepared by'] = r.prepared_by
      return rec
    })
    const ws = XLSX.utils.json_to_sheet(flat.length ? flat : [{ Period: 'No reports' }])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'HR Reports')
    XLSX.writeFile(wb, `INZU_HR_Reports_${branchLabel.replace(/\s+/g, '_')}_${today}.xlsx`)
  }

  // ── Live snapshot (reference) ──
  const byDept = useMemo(() => {
    const m = new Map<string, { total: number; active: number }>()
    for (const p of people) { const r = m.get(p.department) ?? { total: 0, active: 0 }; r.total++; if (p.status === 'active') r.active++; m.set(p.department, r) }
    return [...m.entries()].map(([dept, v]) => ({ dept, ...v })).sort((a, b) => b.total - a.total)
  }, [people])
  const leaveRows = useMemo(() => {
    const byId = new Map(people.map((p) => [p.id, p] as [string, HrPerson]))
    const out: { name: string; role: string; from: string; to: string; days: number; status: string }[] = []
    const add = (id: string, lp: { start: string; end: string }, src: 'driver' | 'emp') => {
      const p = byId.get(id); if (!p || (src === 'driver' && p.source !== 'driver')) return
      const status = lp.start <= today && today <= lp.end ? 'On leave' : lp.start > today ? 'Upcoming' : 'Ended'
      out.push({ name: p.full_name, role: p.role, from: lp.start, to: lp.end, days: daysInclusive(lp.start, lp.end), status })
    }
    for (const [id, lp] of Object.entries(driverLeave)) add(id, lp, 'driver')
    for (const [id, lp] of Object.entries(empLeave)) add(id, lp, 'emp')
    return out.sort((a, b) => b.from.localeCompare(a.from))
  }, [people, driverLeave, empLeave, today])

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="max-w-2xl text-sm text-status-neutral">
          Structured <span className="font-medium text-navy">weekly &amp; monthly HR reports</span> for {branchLabel}. Create one for a period — the attendance, movement, training and incident numbers auto-fill from live data; add the narrative, then export a signed PDF or an editable Word document.
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportAllExcel} disabled={rows.length === 0}><FileSpreadsheet size={15} /> Reports to Excel</Button>
          <Button onClick={() => setNewOpen(true)}><Plus size={15} /> New report</Button>
        </div>
      </div>

      {/* Saved reports */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <CalendarRange size={16} className="text-brand" />
          <h3 className="font-display text-sm font-bold text-navy">HR reports</h3>
          <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-black/15">
            {(['all', 'weekly', 'monthly'] as const).map((k) => (
              <button key={k} onClick={() => setPeriodFilter(k)} className={`px-3 py-1.5 text-xs font-medium ${periodFilter === k ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas'}`}>{k === 'all' ? 'All' : k === 'weekly' ? 'Weekly' : 'Monthly'}</button>
            ))}
          </div>
        </div>
        <div className="max-h-[22rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white"><tr>
              <th className="px-4 py-2.5 font-medium">Period</th><th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Prepared by</th><th className="px-4 py-2.5 font-medium">Present / Absent</th>
              <th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5" />
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-4 py-2 font-medium text-navy">{periodLabel(r)}<div className="text-[11px] font-normal text-status-neutral">{fmt(r.period_start)} – {fmt(r.period_end)}</div></td>
                  <td className="px-4 py-2 text-status-neutral">{r.period === 'monthly' ? 'Monthly' : 'Weekly'}</td>
                  <td className="px-4 py-2 text-status-neutral">{r.prepared_by || '—'}</td>
                  <td className="px-4 py-2 text-status-neutral">{r.total_present} / {r.total_absent}</td>
                  <td className="px-4 py-2"><StatusBadge tone={r.status === 'final' ? 'good' : 'warning'}>{r.status === 'final' ? 'Final' : 'Draft'}</StatusBadge></td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => exportReportPDF({ title: `HR ${r.period === 'monthly' ? 'Monthly' : 'Weekly'} Report — ${branchLabel}`, subtitle: periodLabel(r), body: reportBodyHtml(r), filenameBase: `HR Report ${r.period_start}` })} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Export PDF"><Printer size={15} /></button>
                      <button onClick={() => exportReportWord({ title: `HR ${r.period === 'monthly' ? 'Monthly' : 'Weekly'} Report — ${branchLabel}`, subtitle: periodLabel(r), body: reportBodyHtml(r), filenameBase: `HR Report ${r.period_start}` })} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Export Word"><FileDown size={15} /></button>
                      <button onClick={() => setEditingId(r.id)} className="inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-xs font-medium text-navy hover:bg-canvas"><Pencil size={12} /> Open</button>
                      <button onClick={() => window.confirm('Delete this report?') && hrReportsStore.remove(r.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical" title="Delete"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-status-neutral"><FileText size={22} className="mx-auto mb-2 text-status-neutral/60" />No reports yet. Create a weekly or monthly report to get started.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live snapshot (reference) */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">Headcount by department <span className="font-normal text-status-neutral">· live</span></h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-status-neutral"><tr><th className="px-5 py-2 font-medium">Department</th><th className="px-4 py-2 text-right font-medium">Total</th><th className="px-4 py-2 text-right font-medium">Active</th></tr></thead>
              <tbody>
                {byDept.map((d) => (
                  <tr key={d.dept} className="border-t border-black/5"><td className="px-5 py-2 font-medium text-navy">{d.dept}</td><td className="px-4 py-2 text-right text-navy">{d.total}</td><td className="px-4 py-2 text-right text-status-neutral">{d.active}</td></tr>
                ))}
                {byDept.length > 0 && <tr className="border-t-2 border-navy/20 bg-canvas font-medium text-navy"><td className="px-5 py-2">Total</td><td className="px-4 py-2 text-right">{people.length}</td><td className="px-4 py-2 text-right">{people.filter((p) => p.status === 'active').length}</td></tr>}
                {byDept.length === 0 && <tr><td colSpan={3} className="px-4 py-10 text-center text-sm text-status-neutral">No people on record.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">Leave register <span className="font-normal text-status-neutral">· live</span></h3></div>
          <div className="max-h-[20rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-navy text-white"><tr><th className="px-4 py-2.5 font-medium">Name</th><th className="px-4 py-2.5 font-medium">From</th><th className="px-4 py-2.5 font-medium">To</th><th className="px-4 py-2.5 font-medium">Days</th><th className="px-4 py-2.5 font-medium">Status</th></tr></thead>
              <tbody>
                {leaveRows.map((r, i) => (
                  <tr key={`${r.name}-${r.from}-${i}`} className={i % 2 ? 'bg-canvas/40' : ''}><td className="px-4 py-2 font-medium text-navy">{r.name}<div className="text-[11px] font-normal text-status-neutral">{r.role}</div></td><td className="px-4 py-2 text-status-neutral">{fmt(r.from)}</td><td className="px-4 py-2 text-status-neutral">{fmt(r.to)}</td><td className="px-4 py-2 text-status-neutral">{r.days}</td><td className="px-4 py-2"><StatusBadge tone={r.status === 'On leave' ? 'warning' : r.status === 'Upcoming' ? 'neutral' : 'good'}>{r.status}</StatusBadge></td></tr>
                ))}
                {leaveRows.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-status-neutral">No leave on record.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <NewReportModal open={newOpen} onClose={() => setNewOpen(false)} onCreate={createReport} />
      {editing && (
        <ReportBuilder
          report={editing}
          branchLabel={branchLabel}
          derived={deriveMetrics(editing.period_start, editing.period_end)}
          onLeaveHint={onLeaveCount(editing.period_start, editing.period_end)}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  )
}

// ── New report — pick weekly/monthly + period ───────────────────────────
function NewReportModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (p: HrPeriod, anchor: string) => void }) {
  const [period, setPeriod] = useState<HrPeriod>('weekly')
  const [anchor, setAnchor] = useState(new Date().toISOString().slice(0, 10))
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setPeriod('weekly'); setAnchor(new Date().toISOString().slice(0, 10)); setMonth(new Date().toISOString().slice(0, 7)) }
  if (!open && wasOpen) setWasOpen(false)
  if (!open) return null
  const rng = rangeFor(period, period === 'weekly' ? anchor : `${month}-01`)
  return (
    <Modal open={open} onClose={onClose} title="New HR report" subtitle="Choose the period — the report's numbers auto-fill from live data for that range."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => onCreate(period, period === 'weekly' ? anchor : `${month}-01`)}><Plus size={15} /> Create &amp; open</Button></>}>
      <div className="space-y-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
          {(['weekly', 'monthly'] as HrPeriod[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-4 py-2 text-sm font-medium ${period === p ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas'}`}>{p === 'weekly' ? 'Weekly' : 'Monthly'}</button>
          ))}
        </div>
        {period === 'weekly' ? (
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Any day in the week</span><input type="date" className={inputCls} value={anchor} onChange={(e) => setAnchor(e.target.value)} /></label>
        ) : (
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Month</span><input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        )}
        <p className="rounded-lg bg-canvas px-3 py-2 text-[11px] text-status-neutral">Covers <b className="text-navy">{fmt(rng.start)} → {fmt(rng.end)}</b>.</p>
      </div>
    </Modal>
  )
}

// ── Report builder (full form) ──────────────────────────────────────────
function ReportBuilder({ report, branchLabel, derived, onLeaveHint, onClose }: {
  report: HrReport; branchLabel: string; derived: Partial<HrReport>; onLeaveHint: number; onClose: () => void
}) {
  const [form, setForm] = useState<HrReport>(report)
  const [key, setKey] = useState('')
  if (key !== report.id) { setKey(report.id); setForm(report) }
  const set = (k: keyof HrReport, v: any) => setForm((p) => ({ ...p, [k]: v }))

  function autofill() { setForm((p) => ({ ...p, ...derived })) }
  function save(status?: HrReport['status']) { hrReportsStore.update(report.id, { ...form, ...(status ? { status } : {}) }); onClose() }
  const reportNow = (): HrReport => ({ ...form })
  const title = `HR ${form.period === 'monthly' ? 'Monthly' : 'Weekly'} Report — ${branchLabel}`
  const fileBase = `HR Report ${form.period_start}`

  const numField = (k: keyof HrReport, label: string) => (
    <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">{label}</span>
      <input type="number" min={0} className={numCls} value={form[k] === 0 ? '0' : (form[k] as number) || ''} onChange={(e) => set(k, Number(e.target.value))} /></label>
  )
  const textArea = (k: keyof HrReport, label: string, rows = 2) => (
    <label className="block"><span className="mb-1 block text-xs font-medium text-navy">{label}</span>
      <textarea className={inputCls} rows={rows} value={form[k] as string} onChange={(e) => set(k, e.target.value)} /></label>
  )

  return (
    <Modal open onClose={onClose} size="xl" title={`${form.period === 'monthly' ? 'Monthly' : 'Weekly'} HR report`} subtitle={`${periodLabel(form)} · ${fmt(form.period_start)} → ${fmt(form.period_end)}`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => exportReportPDF({ title, subtitle: periodLabel(form), body: reportBodyHtml(reportNow()), filenameBase: fileBase })}><Printer size={15} /> PDF</Button>
            <Button variant="secondary" onClick={() => exportReportWord({ title, subtitle: periodLabel(form), body: reportBodyHtml(reportNow()), filenameBase: fileBase })}><FileDown size={15} /> Word</Button>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="secondary" onClick={() => save('draft')}>Save draft</Button>
            <Button onClick={() => save('final')}>Save as final</Button>
          </div>
        </div>
      }>
      <div className="space-y-4">
        {/* Meta + autofill */}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-black/10 bg-canvas/50 p-3">
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Prepared by</span><input className={`${inputCls} sm:w-52`} value={form.prepared_by} onChange={(e) => set('prepared_by', e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Reviewed by</span><input className={`${inputCls} sm:w-52`} value={form.reviewed_by} onChange={(e) => set('reviewed_by', e.target.value)} /></label>
          <Button variant="secondary" className="ml-auto" onClick={autofill}><Wand2 size={15} /> Auto-fill from live data</Button>
        </div>
        <p className="text-[11px] text-status-neutral">Auto-fill pulls headcount, on-leave, driver hires, incidents, disciplinary actions, training &amp; inductions for this period. It won't overwrite your narrative — review and adjust the numbers before finalising.</p>

        {/* Metric sections (numbers) */}
        {METRIC_SECTIONS.map((s) => (
          <div key={s.title} className="rounded-xl border border-black/10 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">{s.title}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {s.fields.map((f) => <div key={f.key as string}>{numField(f.key, f.label)}</div>)}
            </div>
            {s.title.startsWith('1.') && <p className="mt-1.5 text-[11px] text-[#8a6d10]">Live: <b>{onLeaveHint}</b> {onLeaveHint === 1 ? 'person' : 'people'} on leave overlapping this period — split into the leave types above (types aren’t tracked automatically).</p>}
            {s.comment && <div className="mt-2">{textArea(s.comment, 'Comments')}</div>}
          </div>
        ))}

        {/* 5. Payroll & benefits (narrative) */}
        <div className="rounded-xl border border-black/10 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">5. Payroll &amp; benefits</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{PAYROLL_FIELDS.map((f) => <div key={f.key as string}>{textArea(f.key, f.label, 1)}</div>)}</div>
        </div>

        {/* 8. Key activities */}
        <div className="rounded-xl border border-black/10 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">8. Key activities completed</div>
          <ListEditor items={form.key_activities} onChange={(v) => set('key_activities', v)} placeholder="Describe a key activity…" />
        </div>

        {/* 9. Challenges */}
        <div className="rounded-xl border border-black/10 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">9. Challenges / issues requiring management attention</div>
          <ChallengeEditor items={form.challenges} onChange={(v) => set('challenges', v)} />
        </div>

        {/* 10. Planned activities */}
        <div className="rounded-xl border border-black/10 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">10. Planned activities for the next {form.period === 'monthly' ? 'month' : 'week'}</div>
          <ListEditor items={form.planned_activities} onChange={(v) => set('planned_activities', v)} placeholder="Describe a planned activity…" />
        </div>

        {/* Management summary */}
        <div className="rounded-xl border border-black/10 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">Management summary</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {numField('total_present', 'Total present')}
            {numField('total_absent', 'Total absent')}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2">{textArea('outstanding_matters', 'Outstanding HR matters')}{textArea('recommendations', 'Recommendations')}</div>
        </div>
      </div>
    </Modal>
  )
}

function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const set = (i: number, v: string) => onChange(items.map((x, idx) => (idx === i ? v : x)))
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-right text-xs text-status-neutral">{i + 1}.</span>
          <input className={inputCls} value={it} onChange={(e) => set(i, e.target.value)} placeholder={placeholder} />
          <button onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="rounded p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><X size={14} /></button>
        </div>
      ))}
      <button onClick={() => onChange([...items, ''])} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs font-medium text-brand hover:border-brand"><Plus size={13} /> Add</button>
    </div>
  )
}

function ChallengeEditor({ items, onChange }: { items: HrChallenge[]; onChange: (v: HrChallenge[]) => void }) {
  const setAt = (i: number, patch: Partial<HrChallenge>) => onChange(items.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))
  return (
    <div className="space-y-2">
      {items.map((c, i) => (
        <div key={i} className="rounded-lg border border-black/10 p-2">
          <div className="mb-1 flex items-center gap-2"><span className="text-[11px] font-semibold text-navy">Issue {i + 1}</span><button onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="ml-auto rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><X size={13} /></button></div>
          <input className={`${inputCls} mb-1.5`} value={c.issue} onChange={(e) => setAt(i, { issue: e.target.value })} placeholder="Issue…" />
          <input className={inputCls} value={c.action} onChange={(e) => setAt(i, { action: e.target.value })} placeholder="Action required…" />
        </div>
      ))}
      <button onClick={() => onChange([...items, { issue: '', action: '' }])} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs font-medium text-brand hover:border-brand"><Plus size={13} /> Add issue</button>
    </div>
  )
}
