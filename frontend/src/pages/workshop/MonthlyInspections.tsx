import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardCheck, Search, Download, Plus, Bus, Check, X, Wrench, Gauge,
  CalendarClock, CheckCircle2, AlertTriangle, History, ArrowRight, CalendarPlus,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import SearchableSelect, { SearchableMultiSelect } from '@/components/ui/SearchableSelect'
import { useVehicles } from '@/lib/fleet/store'
import { useEmployees } from '@/lib/hr/store'
import { useIssuances } from '@/lib/fuel/store'
import { latestOdometer } from '@/lib/fuel/types'
import {
  useInspections, useJobCards,
  scheduleInspection, rescheduleInspection, completeInspection, raiseJobFromInspection,
} from '@/lib/workshop/store'
import {
  type MonthlyInspection, type InspectionItem, type InspectionResult, type InspState,
  type JobSeverity, type JobCategory,
  INSPECTION_POINTS, INSPECTION_GROUPS, INSPECTION_RESULT_META, INSP_STATE_META,
  JOB_STATUS_META, SEVERITY_META, JOB_CATEGORY_LABEL,
  freshInspectionItems, inspectionFaults, inspectionStatus, monthEnd,
} from '@/lib/workshop/types'
import { downloadTablePdf } from '@/lib/reports/pdfDoc'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const selectCls = 'rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const fmt = (iso: string) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en', { day: '2-digit', month: 'short' }) } catch { return iso } }
const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' }) }
const km = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString()} km`)
const RANK: Record<InspState, number> = { overdue: 0, today: 1, unscheduled: 2, upcoming: 3, done: 4 }
const thisMonth = () => new Date().toISOString().slice(0, 7)

type Vehicle = { id: string; fleet_no: string; reg_plate: string; status: string }
type Row = { v: Vehicle; insp?: MonthlyInspection; state: InspState; dueDate: string; daysOver: number; latestOdo: number | null }

export default function MonthlyInspections() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'workshop') // Workshop Supervisor / Admin schedule & inspect

  const vehicles = useVehicles().filter((v) => v.branch === branch) as unknown as Vehicle[]
  const mechanics = useEmployees().filter((e) => e.branch === branch && e.status === 'active' && e.job_role === 'Mechanic')
  const issuances = useIssuances().filter((i) => i.branch === branch)
  const inspections = useInspections().filter((i) => i.branch === branch)
  const jobs = useJobCards()

  const today = new Date().toISOString().slice(0, 10)
  const [month, setMonth] = useState(thisMonth())
  const [q, setQ] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | 'attention' | InspState>('all')
  const [schedule, setSchedule] = useState<{ v?: Vehicle } | null>(null)
  const [inspect, setInspect] = useState<Row | null>(null)
  const [raiseFor, setRaiseFor] = useState<{ insp: MonthlyInspection; fault: string } | null>(null)

  const odoByFleet = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const v of vehicles) m.set(v.fleet_no, latestOdometer(issuances, v.fleet_no))
    return m
  }, [vehicles, issuances])

  // The record for each bus in the selected month (prefer a completed one).
  const recByFleet = useMemo(() => {
    const m = new Map<string, MonthlyInspection>()
    for (const it of inspections) {
      if (it.month !== month) continue
      const cur = m.get(it.fleet_no)
      if (!cur || it.status === 'done' || it.updated_at > cur.updated_at) m.set(it.fleet_no, it)
    }
    return m
  }, [inspections, month])

  const monthOpts = useMemo(() => {
    const set = new Set<string>(inspections.map((i) => i.month).filter(Boolean))
    set.add(thisMonth())
    return [...set].sort().reverse()
  }, [inspections])

  const all: Row[] = useMemo(() => {
    const term = q.trim().toLowerCase()
    return vehicles
      .filter((v) => !term || v.fleet_no.toLowerCase().includes(term) || v.reg_plate.toLowerCase().includes(term))
      .map((v) => { const insp = recByFleet.get(v.fleet_no); const s = inspectionStatus(insp, month, today); return { v, insp, state: s.state, dueDate: s.dueDate, daysOver: s.daysOver, latestOdo: odoByFleet.get(v.fleet_no) ?? null } })
      .sort((a, b) => RANK[a.state] - RANK[b.state] || b.daysOver - a.daysOver || a.v.fleet_no.localeCompare(b.v.fleet_no))
  }, [vehicles, q, recByFleet, month, today, odoByFleet])

  const rows = all.filter((r) =>
    stateFilter === 'all' ? true
      : stateFilter === 'attention' ? (r.state === 'overdue' || r.state === 'today' || r.state === 'unscheduled')
        : r.state === stateFilter)
  const counts = {
    overdue: all.filter((r) => r.state === 'overdue').length,
    today: all.filter((r) => r.state === 'today').length,
    unscheduled: all.filter((r) => r.state === 'unscheduled').length,
    done: all.filter((r) => r.state === 'done').length,
  }
  const coverage = all.length ? Math.round((counts.done / all.length) * 100) : 0
  const worstOver = all.reduce((m, r) => Math.max(m, r.daysOver), 0)

  function exportPdf() {
    const pdfRows = rows.map((r) => [
      `${r.v.fleet_no}\n${r.v.reg_plate}`,
      r.insp?.mechanic || '—',
      r.insp?.scheduled_date ? fmt(r.insp.scheduled_date) : '—',
      r.state === 'done' ? [r.insp?.done_date ? fmt(r.insp.done_date) : '', r.insp?.odometer ? km(r.insp.odometer) : ''].filter(Boolean).join(' · ') || '—' : '—',
      r.state === 'done' && r.insp ? INSPECTION_RESULT_META[r.insp.result].label : '—',
      r.state === 'overdue' ? `Overdue ${r.daysOver}d` : INSP_STATE_META[r.state].label,
    ])
    downloadTablePdf({
      title: `Monthly Vehicle Inspections — ${branchLabel}`,
      subtitle: `${monthLabel(month)} · ${counts.done}/${all.length} inspected (${coverage}%) · ${counts.overdue} overdue · generated ${today}`,
      tables: [{
        head: ['Bus', 'Mechanic', 'Scheduled', 'Inspected', 'Result', 'Status'],
        rows: pdfRows.length ? pdfRows : [['—', '—', '—', '—', '—', '—']],
        columnStyles: { 0: { cellWidth: 70, fontStyle: 'bold' } },
      }],
      landscape: true, dense: true,
      filename: `Monthly Inspections - ${branchLabel} - ${month}.pdf`,
    })
  }

  const jobLabel = (id: string) => { const s = jobs.find((j) => j.id === id)?.status; return s ? JOB_STATUS_META[s].label : 'raised' }

  return (
    <div className="page space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          Every bus in <span className="font-medium text-navy">{branchLabel}</span> gets a thorough inspection <span className="font-medium text-navy">at least once a month</span>. Assign a mechanic on a date, record the detailed findings, and raise a job card for anything that needs work. Buses not yet done rise to the top.
        </p>
        <Button variant="secondary" onClick={exportPdf}><Download size={15} /> Export</Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:max-w-2xl sm:grid-cols-4">
        <div className={`rounded-xl border px-3 py-2 ${counts.overdue ? 'border-status-critical/40 bg-status-critical/5' : 'border-black/10 bg-white'}`}><div className={`text-lg font-bold leading-none ${counts.overdue ? 'text-status-critical' : 'text-navy'}`}>{counts.overdue}</div><div className="mt-0.5 text-[11px] text-status-neutral">Overdue{worstOver > 0 ? ` · worst ${worstOver}d` : ''}</div></div>
        <div className={`rounded-xl border px-3 py-2 ${counts.unscheduled ? 'border-status-warning/40 bg-status-warning/10' : 'border-black/10 bg-white'}`}><div className={`text-lg font-bold leading-none ${counts.unscheduled ? 'text-[#8a6d10]' : 'text-navy'}`}>{counts.unscheduled}</div><div className="mt-0.5 text-[11px] text-status-neutral">Not scheduled</div></div>
        <div className={`rounded-xl border px-3 py-2 ${counts.today ? 'border-status-warning/40 bg-status-warning/10' : 'border-black/10 bg-white'}`}><div className={`text-lg font-bold leading-none ${counts.today ? 'text-[#8a6d10]' : 'text-navy'}`}>{counts.today}</div><div className="mt-0.5 text-[11px] text-status-neutral">Due today</div></div>
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-status-good">{counts.done}<span className="text-xs font-normal text-status-neutral">/{all.length}</span></div><div className="mt-0.5 text-[11px] text-status-neutral">Inspected · {coverage}%</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectCls}>
          {monthOpts.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bus…" className="w-44 rounded-lg border border-black/15 bg-white py-2 pl-8 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as any)} className={selectCls}>
          <option value="all">All buses</option>
          <option value="attention">Needs attention</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="unscheduled">Not scheduled</option>
          <option value="upcoming">Scheduled</option>
          <option value="done">Inspected</option>
        </select>
        <span className="text-[11px] text-status-neutral">{rows.length} shown</span>
        {canManage && <Button className="ml-auto" onClick={() => setSchedule({})}><CalendarPlus size={15} /> Schedule inspection</Button>}
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white">
              <tr>
                <th className="px-3 py-2.5 font-medium">Bus</th><th className="px-3 py-2.5 font-medium">Mechanic</th>
                <th className="px-3 py-2.5 font-medium">Scheduled</th><th className="px-3 py-2.5 font-medium">Inspected</th>
                <th className="px-3 py-2.5 font-medium">Result</th><th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const faults = r.insp ? inspectionFaults(r.insp).length : 0
                return (
                  <tr key={r.v.id} className={clsx(i % 2 ? 'bg-canvas/40' : '', r.state === 'overdue' && 'bg-status-critical/[0.04]')}>
                    <td className="px-3 py-2 align-top">
                      <div className="inline-flex items-center gap-1 font-medium text-navy"><Bus size={13} className="text-status-neutral" /> {r.v.fleet_no}</div>
                      <div className="text-[11px] text-status-neutral">{r.v.reg_plate}</div>
                    </td>
                    <td className="px-3 py-2 align-top text-status-neutral">{r.insp?.mechanic || <span className="text-status-neutral/60">—</span>}</td>
                    <td className="px-3 py-2 align-top text-status-neutral">{r.insp?.scheduled_date ? fmt(r.insp.scheduled_date) : <span className="text-status-neutral/60">—</span>}</td>
                    <td className="px-3 py-2 align-top text-status-neutral">
                      {r.state === 'done' && r.insp ? (
                        <span>{fmt(r.insp.done_date)}{r.insp.odometer ? <span className="ml-1 inline-flex items-center gap-0.5 text-[11px]"><Gauge size={10} /> {km(r.insp.odometer)}</span> : ''}</span>
                      ) : <span className="text-status-neutral/60">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {r.state === 'done' && r.insp ? (
                        <div>
                          <StatusBadge tone={INSPECTION_RESULT_META[r.insp.result].tone}>{INSPECTION_RESULT_META[r.insp.result].label}</StatusBadge>
                          {(faults > 0 || r.insp.job_ids.length > 0) && <div className="mt-0.5 text-[11px] text-status-neutral">{faults ? `${faults} finding${faults === 1 ? '' : 's'}` : ''}{faults && r.insp.job_ids.length ? ' · ' : ''}{r.insp.job_ids.length ? `${r.insp.job_ids.length} job card${r.insp.job_ids.length === 1 ? '' : 's'}` : ''}</div>}
                        </div>
                      ) : <span className="text-status-neutral/60">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <StatusBadge tone={INSP_STATE_META[r.state].tone}>{INSP_STATE_META[r.state].label}</StatusBadge>
                      {r.state === 'overdue' && <div className="mt-0.5 text-[11px] font-medium text-status-critical">{r.daysOver} day{r.daysOver === 1 ? '' : 's'} overdue</div>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-center justify-end gap-1">
                        {r.state === 'done' ? (
                          <button onClick={() => setInspect(r)} className="inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-xs font-medium text-navy hover:bg-canvas"><ClipboardCheck size={12} /> View</button>
                        ) : canManage ? (
                          <>
                            <button onClick={() => setSchedule({ v: r.v })} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title={r.insp ? 'Reassign / reschedule' : 'Assign a mechanic & date'}><CalendarClock size={14} /></button>
                            <button onClick={() => setInspect(r)} className="inline-flex items-center gap-1 rounded-md bg-navy px-2 py-1 text-xs font-medium text-white hover:bg-navy-secondary"><ClipboardCheck size={13} /> Do inspection</button>
                          </>
                        ) : <span className="text-[11px] text-status-neutral">with workshop</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-status-neutral"><ClipboardCheck size={22} className="mx-auto mb-2 text-status-neutral/60" />{all.length === 0 ? 'No buses in this branch.' : 'No buses match these filters.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {canManage && (counts.overdue > 0 || counts.unscheduled > 0) && (
        <p className="inline-flex items-center gap-1.5 text-xs text-[#8a6d10]"><AlertTriangle size={13} /> {counts.overdue + counts.unscheduled} bus{counts.overdue + counts.unscheduled === 1 ? '' : 'es'} still need {monthLabel(month)}’s inspection.</p>
      )}
      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <ScheduleModal target={schedule} onClose={() => setSchedule(null)} branch={branch} month={month} vehicles={vehicles} mechanics={mechanics} inspections={inspections} />
      <InspectionModal target={inspect} onClose={() => setInspect(null)} branch={branch} month={month} canManage={canManage} mechanics={mechanics} jobs={jobs} onRaise={(insp, fault) => { setInspect(null); setRaiseFor({ insp, fault }) }} jobLabel={jobLabel} />
      <RaiseFromInspectionModal target={raiseFor} onClose={() => setRaiseFor(null)} mechanics={mechanics} />
    </div>
  )
}

// ── Assign a mechanic + date (schedule / reschedule) ────────────────────
function ScheduleModal({ target, onClose, branch, month, vehicles, mechanics, inspections }: {
  target: { v?: Vehicle } | null; onClose: () => void; branch: BranchCode; month: string; vehicles: Vehicle[]; mechanics: any[]; inspections: MonthlyInspection[]
}) {
  const [fleet, setFleet] = useState('')
  const [reg, setReg] = useState('')
  const [mechanic, setMechanic] = useState('')
  const [date, setDate] = useState('')
  const [key, setKey] = useState<string | null>(null)
  const existing = inspections.find((i) => i.fleet_no === fleet && i.month === month && i.status !== 'done')
  if (target && key !== (target.v?.fleet_no ?? '∅')) {
    setKey(target.v?.fleet_no ?? '∅')
    const v = target.v
    setFleet(v?.fleet_no ?? '')
    setReg(v?.reg_plate ?? '')
    const cur = v ? inspections.find((i) => i.fleet_no === v.fleet_no && i.month === month && i.status !== 'done') : undefined
    setMechanic(cur?.mechanic ?? '')
    // default the date to today if it falls in the month, else the 1st of the month
    const today = new Date().toISOString().slice(0, 10)
    setDate(cur?.scheduled_date ?? (today.slice(0, 7) === month ? today : `${month}-01`))
  }
  if (!target) return null
  function onVehicle(f: string) { const v = vehicles.find((x) => x.fleet_no === f); setFleet(f); setReg(v ? v.reg_plate : '') }
  const ready = !!fleet && !!date
  function save() {
    if (!ready) return
    if (existing) rescheduleInspection(existing.id, mechanic, date)
    else scheduleInspection({ branch, month, fleet_no: fleet, reg_no: reg, mechanic, scheduled_date: date, status: 'scheduled', done_date: '', odometer: 0, items: freshInspectionItems(), result: 'pass', findings: '', notes: '', job_ids: [] })
    onClose()
  }
  return (
    <Modal open={!!target} onClose={onClose} title={target.v ? `Schedule inspection — ${target.v.fleet_no}` : 'Schedule inspection'}
      subtitle={`Assign a mechanic and a date for ${monthLabel(month)}. Due by ${fmt(monthEnd(month))} at the latest.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}><CalendarClock size={15} /> {existing ? 'Reschedule' : 'Schedule'}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!target.v ? (
          <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Bus</span>
            <SearchableSelect className={inputCls} value={fleet} onChange={onVehicle} placeholder="Search bus…" advanceOnSelect options={vehicles.map((v) => ({ value: v.fleet_no, label: v.fleet_no, sub: v.reg_plate }))} /></label>
        ) : (
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Bus</span><div className="flex h-[38px] items-center rounded-lg border border-black/10 bg-canvas px-3 text-sm text-navy">{fleet} · {reg}</div></label>
        )}
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Date</span><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Mechanic</span>
          <SearchableSelect className={inputCls} value={mechanic} onChange={setMechanic} placeholder="Search mechanic…" options={mechanics.map((m) => ({ value: m.full_name, label: m.full_name }))} emptyText="No mechanics in HR for this branch — add them in HR → Employees" /></label>
      </div>
      {existing && <p className="mt-2 text-[11px] text-status-neutral">This bus is already scheduled for {monthLabel(month)} — saving updates the assignment.</p>}
    </Modal>
  )
}

