import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, ShieldAlert, Plus, FileText, Gavel, ChevronRight, Clock, CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type RoleKey } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import StatChips from '@/components/ui/StatChips'
import CaseModal from '@/components/safety/CaseModal'
import RegisterIncidentModal from '@/components/safety/RegisterIncidentModal'
import {
  CASE_STAGE_META, CASE_STEPS, currentStepIndex, INCIDENT_TYPE_META, DECISION_LABEL, SEVERITY_META,
  type CaseStage, type IncidentType, type DisciplinaryCase,
} from '@/lib/safety/cases'
import { useCaseGroups, daysOpen, type CaseGroup } from '@/lib/safety/caseGroups'
import { monthKey, monthLabel, recommendationForEvent, penaltyLabel } from '@/lib/speed/types'
import { useSpeedEvents } from '@/lib/speed/store'
import { useAbsorbedSpeedIds } from '@/lib/speed/useTrips'
import { tripSpan } from '@/lib/speed/trips'
import { downloadTablePdf } from '@/lib/reports/pdfDoc'
import { useSpeedGeo } from '@/lib/speed/geo'

// Ops decides disciplinary/speeding verdicts; the HR Manager can also conclude a
// case once Safety has attached its items (shared close authority).
const VERDICT_ROLES: RoleKey[] = ['operations_manager', 'asst_operations_manager', 'hr_manager']

/** Which pile an incident sits in. The page opens on outstanding work, so this
 *  is the first thing it decides about every row. */
type View = 'open' | 'mine' | 'closed' | 'all'

const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })

