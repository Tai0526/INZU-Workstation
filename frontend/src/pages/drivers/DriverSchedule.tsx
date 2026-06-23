import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search, CalendarDays, FileBarChart } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { SECTIONS } from '@/lib/org/sections'
import Button from '@/components/ui/Button'
import SetScheduleModal from '@/components/drivers/SetScheduleModal'
import DutyReportModal from '@/components/drivers/DutyReportModal'
import { useDrivers } from '@/lib/drivers/store'
import type { Driver } from '@/lib/drivers/types'
import { ROTATIONS, SHIFT_META, shiftOnDate, patternKeyFor, anchorFor, type ShiftKind } from '@/lib/drivers/schedule'
import { useWeeklyAssign } from '@/lib/operations/store'
import { buildAssignmentIndex, dutyOn } from '@/lib/drivers/duty'

const pad = (n: number) => String(n).padStart(2, '0')
const KIND_CELL: Record<ShiftKind, string> = {
  day: 'bg-[#FCEAD3] text-[#8a4513]',
  night: 'bg-[#DDE4F3] text-[#283a66]',
  off: 'bg-white text-status-neutral/40',
}
const OT_CELL = 'bg-status-warning/30 text-[#8a6d10]'

export default function DriverSchedule() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[role].canToggleBranch
  const editable = canEdit(role, 'drivers')

  const all = useDrivers()
  const assigns = useWeeklyAssign()
  const branchAssigns = useMemo(() => assigns.filter((a) => a.branch === branch), [assigns, branch])
  const idx = useMemo(() => buildAssignmentIndex(branchAssigns), [branchAssigns])
  const [q, setQ] = useState('')
  const [section, setSection] = useState('all')
  const [ym, setYm] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() } })
  const [picker, setPicker] = useState<Driver | null>(null)
  const [reportOpen, setReportOpen] = useState(false)

  const monthDate = new Date(ym.y, ym.m, 1)
  const monthLabel = monthDate.toLocaleDateString('en', { month: 'long', year: 'numeric' })
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate()
  const todayISO = new Date().toISOString().slice(0, 10)
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1
    const dateISO = `${ym.y}-${pad(ym.m + 1)}-${pad(day)}`
    const dow = new Date(ym.y, ym.m, day).getDay()
    return { day, dateISO, weekend: dow === 0 || dow === 6, label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][dow] }
  }), [ym, daysInMonth])

  const drivers = useMemo(() => {
    const term = q.trim().toLowerCase()
    return all
      .filter((d) => d.branch === branch)
      .filter((d) => section === 'all' || d.section === section)
      .filter((d) => !term || [d.full_name, d.employee_no, d.section].some((f) => f.toLowerCase().includes(term)))
      .sort((a, b) => a.section.localeCompare(b.section) || a.full_name.localeCompare(b.full_name))
  }, [all, branch, q, section])

  // Coverage per day across the shown drivers.
  const coverage = useMemo(() => days.map((d) => {
    let day = 0, night = 0
    for (const dr of drivers) {
      const k = SHIFT_META[shiftOnDate(patternKeyFor(dr), anchorFor(dr), d.dateISO)].kind
      if (k === 'day') day++; else if (k === 'night') night++
    }
    return { day, night }
  }), [days, drivers])

  function shiftMonth(delta: number) {
    const d = new Date(ym.y, ym.m + delta, 1)
    setYm({ y: d.getFullYear(), m: d.getMonth() })
  }

  return (
    <div className="page space-y-5">
      <p className="max-w-3xl text-sm text-status-neutral">
        Each driver's work/rest rotation across the month — Day, Night or Off. Days they cover while off (from the Weekly Plan) show as <span className="font-semibold text-[#8a6d10]">OT</span>; hover any cell for the bus. {editable && 'Click a driver to set their pattern.'}
      </p>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-black/15 bg-white">
          <button onClick={() => shiftMonth(-1)} className="rounded-l-lg px-2 py-2 text-status-neutral hover:bg-canvas"><ChevronLeft size={16} /></button>
          <span className="min-w-[140px] px-2 text-center text-sm font-semibold text-navy">{monthLabel}</span>
          <button onClick={() => shiftMonth(1)} className="rounded-r-lg px-2 py-2 text-status-neutral hover:bg-canvas"><ChevronRight size={16} /></button>
        </div>
        <Button variant="secondary" onClick={() => { const n = new Date(); setYm({ y: n.getFullYear(), m: n.getMonth() }) }}><CalendarDays size={15} /> This month</Button>
        <Button variant="secondary" onClick={() => setReportOpen(true)}><FileBarChart size={15} /> Duty report</Button>
        <div className="relative min-w-[180px] flex-1 max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search driver…" className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={section} onChange={(e) => setSection(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All sections</option>
          {SECTIONS[branch].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-[#FCEAD3]" /> <b className="text-navy">Day</b> <span className="text-status-neutral">split 03–09 &amp; 14–20 · cont. 06–18</span></span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-[#DDE4F3]" /> <b className="text-navy">Night</b> <span className="text-status-neutral">split 11–16 &amp; 20–02 · cont. 18–06</span></span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border border-black/10 bg-white" /> <span className="text-status-neutral">Off / rest</span></span>
        <span className="inline-flex items-center gap-1.5"><span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-status-warning/30 text-[7px] font-bold text-[#8a6d10]">OT</span> <span className="text-status-neutral">Overtime (covering off-day)</span></span>
      </div>

      {/* Calendar grid */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-canvas/60">
                <th className="sticky left-0 z-10 bg-canvas/60 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-status-neutral">Driver</th>
                {days.map((d) => (
                  <th key={d.day} className={clsx('w-7 px-0 py-1 text-center text-[10px] font-medium', d.weekend ? 'bg-black/[0.03] text-status-neutral' : 'text-status-neutral', d.dateISO === todayISO && 'bg-brand/15 text-brand')}>
                    <div>{d.label}</div><div className="text-[11px] font-bold text-navy">{d.day}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.map((dr) => {
                const patt = patternKeyFor(dr)
                return (
                  <tr key={dr.id} className="border-b border-black/5">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                      <button onClick={() => editable && setPicker(dr)} className={clsx('block max-w-[170px] text-left', editable && 'hover:text-brand')} disabled={!editable}>
                        <span className="block truncate text-[13px] font-medium text-navy">{dr.full_name}</span>
                        <span className="block truncate text-[10px] text-status-neutral">{dr.section} · {ROTATIONS[patt]?.label.split(' — ')[0]}</span>
                      </button>
                    </td>
                    {days.map((d) => {
                      const duty = dutyOn(dr, d.dateISO, idx)
                      const meta = SHIFT_META[duty.shift]
                      const isOT = duty.kind === 'overtime'
                      const tip = `${dr.full_name} · ${d.dateISO} — ${isOT ? `Overtime${duty.vehicle ? ` on ${duty.vehicle}` : ''}` : `${meta.label}${meta.kind !== 'off' ? ` (${meta.hours})` : ''}${duty.vehicle ? ` · ${duty.vehicle}` : ''}`}`
                      return (
                        <td key={d.day} className={clsx('h-8 w-7 border-l border-black/5 text-center', d.weekend && meta.kind === 'off' && !isOT && 'bg-black/[0.02]')}>
                          <span className={clsx('mx-auto flex h-7 w-6 items-center justify-center rounded text-[11px] font-bold', isOT ? OT_CELL : KIND_CELL[meta.kind], d.dateISO === todayISO && 'ring-1 ring-brand')} title={tip}>
                            {isOT ? 'OT' : meta.short}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {drivers.length === 0 && (
                <tr><td colSpan={days.length + 1} className="px-4 py-12 text-center text-sm text-status-neutral">No drivers match.</td></tr>
              )}
            </tbody>
            {drivers.length > 0 && (
              <tfoot>
                <CoverageRow label="On day" kind="day" cov={coverage} />
                <CoverageRow label="On night" kind="night" cov={coverage} />
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <SetScheduleModal driver={picker} open={!!picker} onClose={() => setPicker(null)} />
      <DutyReportModal open={reportOpen} onClose={() => setReportOpen(false)} drivers={drivers} assigns={branchAssigns} branchLabel={branchLabel} month={ym} />
    </div>
  )
}

function CoverageRow({ label, kind, cov }: { label: string; kind: 'day' | 'night'; cov: { day: number; night: number }[] }) {
  return (
    <tr className="border-t border-black/10 bg-canvas/40">
      <td className="sticky left-0 z-10 bg-canvas/40 px-3 py-1.5 text-[11px] font-semibold text-navy">{label}</td>
      {cov.map((c, i) => {
        const n = kind === 'day' ? c.day : c.night
        return <td key={i} className={clsx('w-7 py-1 text-center text-[11px] font-medium', n === 0 ? 'text-status-critical' : 'text-status-neutral')}>{n || '·'}</td>
      })}
    </tr>
  )
}
