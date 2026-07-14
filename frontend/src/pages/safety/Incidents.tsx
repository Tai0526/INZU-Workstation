import { useMemo, useState } from 'react'
import { Search, ShieldAlert, Plus, FileText } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type RoleKey } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import StatChips from '@/components/ui/StatChips'
import CaseModal from '@/components/safety/CaseModal'
import RegisterIncidentModal from '@/components/safety/RegisterIncidentModal'
import {
  useCases, CASE_STAGE_META, CASE_STEPS, currentStepIndex, INCIDENT_TYPE_META, DECISION_LABEL, SEVERITY_META,
  type CaseStage, type IncidentType, type DisciplinaryCase,
} from '@/lib/safety/cases'
import { SortTh, useSort, sortRows } from '@/components/ui/SortTh'
import { monthKey, monthLabel } from '@/lib/speed/types'
import { downloadTablePdf } from '@/lib/reports/pdfDoc'

const VERDICT_ROLES: RoleKey[] = ['operations_manager', 'asst_operations_manager']

function detailOf(c: DisciplinaryCase): string {
  if (c.source === 'speed') return `+${c.over_by} km/h · ${c.rec_action ?? ''}`.trim()
  if (c.stage === 'closed' && c.verdict) {
    return c.verdict.outcome === 'rejected' ? 'Verdict rejected' : 'Verdict approved'
  }
  if (c.proposal) return `Proposed: ${c.proposal.decisions.map((d) => DECISION_LABEL[d]).join(', ') || 'no action'}`
  return c.description ? c.description.slice(0, 60) : '—'
}

// Click-to-sort accessors, one per column.
const CASE_SORT: Record<string, (c: DisciplinaryCase) => string | number> = {
  incident: (c) => (c.title || c.driver_name || INCIDENT_TYPE_META[c.incident_type].label).toLowerCase(),
  type: (c) => INCIDENT_TYPE_META[c.incident_type].label,
  when: (c) => c.event_datetime,
  detail: (c) => detailOf(c).toLowerCase(),
  stage: (c) => currentStepIndex(c.stage),
}