export default function Incidents() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[role].canToggleBranch
  const canPrepare = canEdit(role, 'safety')
  const canVerdict = VERDICT_ROLES.includes(role)

  const geoMap = useSpeedGeo()
  const speedEvents = useSpeedEvents()
  // Readings that ride inside another journey — skipped when working out which
  // offence this is, so the number here matches the Speed Events page.
  const absorbedSpeed = useAbsorbedSpeedIds()
  // One row per journey: a run escalated a dozen times is one incident, shown once.
  const groups = useCaseGroups(branch)

  const [q, setQ] = useState('')
  const [view, setView] = useState<View>('open')
  const [type, setType] = useState<'all' | IncidentType>('all')
  const [driver, setDriver] = useState('all')
  const [month, setMonth] = useState('all')
  const [date, setDate] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [showAllClosed, setShowAllClosed] = useState(false)

  const driverOpts = useMemo(() => [...new Set(groups.map((g) => g.lead.driver_name).filter(Boolean))].sort(), [groups])
  const monthOpts = useMemo(() => [...new Set(groups.map((g) => monthKey(g.when)).filter(Boolean))].sort().reverse(), [groups])

  /** An incident waiting on THIS user — the whole reason to open the page. */
  const needsMe = (g: CaseGroup) =>
    (g.stage === 'ops_review' && canVerdict) || (g.stage === 'safety_review' && canPrepare)

  // Everything matching the filters EXCEPT the view chip, so the chip counts
  // reflect the current search / driver / month selection.
  const scoped = useMemo(() => {
    const term = q.trim().toLowerCase()
    return groups
      .filter((g) => type === 'all' || g.lead.incident_type === type)
      .filter((g) => driver === 'all' || g.lead.driver_name === driver)
      .filter((g) => month === 'all' || monthKey(g.when) === month)
      .filter((g) => !date || g.when.slice(0, 10) === date)
      .filter((g) => !term || [g.lead.title, g.lead.driver_name, g.lead.vehicle_label, g.lead.route].some((f) => (f || '').toLowerCase().includes(term)))
  }, [groups, q, type, driver, month, date])

  const counts = useMemo(() => ({
    all: scoped.length,
    open: scoped.filter((g) => g.stage !== 'closed').length,
    mine: scoped.filter(needsMe).length,
    closed: scoped.filter((g) => g.stage === 'closed').length,
  }), [scoped, canPrepare, canVerdict])

  // Three piles, in the order the day should be worked: yours, someone else's,
  // then the record of what has been settled.
  const piles = useMemo(() => {
    const inView = (g: CaseGroup) =>
      view === 'all' ? true
        : view === 'closed' ? g.stage === 'closed'
          : view === 'mine' ? needsMe(g)
            : g.stage !== 'closed'
    const list = scoped.filter(inView)
    // Oldest first where action is owed — the thing that has waited longest is
    // the thing most likely to have been forgotten.
    const byAge = (a: CaseGroup, b: CaseGroup) => a.when.localeCompare(b.when)
    const byRecent = (a: CaseGroup, b: CaseGroup) => b.when.localeCompare(a.when)
    return {
      mine: list.filter((g) => g.stage !== 'closed' && needsMe(g)).sort(byAge),
      others: list.filter((g) => g.stage !== 'closed' && !needsMe(g)).sort(byAge),
      closed: list.filter((g) => g.stage === 'closed').sort(byRecent),
    }
  }, [scoped, view, canPrepare, canVerdict])

  const nothingShown = piles.mine.length + piles.others.length + piles.closed.length === 0

  /** What actually happened, in one line, for the report exports. */
  function detailFor(g: CaseGroup): string {
    const c = g.lead
    if (c.source !== 'speed') return `${c.severity ? `${SEVERITY_META[c.severity].label} · ` : ''}${c.description || '—'}`.slice(0, 200)
    const rec = recommendationForEvent(speedEvents, c.event_id, absorbedSpeed)
    const action = rec?.action ?? c.rec_action
    const fine = rec?.fine ?? c.rec_fine ?? 0
    const run = g.trip && g.trip.breaches > 1 ? `\n${g.trip.breaches} breaches on one journey (${tripSpan(g.trip)})` : ''
    const g0 = geoMap[c.event_id]
    const geoLine = g0 ? `\n${g0.dur}s over · ${g0.dist.toFixed(2)} km${g0.loc ? ` · ${g0.loc}` : ''}` : ''
    return `+${c.over_by ?? 0} km/h (${c.recorded_speed ?? 0}/${c.speed_limit ?? 0})${action ? ` · rec: ${action}` : ''}${fine ? ` · K${fine.toLocaleString()}` : ''}${c.repeat_total ? ` · repeat ×${c.repeat_total}` : ''}${run}${geoLine}`
  }

  const nameOf = (c: DisciplinaryCase) => c.driver_name || c.title || INCIDENT_TYPE_META[c.incident_type].label
  const chargesNote = (g: CaseGroup) => (g.cases.length > 1 ? `\n${g.cases.length} charges raised on this journey` : '')
  const filesOf = (c: DisciplinaryCase) => [
    c.charge_statement && `Charge statement: ${c.charge_statement.file_name}`,
    c.exculpatory && `Exculpatory: ${c.exculpatory.file_name}`,
    c.memo && `Memo: ${c.memo.file_name}`,
    c.incident_report && `Report: ${c.incident_report.file_name}`,
    c.verdict?.fine_file && `Fine doc: ${c.verdict.fine_file.file_name}`,
  ].filter(Boolean).join('\n') || 'None attached'

  // Share-with-stakeholders PDF of the incidents awaiting an Ops decision, with
  // Safety's proposal and a list of what's attached to each. Respects the filters.
  function exportAwaitingOps() {
    const list = scoped.filter((g) => g.stage === 'ops_review').sort((a, b) => a.when.localeCompare(b.when))
    const rows = list.map((g) => {
      const c = g.lead
      const proposal = c.proposal
        ? `${c.proposal.decisions.map((d) => DECISION_LABEL[d]).join(', ') || 'no action'}${c.proposal.fine_amount ? ` · fine K${c.proposal.fine_amount.toLocaleString()}` : ''}${c.proposal.proposed_by ? `\nby ${c.proposal.proposed_by}` : ''}`
        : (c.safety_report ? c.safety_report.slice(0, 120) : 'Not yet proposed')
      return [
        `${nameOf(c)}\n${INCIDENT_TYPE_META[c.incident_type].label}${c.vehicle_label ? ` · ${c.vehicle_label}` : ''}${c.route ? ` · ${c.route}` : ''}${chargesNote(g)}`,
        `${c.event_datetime.slice(0, 10)}\nopen ${daysOpen(g)} day(s)`,
        detailFor(g),
        proposal,
        filesOf(c),
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

  // Share-with-stakeholders PDF of the DECIDED incidents (Ops approved / rejected),
  // showing the outcome + fine + who decided, and what's attached. Respects filters.
  function exportDecided() {
    const list = scoped.filter((g) => g.stage === 'closed').sort((a, b) => a.when.localeCompare(b.when))
    const rows = list.map((g) => {
      const c = g.lead
      const v = c.verdict
      const outcome = v
        ? (v.outcome === 'approved'
          ? `APPROVED: ${v.decisions.map((d) => DECISION_LABEL[d]).join(', ') || 'no action'}${v.fine_amount ? ` · fine K${v.fine_amount.toLocaleString()}` : ''}${v.fine_amount && v.to_payroll ? ' · to payroll' : ''}`
          : `REJECTED${v.notes ? `: ${v.notes}` : ''}`) + `\nby ${v.decided_by} · ${v.decided_at.slice(0, 10)}`
        : '—'
      return [
        `${nameOf(c)}\n${INCIDENT_TYPE_META[c.incident_type].label}${c.vehicle_label ? ` · ${c.vehicle_label}` : ''}${chargesNote(g)}`,
        c.event_datetime.slice(0, 10),
        detailFor(g),
        outcome,
        filesOf(c),
      ]
    })
    const today = new Date().toISOString().slice(0, 10)
    downloadTablePdf({
      title: `Incident Decisions — ${branchLabel}`,
      subtitle: `${list.length} decided · generated ${today}`,
      tables: [{
        head: ['Incident', 'When', 'Details', 'Ops decision', 'Attachments'],
        rows: rows.length ? rows : [['—', '—', '—', '—', '—']],
        columnStyles: { 0: { cellWidth: 120, fontStyle: 'bold' }, 1: { cellWidth: 58 }, 2: { cellWidth: 175 }, 3: { cellWidth: 185 }, 4: { cellWidth: 160 } },
      }],
      landscape: true,
      dense: true,
      filename: `Incident Decisions - ${branchLabel} - ${today}.pdf`,
    })
  }

  // Deep-link from the dashboard / notifications: ?stage= pre-filters the list,
  // ?case= opens that incident. Cleared from the URL once applied.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const st = searchParams.get('stage')
    const cid = searchParams.get('case')
    if (!st && !cid) return
    if (st === 'closed') setView('closed')
    else if (st === 'safety_review' || st === 'ops_review') setView('open')
    if (cid) setOpenId(cid)
    setSearchParams({}, { replace: true }) // consume the param so it doesn't stick
  }, [searchParams, setSearchParams])

  const filtered = q.trim() !== '' || driver !== 'all' || month !== 'all' || !!date || type !== 'all'

  return (
    <div className="page space-y-5">
      {/* ── What is outstanding, before anything else ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="font-display text-lg font-bold leading-tight text-navy">
            {counts.open === 0
              ? 'Nothing outstanding'
              : `${counts.open} incident${counts.open === 1 ? '' : 's'} still open`}
            {counts.mine > 0 && <span className="text-brand"> · {counts.mine} waiting on you</span>}
          </h2>
          <p className="mt-1 text-sm text-status-neutral">
            {counts.open === 0
              ? `Every incident at ${branchLabel} has been decided. Closed cases are kept below as the record.`
              : 'Safety investigates and proposes a verdict; the Operations Manager approves or rejects it. Oldest first — what has waited longest is what gets forgotten.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportAwaitingOps} disabled={scoped.filter((g) => g.stage === 'ops_review').length === 0}
            title="PDF of the incidents awaiting an Ops decision, with each one's attachments — for sharing with stakeholders."><FileText size={15} /> Awaiting-Ops PDF</Button>
          <Button variant="secondary" onClick={exportDecided} disabled={counts.closed === 0}
            title="PDF of the incidents Ops has decided, with the outcome, fine and attachments — for stakeholders."><Gavel size={15} /> Decisions PDF</Button>
          {canPrepare && <Button onClick={() => setRegisterOpen(true)}><Plus size={15} /> Register incident</Button>}
        </div>
      </div>

      <StatChips
        active={view}
        onPick={(v) => setView(v)}
        stats={[
          { value: 'open', label: 'Open', count: counts.open, tone: counts.open ? 'warning' : 'good' },
          ...(canPrepare || canVerdict ? [{ value: 'mine' as const, label: 'Waiting on you', count: counts.mine, tone: (counts.mine ? 'critical' : 'good') as 'critical' | 'good' }] : []),
          { value: 'closed', label: 'Closed', count: counts.closed, tone: 'good' as const },
          { value: 'all', label: 'Everything', count: counts.all, tone: 'neutral' as const },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search driver, bus, location…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All types</option>
          {(Object.keys(INCIDENT_TYPE_META) as IncidentType[]).map((t) => <option key={t} value={t}>{INCIDENT_TYPE_META[t].label}</option>)}
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
        {filtered && (
          <button onClick={() => { setDriver('all'); setMonth('all'); setDate(''); setType('all'); setQ('') }}
            className="rounded-lg border border-black/15 px-3 py-2 text-sm text-status-neutral hover:text-navy">Clear</button>
        )}
      </div>

      {nothingShown && (
        <div className="card px-5 py-14 text-center">
          {view === 'open' || view === 'mine' ? (
            <>
              <CheckCircle2 size={26} className="mx-auto mb-2 text-status-good" />
              <p className="text-sm font-medium text-navy">{view === 'mine' ? 'Nothing is waiting on you.' : 'No open incidents.'}</p>
              <p className="mt-1 text-sm text-status-neutral">
                {counts.closed > 0 ? <>All {counts.closed} incident{counts.closed === 1 ? '' : 's'} here { counts.closed === 1 ? 'has' : 'have'} been decided — <button onClick={() => setView('closed')} className="font-medium text-brand hover:underline">see the record</button>.</> : 'Nothing has been raised yet.'}
              </p>
            </>
          ) : (
            <>
              <ShieldAlert size={26} className="mx-auto mb-2 text-status-neutral" />
              <p className="text-sm text-status-neutral">
                No incidents match. {canPrepare ? 'Register one, or confirm a speed event and escalate it.' : 'Confirm a speed event and escalate it to start a case.'}
              </p>
            </>
          )}
        </div>
      )}

      {piles.mine.length > 0 && (
        <Section title="Waiting on you" tone="critical" count={piles.mine.length}
          note={canVerdict ? 'Your decision closes these.' : 'Investigate, attach the paperwork, then propose a verdict to Ops.'}>
          {piles.mine.map((g) => (
            <IncidentRow key={g.id} g={g} mine speedEvents={speedEvents} absorbed={absorbedSpeed} onOpen={() => setOpenId(g.lead.id)} />
          ))}
        </Section>
      )}

      {piles.others.length > 0 && (
        <Section title="Open — with someone else" tone="warning" count={piles.others.length}
          note="Raised and moving through the process. Nothing for you to do yet.">
          {piles.others.map((g) => (
            <IncidentRow key={g.id} g={g} speedEvents={speedEvents} absorbed={absorbedSpeed} onOpen={() => setOpenId(g.lead.id)} />
          ))}
        </Section>
      )}

      {piles.closed.length > 0 && (
        <Section title="Decided" tone="good" count={piles.closed.length} note="The record — what was charged, what was cleared, and by whom.">
          {(showAllClosed ? piles.closed : piles.closed.slice(0, 8)).map((g) => (
            <IncidentRow key={g.id} g={g} speedEvents={speedEvents} absorbed={absorbedSpeed} onOpen={() => setOpenId(g.lead.id)} />
          ))}
          {piles.closed.length > 8 && (
            <button onClick={() => setShowAllClosed((v) => !v)} className="w-full bg-canvas/60 px-5 py-2.5 text-xs font-medium text-brand hover:bg-canvas">
              {showAllClosed ? 'Show fewer' : `Show all ${piles.closed.length} decided`}
            </button>
          )}
        </Section>
      )}

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <CaseModal caseId={openId} open={!!openId} onClose={() => setOpenId(null)} canPrepare={canPrepare} canVerdict={canVerdict} />
      <RegisterIncidentModal open={registerOpen} onClose={() => setRegisterOpen(false)} branch={branch} />
    </div>
  )
}

// ── Pieces ─────────────────────────────────────────────────────────────

function Section({ title, count, tone, note, children }: {
  title: string; count: number; tone: 'critical' | 'warning' | 'good'; note: string; children: React.ReactNode
}) {
  return (
    <div className="card overflow-hidden">
      <div className={clsx('flex flex-wrap items-center gap-2 border-l-4 px-5 py-3',
        tone === 'critical' ? 'border-l-status-critical bg-status-critical/[0.03]'
          : tone === 'warning' ? 'border-l-status-warning bg-status-warning/[0.04]' : 'border-l-status-good bg-status-good/[0.03]')}>
        <h3 className="font-display text-sm font-bold text-navy">{title}</h3>
        <span className={clsx('rounded-full px-2 py-0.5 text-xs font-bold',
          tone === 'critical' ? 'bg-status-critical/10 text-status-critical'
            : tone === 'warning' ? 'bg-status-warning/15 text-[#8a6d10]' : 'bg-status-good/10 text-status-good')}>{count}</span>
        <span className="text-[11px] text-status-neutral">{note}</span>
      </div>
      <div className="divide-y divide-black/5">{children}</div>
    </div>
  )
}

function IncidentRow({ g, mine, speedEvents, absorbed, onOpen }: {
  g: CaseGroup
  mine?: boolean
  speedEvents: ReturnType<typeof useSpeedEvents>
  absorbed: Set<string>
  onOpen: () => void
}) {
  const c = g.lead
  const isSpeed = c.source === 'speed'
  const closed = g.stage === 'closed'
  const age = daysOpen(g)
  const rec = isSpeed ? recommendationForEvent(speedEvents, c.event_id, absorbed) : null
  const v = c.verdict
  const sanctions = (v?.decisions ?? []).filter((d) => d !== 'cleared')

  return (
    <button
      onClick={onOpen}
      className={clsx('flex w-full items-start gap-4 px-5 py-3.5 text-left transition-colors',
        mine ? 'bg-brand-tint/20 hover:bg-brand-tint/40' : 'hover:bg-canvas')}
    >
      <div className="min-w-0 flex-1">
        {/* Who and what */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-navy">{c.driver_name || c.title || INCIDENT_TYPE_META[c.incident_type].label}</span>
          <StatusBadge tone={INCIDENT_TYPE_META[c.incident_type].tone}>{INCIDENT_TYPE_META[c.incident_type].label}</StatusBadge>
          {!isSpeed && c.severity && <StatusBadge tone={SEVERITY_META[c.severity].tone}>{SEVERITY_META[c.severity].label}</StatusBadge>}
          {(c.repeat_total ?? 0) >= 2 && (
            <span className="rounded-full bg-status-critical/10 px-2 py-0.5 text-[10px] font-bold text-status-critical">repeat ×{c.repeat_total}</span>
          )}
          {g.cases.length > 1 && (
            <span className="rounded-full bg-navy/5 px-2 py-0.5 text-[10px] font-medium text-navy" title="Charges raised separately on the same journey, before readings were grouped. Shown together; each keeps its own proceedings.">
              {g.cases.length} charges · one journey
            </span>
          )}
        </div>

        {/* Where and when */}
        <div className="mt-0.5 text-xs text-status-neutral">
          {[c.vehicle_label, c.route].filter(Boolean).join(' · ')}
          {(c.vehicle_label || c.route) && ' · '}
          {fmtDate(c.event_datetime)}
        </div>

        {/* What happened */}
        <div className="mt-1.5 text-[13px] leading-relaxed text-navy">
          {isSpeed ? (
            <>
              <b>{c.over_by} km/h</b> over the {c.speed_limit} limit
              {g.trip && g.trip.breaches > 1 && (
                <span className="text-status-neutral"> · crossed the limit {g.trip.breaches} times on one journey ({tripSpan(g.trip)})</span>
              )}
            </>
          ) : (
            <span className="line-clamp-2">{c.description || INCIDENT_TYPE_META[c.incident_type].label}</span>
          )}
        </div>

        {/* Where it stands */}
        <div className="mt-1 text-xs">
          {closed && v ? (
            v.outcome === 'rejected' ? (
              <span className="text-status-neutral">Ops rejected the proposed verdict{v.notes ? ` — ${v.notes}` : ''}.</span>
            ) : sanctions.length === 0 ? (
              <span className="text-status-good">Cleared — no case to answer.</span>
            ) : (
              <span className="text-navy">
                {sanctions.map((d) => DECISION_LABEL[d]).join(', ')}
                {g.fine > 0 && <b> · K{g.fine.toLocaleString()}</b>}
                <span className="text-status-neutral"> · decided by {v.decided_by}</span>
              </span>
            )
          ) : c.proposal ? (
            <span className="text-status-neutral">
              Safety proposes <b className="text-navy">{c.proposal.decisions.map((d) => DECISION_LABEL[d]).join(', ') || 'no action'}</b>
              {c.proposal.fine_amount > 0 && <b className="text-navy"> · K{c.proposal.fine_amount.toLocaleString()}</b>}
            </span>
          ) : isSpeed ? (
            <span className="text-status-neutral">Recommended: <b className="text-navy">{rec ? penaltyLabel(rec) : (c.rec_action || '—')}</b></span>
          ) : (
            <span className="text-status-neutral">Awaiting Safety's investigation.</span>
          )}
        </div>
      </div>

      {/* Where in the process, and how long it has waited */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge tone={CASE_STAGE_META[g.stage].tone}>{CASE_STAGE_META[g.stage].label}</StatusBadge>
        {!closed && (
          <span className={clsx('inline-flex items-center gap-1 text-[11px]',
            age >= 14 ? 'font-semibold text-status-critical' : age >= 7 ? 'font-medium text-[#8a6d10]' : 'text-status-neutral')}>
            <Clock size={11} /> {age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} open`}
          </span>
        )}
        {g.openCount > 1 && <span className="text-[10px] text-status-neutral">{g.openCount} of {g.cases.length} still open</span>}
        <span className="text-[10px] text-status-neutral">Step {currentStepIndex(g.stage) + 1} of {CASE_STEPS.length}</span>
        <span className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-brand">
          {mine ? (g.stage === 'ops_review' ? 'Decide' : 'Review') : closed ? 'Open record' : 'View'} <ChevronRight size={12} />
        </span>
      </div>
    </button>
  )
}
