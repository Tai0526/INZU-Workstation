import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Upload, Download, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import StatChips from '@/components/ui/StatChips'
import SpeedEventModal from '@/components/speed/SpeedEventModal'
import SpeedImportModal from '@/components/speed/SpeedImportModal'
import { useSpeedEvents, speedStore } from '@/lib/speed/store'
import { useCases, CASE_STAGE_META } from '@/lib/safety/cases'
import { type SpeedEvent, type SpeedStatus, STATUS_META, overBy, countsAgainstDriver, offenceNumberInBand, penaltyFor, penaltyTone, penaltyLabel } from '@/lib/speed/types'

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
  const [editing, setEditing] = useState<SpeedEvent | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const branchEvents = useMemo(() => all.filter((e) => e.branch === branch), [all, branch])

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

  const counts = useMemo(() => ({
    total: branchEvents.length,
    flagged: branchEvents.filter((e) => e.status === 'flagged').length,
    confirmed: branchEvents.filter((e) => e.status === 'confirmed').length,
    disputed: branchEvents.filter((e) => e.status === 'disputed').length,
    closed: branchEvents.filter((e) => e.status === 'closed').length,
  }), [branchEvents])

  // Per-driver offence tally (counts against = flagged/confirmed) for repeat flags.
  const offenceCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of branchEvents) {
      if (!countsAgainstDriver(e)) continue
      const k = e.driver_id || e.driver_name
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [branchEvents])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return branchEvents
      .filter((e) => statusFilter === 'all' || e.status === statusFilter)
      .filter((e) => !term || [e.driver_name, e.vehicle_label, e.route].some((f) => f.toLowerCase().includes(term)))
      .sort((a, b) => b.event_datetime.localeCompare(a.event_datetime))
  }, [branchEvents, q, statusFilter])

  function openAdd() { setEditing(null); setModalOpen(true) }
  function openRow(e: SpeedEvent) { setEditing(e); setModalOpen(true) }

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          Every Geotab-flagged event, linked to its driver, vehicle and route. Repeat offenders are flagged so patterns surface early.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => exportEvents(rows, branchLabel)}><Download size={15} /> Export</Button>
          {editable && <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Import</Button>}
          {editable && <Button onClick={openAdd}><Plus size={15} /> Log event</Button>}
        </div>
      </div>

      <StatChips
        active={statusFilter}
        onPick={(v) => setStatusFilter(v)}
        stats={[
          { value: 'all', label: 'All', count: counts.total, tone: 'neutral' },
          { value: 'flagged', label: 'Flagged', count: counts.flagged, tone: 'neutral' },
          { value: 'confirmed', label: 'Confirmed', count: counts.confirmed, tone: 'good' },
          { value: 'disputed', label: 'Disputed', count: counts.disputed, tone: 'warning' },
          { value: 'closed', label: 'Closed', count: counts.closed, tone: 'good' },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search driver, vehicle, route…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All statuses</option>
          {(Object.keys(STATUS_META) as SpeedStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 font-medium">Date / time</th>
                <th className="px-4 py-2.5 font-medium">Driver</th>
                <th className="px-4 py-2.5 font-medium">Vehicle</th>
                <th className="px-4 py-2.5 font-medium">Route</th>
                <th className="px-4 py-2.5 font-medium">Speed</th>
                <th className="px-4 py-2.5 font-medium">Recommended charge</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => {
                const count = offenceCount.get(e.driver_id || e.driver_name) ?? 0
                const penalty = penaltyFor(overBy(e), offenceNumberInBand(branchEvents, e))
                return (
                  <tr key={e.id} className={`cursor-pointer ${i % 2 ? 'bg-canvas/40' : ''} hover:bg-canvas`} onClick={() => openRow(e)}>
                    <td className="px-4 py-2.5 text-navy">{e.event_datetime.slice(0, 10)} <span className="text-status-neutral">{e.event_datetime.slice(11, 16)}</span></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-navy">{e.driver_name}</span>
                        {count >= 3 && <span className="inline-flex items-center gap-0.5 rounded-full bg-status-critical/10 px-1.5 py-0.5 text-[10px] font-bold text-status-critical"><AlertTriangle size={10} /> repeat ×{count}</span>}
                        {count === 2 && <span className="rounded-full bg-status-warning/10 px-1.5 py-0.5 text-[10px] font-bold text-[#8a6d10]">×2</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-status-neutral">{e.vehicle_label || '—'}</td>
                    <td className="px-4 py-2.5 text-status-neutral">{e.route || '—'}</td>
                    <td className="px-4 py-2.5 text-navy">{e.recorded_speed}/{e.speed_limit} <span className="text-status-critical">+{overBy(e)}</span></td>
                    <td className={`px-4 py-2.5 text-xs font-medium ${penalty ? PENALTY_TEXT[penaltyTone(penalty)] : 'text-status-neutral'}`}>
                      {penalty ? penaltyLabel(penalty) : (countsAgainstDriver(e) ? '—' : 'Not charged')}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge tone={STATUS_META[e.status].tone}>{STATUS_META[e.status].label}</StatusBadge>
                      {caseByEvent.get(e.id) && (
                        <div className="mt-0.5 text-[11px] text-status-neutral">→ Incident: {CASE_STAGE_META[caseByEvent.get(e.id)!.stage].label}</div>
                      )}
                    </td>
                  </tr>
                )
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