export default function Incidents() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[role].canToggleBranch
  const canPrepare = canEdit(role, 'safety')
  const canVerdict = VERDICT_ROLES.includes(role)

  const all = useCases()
  const [q, setQ] = useState('')
  const [stage, setStage] = useState<'all' | CaseStage>('all')
  const [type, setType] = useState<'all' | IncidentType>('all')
  const [driver, setDriver] = useState('all')
  const [month, setMonth] = useState('all')
  const [date, setDate] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [registerOpen, setRegisterOpen] = useState(false)
  const { key: sortKey, dir, toggle } = useSort('when', 'desc')

  const branchCases = useMemo(() => all.filter((c) => c.branch === branch), [all, branch])
  const driverOpts = useMemo(() => [...new Set(branchCases.map((c) => c.driver_name).filter(Boolean))].sort(), [branchCases])
  const monthOpts = useMemo(() => [...new Set(branchCases.map((c) => monthKey(c.event_datetime)).filter(Boolean))].sort().reverse(), [branchCases])

  // Everything matching the filters EXCEPT the stage chip — so the chip counts
  // reflect the current view (driver/month/date/type/search), and the table then
  // applies the selected stage on top.
  const scoped = useMemo(() => {
    const term = q.trim().toLowerCase()
    return branchCases
      .filter((c) => type === 'all' || c.incident_type === type)
      .filter((c) => driver === 'all' || c.driver_name === driver)
      .filter((c) => month === 'all' || monthKey(c.event_datetime) === month)
      .filter((c) => !date || c.event_datetime.slice(0, 10) === date)
      .filter((c) => !term || [c.title, c.driver_name, c.vehicle_label, c.route].some((f) => (f || '').toLowerCase().includes(term)))
  }, [branchCases, q, type, driver, month, date])

  const counts = useMemo(() => ({
    total: scoped.length,
    safety: scoped.filter((c) => c.stage === 'safety_review').length,
    ops: scoped.filter((c) => c.stage === 'ops_review').length,
    closed: scoped.filter((c) => c.stage === 'closed').length,
  }), [scoped])

  const rows = useMemo(() => {
    const filtered = scoped.filter((c) => stage === 'all' || c.stage === stage)
    return sortRows(filtered, CASE_SORT[sortKey] ?? CASE_SORT.when, dir)
  }, [scoped, stage, sortKey, dir])

  // Share-with-stakeholders PDF of the incidents awaiting an Ops decision, with
  // Safety's proposal and a list of what's attached to each. Respects the filters.
  function exportAwaitingOps() {
    const list = [...scoped].filter((c) => c.stage === 'ops_review').sort((a, b) => a.event_datetime.localeCompare(b.event_datetime))
    const rows = list.map((c) => {
      const details = c.source === 'speed'
        ? `+${c.over_by ?? 0} km/h (${c.recorded_speed ?? 0}/${c.speed_limit ?? 0})${c.rec_action ? ` · rec: ${c.rec_action}` : ''}${c.rec_fine ? ` · K${c.rec_fine.toLocaleString()}` : ''}${c.repeat_total ? ` · repeat ×${c.repeat_total}` : ''}`
        : `${c.severity ? SEVERITY_META[c.severity].label + ' · ' : ''}${c.description || '—'}`.slice(0, 200)
      const proposal = c.proposal
        ? `${c.proposal.decisions.map((d) => DECISION_LABEL[d]).join(', ') || 'no action'}${c.proposal.fine_amount ? ` · fine K${c.proposal.fine_amount.toLocaleString()}` : ''}${c.proposal.proposed_by ? `\nby ${c.proposal.proposed_by}` : ''}`
        : (c.safety_report ? c.safety_report.slice(0, 120) : 'Not yet proposed')
      const files = [
        c.charge_statement && `Charge statement: ${c.charge_statement.file_name}`,
        c.exculpatory && `Exculpatory: ${c.exculpatory.file_name}`,
        c.memo && `Memo: ${c.memo.file_name}`,
        c.incident_report && `Report: ${c.incident_report.file_name}`,
      ].filter(Boolean).join('\n') || 'None attached'
      return [
        `${c.driver_name || c.title || INCIDENT_TYPE_META[c.incident_type].label}\n${INCIDENT_TYPE_META[c.incident_type].label}${c.vehicle_label ? ` · ${c.vehicle_label}` : ''}${c.route ? ` · ${c.route}` : ''}`,
        c.event_datetime.slice(0, 10),
        details,
        proposal,
        files,
      ]
    })
    const today = new Date().toISOString().slice(0, 10)
    downloadTablePdf({
      title: `Incidents Awaiting Ops Decision — ${branchLabel}`,
      subtitle: `${list.length} pending · generated ${today}`,
      tables: [{
        head: ['Incident', 'When', 'Details', "Safety's proposal", 'Attachments'],
        rows: rows.length ? rows : [['—', '—', '—', '—', '—']],
        columnStyles: { 0: { cellWidth: 130, fontStyle: 'bold' }, 1: { cellWidth: 58 }, 2: { cellWidth: 200 }, 3: { cellWidth: 150 }, 4: { cellWidth: 160 } },
      }],
      landscape: true,
      dense: true,
      filename: `Incidents Awaiting Ops - ${branchLabel} - ${today}.pdf`,
    })
  }

  return (
    <div className="page space-y-5">
      <p className="max-w-3xl text-sm text-status-neutral">
        Safety incidents — speeding cases escalated by the tracker (with a recommended charge) and incidents Safety registers
        directly (near miss, accident, injury…). Safety investigates, writes a report and proposes a verdict; the Operations
        Manager approves or rejects it, and any fine is documented and deducted from payroll.
      </p>

      <StatChips
        active={stage}
        onPick={(v) => setStage(v)}
        stats={[
          { value: 'all', label: 'All', count: counts.total, tone: 'neutral' },
          { value: 'safety_review', label: 'With Safety', count: counts.safety, tone: 'warning' },
          { value: 'ops_review', label: 'Awaiting Ops', count: counts.ops, tone: 'critical' },
          { value: 'closed', label: 'Closed', count: counts.closed, tone: 'good' },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, driver, vehicle, location…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All types</option>
          {(Object.keys(INCIDENT_TYPE_META) as IncidentType[]).map((t) => <option key={t} value={t}>{INCIDENT_TYPE_META[t].label}</option>)}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All stages</option>
          <option value="safety_review">With Safety ({counts.safety})</option>
          <option value="ops_review">Awaiting Ops decision ({counts.ops})</option>
          <option value="closed">Closed ({counts.closed})</option>
        </select>
        <select value={driver} onChange={(e) => setDriver(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All drivers</option>
          {driverOpts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All months</option>
          {monthOpts.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title="Filter by date" className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand" />
        {(driver !== 'all' || month !== 'all' || !!date || type !== 'all' || stage !== 'all' || q) && (
          <button onClick={() => { setDriver('all'); setMonth('all'); setDate(''); setType('all'); setStage('all'); setQ('') }} className="rounded-lg border border-black/15 px-3 py-2 text-sm text-status-neutral hover:text-navy">Clear</button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={exportAwaitingOps} disabled={counts.ops === 0} title="PDF of the incidents awaiting an Ops decision, with each one's attachments — for sharing with stakeholders."><FileText size={15} /> Awaiting-Ops PDF</Button>
          {canPrepare && <Button onClick={() => setRegisterOpen(true)}><Plus size={15} /> Register incident</Button>}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <SortTh label="Incident" k="incident" sortKey={sortKey} dir={dir} onSort={toggle} />
                <SortTh label="Type" k="type" sortKey={sortKey} dir={dir} onSort={toggle} />
                <SortTh label="When" k="when" sortKey={sortKey} dir={dir} onSort={toggle} />
                <SortTh label="Detail" k="detail" sortKey={sortKey} dir={dir} onSort={toggle} />
                <SortTh label="Stage" k="stage" sortKey={sortKey} dir={dir} onSort={toggle} />
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.id} className={`cursor-pointer ${i % 2 ? 'bg-canvas/40' : ''} hover:bg-canvas`} onClick={() => setOpenId(c.id)}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-navy">{c.title || c.driver_name || INCIDENT_TYPE_META[c.incident_type].label}</div>
                    <div className="text-xs text-status-neutral">{[c.driver_name, c.vehicle_label, c.route].filter(Boolean).join(' · ') || '—'}</div>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge tone={INCIDENT_TYPE_META[c.incident_type].tone}>{INCIDENT_TYPE_META[c.incident_type].label}</StatusBadge></td>
                  <td className="px-4 py-2.5 text-status-neutral">{c.event_datetime.slice(0, 10)}</td>
                  <td className="px-4 py-2.5 text-navy">{detailOf(c)}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge tone={CASE_STAGE_META[c.stage].tone}>{CASE_STAGE_META[c.stage].label}</StatusBadge>
                    <div className="mt-0.5 text-[11px] text-status-neutral">Step {currentStepIndex(c.stage) + 1}/{CASE_STEPS.length}</div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-status-neutral">
                  <ShieldAlert size={22} className="mx-auto mb-2 text-status-neutral" />
                  No incidents yet. {canPrepare ? 'Register one, or confirm a speed event and escalate it.' : 'Confirm a speed event and escalate it to start a case.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <CaseModal caseId={openId} open={!!openId} onClose={() => setOpenId(null)} canPrepare={canPrepare} canVerdict={canVerdict} />
      <RegisterIncidentModal open={registerOpen} onClose={() => setRegisterOpen(false)} branch={branch} />
    </div>
  )
}
