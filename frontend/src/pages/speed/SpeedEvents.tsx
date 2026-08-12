import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Upload, Download, AlertTriangle, ChevronRight, ChevronDown, Lock } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { useDeepLink } from '@/lib/ui/deeplink'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import StatChips from '@/components/ui/StatChips'
import { SortTh, useSort, sortRows } from '@/components/ui/SortTh'
import SpeedEventModal from '@/components/speed/SpeedEventModal'
import SpeedImportModal from '@/components/speed/SpeedImportModal'
import { useSpeedEvents, speedStore } from '@/lib/speed/store'
import { useCases, CASE_STAGE_META } from '@/lib/safety/cases'
import { tripSpan, type SpeedTrip } from '@/lib/speed/trips'
import { useSpeedTrips } from '@/lib/speed/useTrips'
import { type SpeedEvent, type SpeedStatus, STATUS_META, overBy, countsAgainstDriver, offenceNumberInBand, penaltyFor, penaltyTone, penaltyLabel, monthKey, monthLabel } from '@/lib/speed/types'

const PENALTY_TEXT: Record<string, string> = {
  critical: 'text-status-critical', warning: 'text-[#8a6d10]', good: 'text-status-good', neutral: 'text-status-neutral',
}
import { exportEvents } from '@/lib/speed/excel'