// ── Do / view the detailed inspection ───────────────────────────────────
const RESULTS: InspectionResult[] = ['pass', 'advisory', 'fail']
function InspectionModal({ target, onClose, branch, month, canManage, mechanics, jobs, onRaise, jobLabel }: {
  target: Row | null; onClose: () => void; branch: BranchCode; month: string; canManage: boolean; mechanics: any[]
  jobs: ReturnType<typeof useJobCards>; onRaise: (insp: MonthlyInspection, fault: string) => void; jobLabel: (id: string) => string
}) {
  const liveInsp = useInspections()
  const insp = target?.insp ? (liveInsp.find((x) => x.id === target.insp!.id) ?? target.insp) : undefined
  const done = insp?.status === 'done'
  const readOnly = !canManage
  const [key, setKey] = useState<string | null>(null)
  const [mechanic, setMechanic] = useState('')
  const [date, setDate] = useState('')
  const [odo, setOdo] = useState('')
  const [items, setItems] = useState<InspectionItem[]>(freshInspectionItems())
  const [result, setResult] = useState<InspectionResult>('pass')
  const [findings, setFindings] = useState('')
  const [notes, setNotes] = useState('')

  if (target && key !== target.v.id) {
    setKey(target.v.id)
    const today = new Date().toISOString().slice(0, 10)
    setMechanic(insp?.mechanic ?? '')
    setDate(insp?.done_date || (today.slice(0, 7) === month ? today : monthEnd(month)))
    setOdo(insp?.odometer ? String(insp.odometer) : (target.latestOdo != null ? String(target.latestOdo) : ''))
    setItems(insp?.items?.length ? insp.items.map((i) => ({ ...i })) : freshInspectionItems())
    setResult(insp?.result ?? 'pass')
    setFindings(insp?.findings ?? '')
    setNotes(insp?.notes ?? '')
  }
  if (!target) return null

  const faults = items.filter((i) => !i.ok)
  function setItem(k: string, patch: Partial<InspectionItem>) { setItems((p) => p.map((it) => (it.key === k ? { ...it, ...patch } : it))) }
  // Suggest the overall result from the findings, but leave it editable.
  const suggested: InspectionResult = faults.length ? 'advisory' : 'pass'

  function save() {
    if (readOnly) { onClose(); return }
    let id = insp?.id
    if (!id) {
      const created = scheduleInspection({ branch, month, fleet_no: target!.v.fleet_no, reg_no: target!.v.reg_plate, mechanic, scheduled_date: date, status: 'scheduled', done_date: '', odometer: 0, items: freshInspectionItems(), result: 'pass', findings: '', notes: '', job_ids: [] })
      id = created.id
    }
    completeInspection(id, { mechanic, done_date: date, odometer: Number(odo) || 0, items, result, findings: findings.trim(), notes: notes.trim() })
    onClose()
  }

  const linkedJobs = insp ? insp.job_ids.map((jid) => jobs.find((j) => j.id === jid)).filter(Boolean) as ReturnType<typeof useJobCards> : []
  const trail = insp?.trail ?? []

  return (
    <Modal open={!!target} onClose={onClose} size="lg"
      title={`${done && readOnly ? 'Inspection' : 'Monthly inspection'} — ${target.v.fleet_no}`}
      subtitle={`${target.v.reg_plate} · ${monthLabel(month)}${done ? ` · inspected ${fmt(insp!.done_date)}${insp!.mechanic ? ` by ${insp!.mechanic}` : ''}` : ''}`}
      footer={readOnly
        ? <Button variant="secondary" onClick={onClose}>Close</Button>
        : <div className="flex w-full items-center justify-between">
            <span className="text-[11px] text-status-neutral">{faults.length ? `${faults.length} finding${faults.length === 1 ? '' : 's'}` : 'No faults found'}</span>
            <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}><CheckCircle2 size={15} /> {done ? 'Save changes' : 'Complete inspection'}</Button></div>
          </div>}>

      {!readOnly && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Mechanic</span>
            <SearchableSelect className={inputCls} value={mechanic} onChange={setMechanic} placeholder="Search mechanic…" options={mechanics.map((m) => ({ value: m.full_name, label: m.full_name }))} emptyText="No mechanics in HR" /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Date inspected</span><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Odometer (km){target.latestOdo != null && <span className="ml-1 font-normal text-status-neutral">· fuel: {km(target.latestOdo)}</span>}</span><input type="number" className={inputCls} value={odo} onChange={(e) => setOdo(e.target.value)} /></label>
        </div>
      )}

      {/* Inspection points, grouped */}
      <div className="mt-3 space-y-3">
        {INSPECTION_GROUPS.map((group) => (
          <div key={group} className="rounded-lg border border-black/10">
            <div className="border-b border-black/5 bg-canvas/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-status-neutral">{group}</div>
            <div className="divide-y divide-black/5">
              {items.filter((it) => INSPECTION_POINTS.find((p) => p.key === it.key)?.group === group).map((it) => (
                <div key={it.key} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-navy">{it.label}</span>
                    {readOnly ? (
                      <StatusBadge tone={it.ok ? 'good' : 'critical'}>{it.ok ? 'OK' : 'Fault'}</StatusBadge>
                    ) : (
                      <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
                        <button type="button" onClick={() => setItem(it.key, { ok: true })} className={clsx('inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium', it.ok ? 'bg-status-good text-white' : 'bg-white text-status-neutral')}><Check size={12} /> OK</button>
                        <button type="button" onClick={() => setItem(it.key, { ok: false })} className={clsx('inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium', !it.ok ? 'bg-status-critical text-white' : 'bg-white text-status-neutral')}><X size={12} /> Fault</button>
                      </div>
                    )}
                  </div>
                  {!it.ok && (readOnly
                    ? (it.note && <div className="mt-1 text-[11px] text-status-neutral">{it.note}</div>)
                    : <input className={`${inputCls} mt-1.5`} placeholder="What's wrong?" value={it.note} onChange={(e) => setItem(it.key, { note: e.target.value })} />)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Overall result + findings */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <span className="mb-1 block text-xs font-medium text-navy">Overall result</span>
          {readOnly ? <StatusBadge tone={INSPECTION_RESULT_META[result].tone}>{INSPECTION_RESULT_META[result].label}</StatusBadge> : (
            <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
              {RESULTS.map((res) => (
                <button key={res} type="button" onClick={() => setResult(res)} className={clsx('px-2.5 py-1.5 text-xs font-medium', result === res ? (res === 'fail' ? 'bg-status-critical text-white' : res === 'advisory' ? 'bg-status-warning text-white' : 'bg-status-good text-white') : 'bg-white text-status-neutral hover:bg-canvas')}>{INSPECTION_RESULT_META[res].label.replace(' — jobs raised', '')}</button>
              ))}
            </div>
          )}
          {!readOnly && result !== suggested && <p className="mt-1 text-[11px] text-status-neutral">Suggested: {INSPECTION_RESULT_META[suggested].label.replace(' — jobs raised', '')}</p>}
        </div>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Findings / summary</span>
          {readOnly ? <div className="rounded-lg bg-canvas px-3 py-2 text-sm text-navy">{findings || '—'}</div>
            : <textarea className={inputCls} rows={2} placeholder="Summarise what needs work — these become job cards." value={findings} onChange={(e) => setFindings(e.target.value)} />}</label>
      </div>
      {!readOnly && (
        <label className="mt-3 block"><span className="mb-1 block text-xs font-medium text-navy">Notes (optional)</span><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      )}

      {/* Raise job cards from the findings (needs a saved inspection) */}
      {insp && (
        <div className="mt-4 rounded-lg border border-black/10 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-navy"><Wrench size={13} className="text-brand" /> Job cards from this inspection</div>
          {faults.length > 0 && canManage && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {faults.map((it) => (
                <button key={it.key} onClick={() => onRaise(insp, it.note ? `${it.label}: ${it.note}` : it.label)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand/40 px-2 py-0.5 text-[11px] font-medium text-brand hover:border-brand">
                  <Plus size={11} /> {it.label}
                </button>
              ))}
            </div>
          )}
          {linkedJobs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {linkedJobs.map((j) => (
                <Link key={j!.id} to="/workshop/jobcards" className="inline-flex items-center gap-1 rounded-full bg-navy/5 px-2 py-0.5 text-[11px] text-navy hover:bg-navy/10"><Wrench size={11} className="text-brand" /> {j!.fleet_no}: {jobLabel(j!.id)} <ArrowRight size={10} /></Link>
              ))}
            </div>
          ) : faults.length === 0 ? <p className="text-[11px] text-status-good">No faults — nothing to raise.</p>
            : canManage ? <p className="text-[11px] text-status-neutral">Click a finding above to raise a job card for it.</p>
              : <p className="text-[11px] text-status-neutral">No job cards raised yet.</p>}
        </div>
      )}
      {!insp && !readOnly && faults.length > 0 && <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-[#8a6d10]"><AlertTriangle size={12} /> Complete the inspection first, then reopen it to raise job cards for the {faults.length} finding{faults.length === 1 ? '' : 's'}.</p>}

      {/* Audit trail */}
      {trail.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-status-neutral"><History size={13} /> History</div>
          <ol className="relative space-y-2 border-l border-black/10 pl-4">
            {[...trail].reverse().map((t, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-brand ring-2 ring-white" />
                <div className="text-xs font-medium text-navy">{t.action}</div>
                {t.detail && <div className="text-[11px] text-status-neutral">{t.detail}</div>}
                <div className="text-[10px] text-status-neutral">{new Date(t.at).toLocaleString()} · {t.by}</div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  )
}

// ── Raise a job card from an inspection finding ─────────────────────────
function RaiseFromInspectionModal({ target, onClose, mechanics }: { target: { insp: MonthlyInspection; fault: string } | null; onClose: () => void; mechanics: any[] }) {
  const [fault, setFault] = useState('')
  const [severity, setSeverity] = useState<JobSeverity>('major')
  const [category, setCategory] = useState<JobCategory>('mechanical')
  const [mechs, setMechs] = useState<string[]>([])
  const [key, setKey] = useState<string | null>(null)
  if (target && key !== `${target.insp.id}:${target.fault}`) {
    setKey(`${target.insp.id}:${target.fault}`)
    setFault(target.fault)
    setSeverity('major')
    setCategory(/tyre|wheel/i.test(target.fault) ? 'tyre' : 'mechanical')
    setMechs(target.insp.mechanic ? [target.insp.mechanic] : [])
  }
  if (!target) return null
  const ready = !!fault.trim()
  function save() { if (!ready) return; raiseJobFromInspection(target!.insp, { fault: fault.trim(), severity, category, mechanics: mechs }); onClose() }
  return (
    <Modal open={!!target} onClose={onClose} title={`Raise job card — ${target.insp.fleet_no}`}
      subtitle="Turns an inspection finding into a job card and pulls the bus into the workshop."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}><Wrench size={15} /> Raise &amp; pull from service</Button></>}>
      <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Fault</span>
        <textarea className={inputCls} rows={2} value={fault} onChange={(e) => setFault(e.target.value)} autoFocus /></label>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Severity</span>
          <select className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value as JobSeverity)}>{(['minor', 'major', 'critical'] as JobSeverity[]).map((s) => <option key={s} value={s}>{SEVERITY_META[s].label}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Category</span>
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as JobCategory)}>{(Object.keys(JOB_CATEGORY_LABEL) as JobCategory[]).map((c) => <option key={c} value={c}>{JOB_CATEGORY_LABEL[c]}</option>)}</select></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Assign mechanic(s)</span>
          <SearchableMultiSelect className={inputCls} placeholder="Search mechanic(s)…" values={mechs} onChange={setMechs} options={mechanics.map((m) => ({ value: m.full_name, label: m.full_name }))} emptyText="No mechanics in HR" /></label>
      </div>
    </Modal>
  )
}
