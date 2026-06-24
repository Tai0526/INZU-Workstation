import { useMemo, useState } from 'react'
import { Search, Pencil, Sun, Moon, Users, Coffee, Bus, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { SECTIONS } from '@/lib/org/sections'
import StatusBadge from '@/components/ui/StatusBadge'
import DriverDetail from '@/components/drivers/DriverDetail'
import ReassignModal from '@/components/drivers/ReassignModal'
import { useDrivers, driversStore } from '@/lib/drivers/store'
import { type Driver, SHIFT_STATE_META, driverShiftState } from '@/lib/drivers/types'
import { useCrews, useScheduling, crewLabel } from '@/lib/drivers/scheduling'
import { scheduledShift, SHIFT_META, shiftHours, type ShiftKind } from '@/lib/drivers/schedule'
import { useWeeklyAssign } from '@/lib/operations/store'
import { buildAssignmentIndex, dutyOn } from '@/lib/drivers/duty'

const onShift = (d: Driver) => { const s = driverShiftState(d); return s === 'on_shift' || s === 'overtime' }
const kindOf = (d: Driver): ShiftKind => SHIFT_META[scheduledShift(d)].kind
const SECTION_CHIP = 'rounded-full bg-navy/5 px-2 py-0.5 text-[10px] font-medium text-navy'
const bySectionName = (a: Driver, b: Driver) => a.section.localeCompare(b.section) || a.full_name.localeCompare(b.full_name)
type Idx = ReturnType<typeof buildAssignmentIndex>

export default function DriverRoster() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const editable = canEdit(role, 'drivers')
  const canToggle = ROLES[role].canToggleBranch

  const all = useDrivers()
  const crews = useCrews()
  const assigns = useWeeklyAssign()
  const today = new Date().toISOString().slice(0, 10)
  const idx = useMemo(() => buildAssignmentIndex(assigns.filter((a) => a.branch === branch)), [assigns, branch])

  const [q, setQ] = useState('')
  const [section, setSection] = useState('all')
  const [detail, setDetail] = useState<Driver | null>(null)
  const [reassign, setReassign] = useState<Driver | null>(null)

  const branchDrivers = useMemo(() => all.filter((d) => d.branch === branch), [all, branch])

  const sectionStats = useMemo(() => SECTIONS[branch].map((s) => {
    const list = branchDrivers.filter((d) => d.section === s)
    return {
      section: s, total: list.length, onNow: list.filter(onShift).length,
      crewCounts: crews.map((c) => ({ label: c.label, n: list.filter((d) => d.crew === c.id).length })),
    }
  }), [branchDrivers, branch, crews])

  const drivers = useMemo(() => {
    const term = q.trim().toLowerCase()
    return branchDrivers
      .filter((d) => section === 'all' || d.section === section)
      .filter((d) => !term || [d.full_name, d.employee_no, d.section].some((f) => f.toLowerCase().includes(term)))
  }, [branchDrivers, q, section])

  const dayList = drivers.filter((d) => kindOf(d) === 'day').sort(bySectionName)
  const nightList = drivers.filter((d) => kindOf(d) === 'night').sort(bySectionName)
  const restList = drivers.filter((d) => kindOf(d) === 'off').sort(bySectionName)

  return (
    <div className="page space-y-5">
      <p className="max-w-2xl text-sm text-status-neutral">
        Today's roster by shift — who's on Day, on Night, and on rest, from each driver's rotation, with the bus they're on (set in the Weekly Plan). Off-duty drivers covering a shift show as Overtime.
      </p>

      {/* Section staffing */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3"><Users size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Section staffing</h3><span className="text-[11px] text-status-neutral">tap to filter</span></div>
        <div className="grid grid-cols-2 gap-px bg-black/5 sm:grid-cols-3 lg:grid-cols-6">
          {sectionStats.map((s) => {
            const active = section === s.section
            const thin = s.total > 0 && s.onNow === 0
            return (
              <button key={s.section} onClick={() => setSection(active ? 'all' : s.section)}
                className={clsx('bg-surface px-4 py-3 text-left transition-colors hover:bg-canvas', active && 'ring-2 ring-inset ring-brand')}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-navy">{s.section}</span>
                  <span className="text-lg font-bold text-navy">{s.total}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px]">
                  <span className={clsx('rounded-full px-1.5 py-0.5 font-medium', s.onNow === 0 ? 'bg-status-critical/10 text-status-critical' : 'bg-status-good/10 text-status-good')}>{s.onNow} on now</span>
                  <span className="text-status-neutral">{s.crewCounts.map((c) => `${c.label}${c.n}`).join(' · ')}</span>
                </div>
                {thin && <div className="mt-0.5 text-[10px] font-medium text-status-critical">no cover on shift</div>}
                {s.total === 0 && <div className="mt-0.5 text-[10px] font-medium text-status-critical">no drivers</div>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search driver, employee no, section…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={section} onChange={(e) => setSection(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All sections</option>
          {SECTIONS[branch].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Three shift columns: Day · Night · Off */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ShiftColumn kind="day" icon={Sun} title="Day shift today" drivers={dayList} editable={editable} idx={idx} today={today} onOpen={setDetail} onReassign={setReassign} />
        <ShiftColumn kind="night" icon={Moon} title="Night shift today" drivers={nightList} editable={editable} idx={idx} today={today} onOpen={setDetail} onReassign={setReassign} />
        <ShiftColumn kind="off" icon={Coffee} title="Off / rest today" drivers={restList} editable={editable} idx={idx} today={today} onOpen={setDetail} onReassign={setReassign} />
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only — your role is locked to this branch.</p>}

      <DriverDetail driver={detail} open={!!detail} onClose={() => setDetail(null)} canEdit={false} onEdit={() => { if (detail) { setReassign(detail); setDetail(null) } }} />
      <ReassignModal driver={reassign} open={!!reassign} onClose={() => setReassign(null)} />
    </div>
  )
}

const HEAD_TONE: Record<ShiftKind, string> = { day: 'bg-[#FCEAD3]', night: 'bg-[#DDE4F3]', off: 'bg-canvas/60' }

function VehicleChip({ fleet }: { fleet: string }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand"><Bus size={10} /> {fleet}</span>
}

function ShiftColumn({
  kind, icon: Icon, title, drivers, editable, idx, today, onOpen, onReassign,
}: {
  kind: ShiftKind
  icon: LucideIcon
  title: string
  drivers: Driver[]
  editable: boolean
  idx: Idx
  today: string
  onOpen: (d: Driver) => void
  onReassign: (d: Driver) => void
}) {
  const sched = useScheduling()
  const onNow = kind !== 'off' ? drivers.filter(onShift).length : 0
  return (
    <div className="card flex flex-col overflow-hidden">
      <div className={clsx('flex items-center gap-2 border-b border-black/5 px-4 py-3', HEAD_TONE[kind])}>
        <Icon size={16} className="text-navy" />
        <h3 className="font-display text-sm font-bold text-navy">{title}</h3>
        <span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold text-navy">
          {kind === 'off' ? `${drivers.length} resting` : `${onNow}/${drivers.length} on now`}
        </span>
      </div>
      <div className="max-h-[70vh] divide-y divide-black/5 overflow-y-auto">
        {drivers.map((d) => {
          const state = driverShiftState(d)
          const meta = SHIFT_STATE_META[state]
          const schedHours = shiftHours(scheduledShift(d))
          const duty = dutyOn(d, today, idx)
          const isOT = kind === 'off' && (duty.kind === 'overtime' || d.overtime)
          const showVehicle = duty.vehicle && (kind !== 'off' || isOT)
          return (
            <div key={d.id} className="flex items-center gap-2 px-4 py-2 hover:bg-canvas">
              <button onClick={() => onOpen(d)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium text-navy">{d.full_name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-status-neutral">
                  <span className={SECTION_CHIP}>{d.section}</span>
                  {kind === 'off' ? <span>Crew {crewLabel(sched, d.crew)}</span> : <span title={schedHours}>{schedHours}</span>}
                  {showVehicle && <VehicleChip fleet={duty.vehicle} />}
                </div>
              </button>
              {kind === 'off'
                ? (isOT
                  ? <StatusBadge tone="warning">Overtime</StatusBadge>
                  : <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-status-neutral">Rest</span>)
                : <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>}
              {editable && kind === 'off' && !duty.overtime && (
                <button onClick={() => driversStore.update(d.id, { overtime: !d.overtime })}
                  className={clsx('shrink-0 rounded-md px-1.5 py-1 text-[10px] font-medium', d.overtime ? 'bg-status-warning/15 text-[#8a6d10] hover:bg-status-warning/25' : 'text-status-neutral hover:bg-white hover:text-navy')}
                  title={d.overtime ? 'Clear overtime' : 'Mark as covering today (overtime)'}>
                  {d.overtime ? '✓' : 'Cover'}
                </button>
              )}
              {editable && (
                <button onClick={() => onReassign(d)} className="shrink-0 rounded-md p-1 text-status-neutral hover:bg-white hover:text-navy" title="Reassign crew / section">
                  <Pencil size={13} />
                </button>
              )}
            </div>
          )
        })}
        {drivers.length === 0 && <p className="px-4 py-8 text-center text-sm text-status-neutral">None {kind === 'off' ? 'on rest' : `on ${kind}`} today.</p>}
      </div>
    </div>
  )
}