export default function SpeedEvents() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const editable = canEdit(role, 'speed')
  const canToggle = ROLES[role].canToggleBranch

  const all = useSpeedEvents()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | SpeedStatus>('all')
  useDeepLink(['status'], (p) => { const s = p.get('status'); if (s) setStatusFilter(s as SpeedStatus) })
  const [editing, setEditing] = useState<SpeedEvent | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [month, setMonth] = useState('all')
  const [vehicle, setVehicle] = useState('all')
  const [driver, setDriver] = useState('all')
  const [date, setDate] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { key: sortKey, dir, toggle } = useSort('when', 'desc')

  const branchEvents = useMemo(() => all.filter((e) => e.branch === branch), [all, branch])

  // A bus crossing the limit fifteen times on one run to the gate is one bad
  // journey, not fifteen offences — so the page works in journeys. The worst
  // reading carries the charge; the rest sit under it as evidence.
  const { trips, absorbed } = useSpeedTrips(branch)

  // Filter options, derived from the branch's events.
  const months = useMemo(() => [...new Set(branchEvents.map((e) => monthKey(e.event_datetime)))].sort().reverse(), [branchEvents])
  const vehicleOpts = useMemo(() => [...new Set(branchEvents.map((e) => e.vehicle_label).filter(Boolean))].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })), [branchEvents])
  const driverOpts = useMemo(() => [...new Set(branchEvents.map((e) => e.driver_name).filter(Boolean))].sort(), [branchEvents])

  const cases = useCases()
  const caseByEvent = useMemo(() => {
    const m = new Map<string, (typeof cases)[number]>()
    for (const c of cases) if (c.event_id) m.set(c.event_id, c)
    return m
  }, [cases])

  // Heal legacy data: an event whose incident is already closed should read as
  // closed too (new closures are handled when the verdict is recorded).
  useEffect(() => {
    for (const e of branchEvents) {
      const cs = caseByEvent.get(e.id)
      if (cs && cs.stage === 'closed' && e.status !== 'closed') speedStore.setStatus(e.id, 'closed')
    }
  }, [branchEvents, caseByEvent])

  // Everything matching the month/bus/driver/search filters (but not status) —
  // drives both the status chips (so their counts reflect the current view) and
  // the table (which then also applies the status filter). A journey matches the
  // search if ANY of its readings does, so searching a location partway through
  // a run still finds it.
  const scoped = useMemo(() => {
    const term = q.trim().toLowerCase()
    return trips
      .filter((t) => month === 'all' || monthKey(t.lead.event_datetime) === month)
      .filter((t) => vehicle === 'all' || t.lead.vehicle_label === vehicle)
      .filter((t) => driver === 'all' || t.lead.driver_name === driver)
      .filter((t) => !date || t.lead.event_datetime.slice(0, 10) === date)
      .filter((t) => !term || t.events.some((e) => [e.driver_name, e.vehicle_label, e.route].some((f) => (f || '').toLowerCase().includes(term))))
  }, [trips, q, month, vehicle, driver, date])

  const counts = useMemo(() => {
    const by = (s: SpeedStatus) => scoped.filter((t) => t.lead.status === s).length
    return {
      total: scoped.length,
      pending: by('pending'), flagged: by('flagged'), confirmed: by('confirmed'),
      disputed: by('disputed'), dismissed: by('dismissed'), closed: by('closed'),
    }
  }, [scoped])

  // Per-driver offence tally for the repeat flags — one per journey, so a driver
  // is not branded a repeat offender for a single run that tripped the tracker
  // a dozen times.
  const offenceCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of branchEvents) {
      if (!countsAgainstDriver(e) || absorbed.has(e.id)) continue
      const k = e.driver_id || e.driver_name
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [branchEvents, absorbed])

  const rows = useMemo(() => {
    const acc: Record<string, (t: SpeedTrip) => string | number> = {
      when: (t) => t.lead.event_datetime,
      driver: (t) => (t.lead.driver_name || '').toLowerCase(),
      vehicle: (t) => t.lead.vehicle_label || '',
      route: (t) => (t.lead.route || '').toLowerCase(),
      speed: (t) => overBy(t.lead),
      charge: (t) => penaltyFor(overBy(t.lead), offenceNumberInBand(branchEvents, t.lead, absorbed))?.fine ?? 0,
      status: (t) => STATUS_META[t.lead.status].label,
    }
    const filtered = scoped.filter((t) => statusFilter === 'all' || t.lead.status === statusFilter)
    return sortRows(filtered, acc[sortKey] ?? acc.when, dir)
  }, [scoped, statusFilter, sortKey, dir, branchEvents, absorbed])

  const grouped = useMemo(() => rows.filter((t) => t.breaches > 1).length, [rows])

  function openAdd() { setEditing(null); setModalOpen(true) }
  function openRow(e: SpeedEvent) { setEditing(e); setModalOpen(true) }
  function toggleTrip(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          One row per <b className="text-navy">journey</b>, not per tracker ping. A bus that crosses the limit repeatedly on the same run
          answers once, for its worst reading — open the row to see every breach behind it.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => exportEvents(rows.map((t) => t.lead), branchLabel)}><Download size={15} /> Export</Button>
          {editable && <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Import</Button>}
          {editable && <Button onClick={openAdd}><Plus size={15} /> Log event</Button>}
        </div>
      </div>

      <StatChips
        active={statusFilter}
        onPick={(v) => setStatusFilter(v)}
        stats={[
          { value: 'all', label: 'All', count: counts.total, tone: 'neutral' },
          { value: 'pending', label: 'Pending driver', count: counts.pending, tone: 'warning' },
          { value: 'confirmed', label: 'Confirmed', count: counts.confirmed, tone: 'good' },
          { value: 'disputed', label: 'Disputed', count: counts.disputed, tone: 'warning' },
          { value: 'dismissed', label: 'Written off', count: counts.dismissed, tone: 'neutral' },
          { value: 'closed', label: 'Closed', count: counts.closed, tone: 'good' },
          ...(counts.flagged ? [{ value: 'flagged' as const, label: 'Flagged', count: counts.flagged, tone: 'neutral' as const }] : []),
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[170px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search driver, vehicle, route…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All months</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All buses</option>
          {vehicleOpts.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={driver} onChange={(e) => setDriver(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All drivers</option>
          {driverOpts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title="Filter by date" className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All statuses</option>
          {(Object.keys(STATUS_META) as SpeedStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        {(month !== 'all' || vehicle !== 'all' || driver !== 'all' || !!date || statusFilter !== 'all' || q) && (
          <button onClick={() => { setMonth('all'); setVehicle('all'); setDriver('all'); setDate(''); setStatusFilter('all'); setQ('') }}
            className="rounded-lg border border-black/15 px-3 py-2 text-sm text-status-neutral hover:text-navy">Clear</button>
        )}
        <span className="ml-auto text-xs text-status-neutral">
          {rows.length} journey{rows.length === 1 ? '' : 's'}{grouped > 0 && ` · ${grouped} with repeat breaches`}
        </span>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <SortTh label="Date / time" k="when" sortKey={sortKey} dir={dir} onSort={toggle} />
                <SortTh label="Driver" k="driver" sortKey={sortKey} dir={dir} onSort={toggle} />
                <SortTh label="Vehicle" k="vehicle" sortKey={sortKey} dir={dir} onSort={toggle} />
                <SortTh label="Route" k="route" sortKey={sortKey} dir={dir} onSort={toggle} />
                <SortTh label="Speed" k="speed" sortKey={sortKey} dir={dir} onSort={toggle} />
                <SortTh label="Recommended charge" k="charge" sortKey={sortKey} dir={dir} onSort={toggle} />
                <SortTh label="Status" k="status" sortKey={sortKey} dir={dir} onSort={toggle} />
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((t, i) => {
                const e = t.lead
                const count = offenceCount.get(e.driver_id || e.driver_name) ?? 0
                const penalty = penaltyFor(overBy(e), offenceNumberInBand(branchEvents, e, absorbed))
                const many = t.breaches > 1
                const open = expanded.has(t.id)
                const row = (
                  <tr key={t.id} className={`cursor-pointer align-top ${i % 2 ? 'bg-canvas/40' : ''} ${open ? 'bg-canvas' : 'hover:bg-canvas'}`} onClick={() => openRow(e)}>
                    <td className="px-4 py-2.5 text-navy">
                      <div className="flex items-start gap-1.5">
                        {many ? (
                          <button
                            type="button"
                            onClick={(ev) => { ev.stopPropagation(); toggleTrip(t.id) }}
                            title={open ? 'Hide the readings in this journey' : `Show all ${t.breaches} readings in this journey`}
                            className="-ml-1 mt-0.5 rounded p-0.5 text-status-neutral hover:bg-navy/5 hover:text-navy"
                          >
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        ) : <span className="w-[15px]" />}
                        <div>
                          {e.event_datetime.slice(0, 10)} <span className="text-status-neutral">{tripSpan(t)}</span>
                          {many && (
                            <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-navy/5 px-1.5 py-0.5 text-[10px] font-semibold text-navy">
                              {t.breaches} breaches · one journey
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${e.driver_name ? 'text-navy' : 'italic text-status-warning'}`}>{e.driver_name || 'Confirm driver'}</span>
                        {count >= 3 && <span className="inline-flex items-center gap-0.5 rounded-full bg-status-critical/10 px-1.5 py-0.5 text-[10px] font-bold text-status-critical"><AlertTriangle size={10} /> repeat ×{count}</span>}
                        {count === 2 && <span className="rounded-full bg-status-warning/10 px-1.5 py-0.5 text-[10px] font-bold text-[#8a6d10]">×2</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-status-neutral">{e.vehicle_label || '—'}</td>
                    <td className="px-4 py-2.5 text-status-neutral">{e.route || '—'}</td>
                    <td className="px-4 py-2.5 text-navy">
                      {e.recorded_speed}/{e.speed_limit} <span className="text-status-critical">+{overBy(e)}</span>
                      {many && <div className="text-[10px] text-status-neutral">worst of {t.breaches}</div>}
                    </td>
                    <td className={`px-4 py-2.5 text-xs font-medium ${penalty ? PENALTY_TEXT[penaltyTone(penalty)] : 'text-status-neutral'}`}>
                      {penalty ? penaltyLabel(penalty) : (countsAgainstDriver(e) ? '—' : 'Not charged')}
                      {many && penalty && <div className="mt-0.5 font-normal text-status-neutral">charged once for the journey</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge tone={STATUS_META[e.status].tone}>{STATUS_META[e.status].label}</StatusBadge>
                      {caseByEvent.get(e.id) && (
                        <div className="mt-0.5 text-[11px] text-status-neutral">→ Incident: {CASE_STAGE_META[caseByEvent.get(e.id)!.stage].label}</div>
                      )}
                      {t.locked && (
                        <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-status-neutral" title="An incident already exists on this journey, so it is left exactly as it was raised.">
                          <Lock size={9} /> left as raised
                        </div>
                      )}
                    </td>
                  </tr>
                )
                if (!open || !many) return [row]
                // The readings behind a journey, revealed under its row. Read-only:
                // the journey is decided as a whole, on the row above.
                return [row, (
                  <tr key={`${t.id}-detail`} className="bg-canvas">
                    <td colSpan={7} className="px-4 pb-3 pt-0">
                      <div className="ml-5 overflow-hidden rounded-lg border border-black/10 bg-surface">
                        <div className="border-b border-black/5 px-3 py-1.5 text-[11px] text-status-neutral">
                          {t.vehicle_label} crossed the limit <b className="text-navy">{t.breaches} times</b> between {t.startISO.slice(11, 16)} and {t.endISO.slice(11, 16)} — the worst reading carries the charge, the rest show how sustained it was.
                        </div>
                        <table className="w-full text-left text-xs">
                          <tbody>
                            {t.events.map((x) => {
                              const isLead = x.id === t.lead.id
                              return (
                                <tr key={x.id} className={`border-b border-black/5 last:border-0 ${isLead ? 'bg-status-critical/[0.04]' : ''}`}>
                                  <td className="w-16 px-3 py-1 font-medium text-navy">{x.event_datetime.slice(11, 16)}</td>
                                  <td className="w-28 px-3 py-1 text-navy">{x.recorded_speed}/{x.speed_limit} <span className="text-status-critical">+{overBy(x)}</span></td>
                                  <td className="w-24 px-3 py-1">
                                    {isLead && <span className="rounded-full bg-status-critical/10 px-1.5 py-0.5 text-[10px] font-bold text-status-critical">worst</span>}
                                  </td>
                                  <td className="px-3 py-1 text-status-neutral">{x.route || '—'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )]
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-status-neutral">No speed events match. {editable && 'Log one or import past events.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only — branch switching here is limited to senior management.</p>}

      <SpeedEventModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} branch={branch} canEdit={editable} />
      <SpeedImportModal open={importOpen} onClose={() => setImportOpen(false)} branch={branch} />
    </div>
  )
}
