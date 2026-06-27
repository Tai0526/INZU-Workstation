import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarDays, Search, Users, Plus, Trash2, ArrowRight, UsersRound } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useEmployees } from '@/lib/hr/store'
import type { Employee } from '@/lib/hr/types'
import { useMechRoster, mechRosterStore } from '@/lib/workshop/store'
import { type MechShiftKind, SHIFT_LABEL, crewOnDate } from '@/lib/workshop/types'
import { useEmployeeLeave, empOnLeave } from '@/lib/hr/leave'

const pad = (n: number) => String(n).padStart(2, '0')
const todayStr = () => new Date().toISOString().slice(0, 10)
const KIND_CELL: Record<MechShiftKind, string> = { day: 'bg-[#FCEAD3] text-[#8a4513]', night: 'bg-[#DDE4F3] text-[#283a66]' }
const REST_CELL = 'bg-white text-status-neutral/40'
const LEAVE_CELL = 'bg-[#E7E0F5] text-[#5b4a86]'

export default function MechanicsSchedule() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'workshop')

  const allMechs = useEmployees().filter((e) => e.branch === branch && e.status === 'active' && e.job_role === 'Mechanic')
  const roster = useMechRoster()
  useEmployeeLeave()
  const crews = roster.crews

  const [q, setQ] = useState('')
  const [ym, setYm] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() } })
  const [crewsOpen, setCrewsOpen] = useState(false)
  const [assigning, setAssigning] = useState<Employee | null>(null)

  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' })
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate()
  const todayISO = todayStr()
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1
    const dow = new Date(ym.y, ym.m, day).getDay()
    return { day, dateISO: `${ym.y}-${pad(ym.m + 1)}-${pad(day)}`, weekend: dow === 0 || dow === 6, label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][dow] }
  }), [ym, daysInMonth])

  // Precompute each crew's on/off across the month once.
  const crewOn = useMemo(() => {
    const map: Record<string, boolean[]> = {}
    for (const c of crews) map[c.id] = days.map((d) => crewOnDate(c, d.dateISO))
    return map
  }, [crews, days])

  const mechanics = useMemo(() => {
    const term = q.trim().toLowerCase()
    return allMechs
      .filter((m) => !term || m.full_name.toLowerCase().includes(term))
      .map((m) => ({ m, crew: mechRosterStore.crewOf(m.id) }))
      .sort((a, b) => (a.crew?.name || 'zzz').localeCompare(b.crew?.name || 'zzz') || a.m.full_name.localeCompare(b.m.full_name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMechs, q, roster])

  const coverage = useMemo(() => days.map((d, i) => {
    let day = 0, night = 0
    for (const { m, crew } of mechanics) {
      if (!crew || empOnLeave(m.id, d.dateISO) || !crewOn[crew.id]?.[i]) continue
      if (crew.shift === 'day') day++; else night++
    }
    return { day, night }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [days, mechanics, crewOn])

  function shiftMonth(delta: number) { const d = new Date(ym.y, ym.m + delta, 1); setYm({ y: d.getFullYear(), m: d.getMonth() }) }

  return (
    <div className="page space-y-5">
      <p className="max-w-3xl text-sm text-status-neutral">
        Mechanics' work/rest across the month for <span className="font-medium text-navy">{branchLabel}</span> — each crew runs a <span className="font-medium text-navy">14 on / 7 off</span> rotation.
        Mechanics come from <Link to="/hr/employees" className="font-medium text-brand hover:underline">HR → Employees</Link>; leave shows from HR. {canManage && 'Set up crews, then click a mechanic to put them on one.'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-black/15 bg-white">
          <button onClick={() => shiftMonth(-1)} className="rounded-l-lg px-2 py-2 text-status-neutral hover:bg-canvas"><ChevronLeft size={16} /></button>
          <span className="min-w-[140px] px-2 text-center text-sm font-semibold text-navy">{monthLabel}</span>
          <button onClick={() => shiftMonth(1)} className="rounded-r-lg px-2 py-2 text-status-neutral hover:bg-canvas"><ChevronRight size={16} /></button>
        </div>
        <Button variant="secondary" onClick={() => { const n = new Date(); setYm({ y: n.getFullYear(), m: n.getMonth() }) }}><CalendarDays size={15} /> This month</Button>
        {canManage && <Button variant="secondary" onClick={() => setCrewsOpen(true)}><UsersRound size={15} /> Set up crews</Button>}
        <div className="relative min-w-[180px] flex-1 max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mechanic…" className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-[#FCEAD3]" /> <b className="text-navy">Day</b></span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-[#DDE4F3]" /> <b className="text-navy">Night</b></span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border border-black/10 bg-white" /> <span className="text-status-neutral">Off / rest</span></span>
        <span className="inline-flex items-center gap-1.5"><span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-[#E7E0F5] text-[7px] font-bold text-[#5b4a86]">L</span> <span className="text-status-neutral">On leave</span></span>
        <span className="text-status-neutral">14 on / 7 off · the three crews overlap one week each cycle</span>
      </div>

      {allMechs.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center text-sm text-status-neutral">
          <Users size={26} className="text-status-neutral/60" />
          No mechanics for {branchLabel}. <Link to="/hr/employees" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">Add them in HR → Employees <ArrowRight size={14} /></Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="max-h-[calc(100vh-14rem)] overflow-auto">
            <table className="border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10">
                  <th className="sticky left-0 top-0 z-30 bg-canvas px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-status-neutral">Mechanic</th>
                  {days.map((d) => (
                    <th key={d.day} className={clsx('sticky top-0 z-20 w-7 px-0 py-1 text-center text-[10px] font-medium', d.dateISO === todayISO ? 'bg-[#FCEAD3] text-brand' : d.weekend ? 'bg-[#E9ECEF] text-status-neutral' : 'bg-canvas text-status-neutral')}>
                      <div>{d.label}</div><div className="text-[11px] font-bold text-navy">{d.day}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mechanics.map(({ m, crew }) => (
                  <tr key={m.id} className="border-b border-black/5">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                      <button onClick={() => canManage && setAssigning(m)} className={clsx('block max-w-[170px] text-left', canManage && 'hover:text-brand')} disabled={!canManage}>
                        <span className="block truncate text-[13px] font-medium text-navy">{m.full_name}</span>
                        <span className="block truncate text-[10px] text-status-neutral">{crew ? `${crew.name} · ${SHIFT_LABEL[crew.shift]}` : 'Unassigned'}</span>
                      </button>
                    </td>
                    {days.map((d, i) => {
                      const onLeave = empOnLeave(m.id, d.dateISO)
                      const works = !onLeave && crew && crewOn[crew.id]?.[i]
                      const cell = onLeave ? 'L' : works ? (crew!.shift === 'day' ? 'D' : 'N') : '·'
                      const cls = onLeave ? LEAVE_CELL : works ? KIND_CELL[crew!.shift] : REST_CELL
                      const tip = `${m.full_name} · ${d.dateISO} — ${onLeave ? 'On leave' : works ? `${crew!.name} ${SHIFT_LABEL[crew!.shift]}` : 'Rest'}`
                      return (
                        <td key={d.day} className={clsx('h-8 w-7 border-l border-black/5 text-center', d.weekend && !works && !onLeave && 'bg-black/[0.02]')}>
                          <span className={clsx('mx-auto flex h-7 w-6 items-center justify-center rounded text-[11px] font-bold', cls, d.dateISO === todayISO && 'ring-1 ring-brand')} title={tip}>{cell}</span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {mechanics.length === 0 && <tr><td colSpan={days.length + 1} className="px-4 py-12 text-center text-sm text-status-neutral">No mechanics match.</td></tr>}
              </tbody>
              {mechanics.length > 0 && (
                <tfoot>
                  <CoverageRow label="On day" kind="day" cov={coverage} />
                  <CoverageRow label="On night" kind="night" cov={coverage} />
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
      {!canManage && allMechs.length > 0 && <p className="text-xs text-status-neutral">View only — the Workshop Supervisor sets crews &amp; the roster.</p>}

      <SetupCrewsModal open={crewsOpen} onClose={() => setCrewsOpen(false)} />
      <AssignCrewModal mech={assigning} onClose={() => setAssigning(null)} />
    </div>
  )
}

function CoverageRow({ label, kind, cov }: { label: string; kind: 'day' | 'night'; cov: { day: number; night: number }[] }) {
  return (
    <tr className="border-t border-black/10 bg-canvas/40">
      <td className="sticky left-0 z-10 bg-canvas/40 px-3 py-1.5 text-[11px] font-semibold text-navy">{label}</td>
      {cov.map((c, i) => { const n = kind === 'day' ? c.day : c.night; return <td key={i} className={clsx('w-7 py-1 text-center text-[11px] font-medium', n === 0 ? 'text-status-critical' : 'text-status-neutral')}>{n || '·'}</td> })}
    </tr>
  )
}

const cellCls = 'rounded-lg border border-black/15 bg-white px-2 py-1.5 text-sm text-navy outline-none focus:border-brand'
function SetupCrewsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const roster = useMechRoster()
  const crews = roster.crews
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Set up crews" subtitle="Each crew runs a continuous rotation — days on, then days off — from its start date. Assign mechanics to a crew on the schedule."
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-3">
        {crews.map((c) => (
          <div key={c.id} className="rounded-lg border border-black/10 p-3">
            <div className="flex items-center gap-2">
              <input value={c.name} onChange={(e) => mechRosterStore.updateCrew(c.id, { name: e.target.value })} className="flex-1 rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm font-medium text-navy outline-none focus:border-brand" />
              <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
                {(['day', 'night'] as MechShiftKind[]).map((s) => (
                  <button key={s} type="button" onClick={() => mechRosterStore.updateCrew(c.id, { shift: s })} className={clsx('px-3 py-1.5 text-xs font-medium', c.shift === s ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas')}>{SHIFT_LABEL[s]}</button>
                ))}
              </div>
              <button onClick={() => confirm(`Remove ${c.name}?`) && mechRosterStore.removeCrew(c.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={15} /></button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Rotation start</span><input type="date" value={c.start} onChange={(e) => mechRosterStore.updateCrew(c.id, { start: e.target.value })} className={`${cellCls} w-full`} /></label>
              <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Days on</span><input type="number" min={1} value={c.onDays} onChange={(e) => mechRosterStore.updateCrew(c.id, { onDays: Math.max(1, Number(e.target.value) || 0) })} className={`${cellCls} w-full`} /></label>
              <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Days off</span><input type="number" min={0} value={c.offDays} onChange={(e) => mechRosterStore.updateCrew(c.id, { offDays: Math.max(0, Number(e.target.value) || 0) })} className={`${cellCls} w-full`} /></label>
            </div>
          </div>
        ))}
        {crews.length === 0 && <p className="rounded-lg bg-canvas px-3 py-3 text-center text-sm text-status-neutral">No crews yet — add one below.</p>}
        <button onClick={() => mechRosterStore.addCrew(`Crew ${String.fromCharCode(65 + crews.length)}`, 'day', todayStr(), 14, 7)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-sm font-medium text-brand hover:border-brand"><Plus size={15} /> Add crew</button>
        <p className="text-[11px] text-status-neutral">Stagger the crews' start dates to control when they overlap. The defaults (start, +4 days, +7 days on a 14/7 rotation) give one week where all three are on together.</p>
      </div>
    </Modal>
  )
}

function AssignCrewModal({ mech, onClose }: { mech: Employee | null; onClose: () => void }) {
  const roster = useMechRoster()
  const [sel, setSel] = useState('')
  const [key, setKey] = useState('')
  if (mech && key !== mech.id) { setKey(mech.id); setSel(mechRosterStore.crewOf(mech.id)?.id || '') }
  if (!mech) return null
  function save() { mechRosterStore.assign(mech!.id, sel); onClose() }
  return (
    <Modal open={!!mech} onClose={onClose} title={`Crew — ${mech.full_name}`} subtitle="Put this mechanic on a crew; their month roster follows the crew's rotation."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-2">
        {roster.crews.map((c) => (
          <label key={c.id} className={clsx('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm', sel === c.id ? 'border-brand bg-brand-tint/40' : 'border-black/10 hover:bg-canvas')}>
            <input type="radio" name="crew" checked={sel === c.id} onChange={() => setSel(c.id)} className="accent-brand" />
            <span className="flex-1"><span className="font-medium text-navy">{c.name}</span> <span className="text-status-neutral">· {SHIFT_LABEL[c.shift]} · {c.onDays} on / {c.offDays} off · from {c.start}</span></span>
          </label>
        ))}
        <label className={clsx('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm', sel === '' ? 'border-brand bg-brand-tint/40' : 'border-black/10 hover:bg-canvas')}>
          <input type="radio" name="crew" checked={sel === ''} onChange={() => setSel('')} className="accent-brand" />
          <span className="flex-1 text-status-neutral">Unassigned (rest)</span>
        </label>
        {roster.crews.length === 0 && <p className="text-[11px] text-status-neutral">No crews yet — add some in “Set up crews”.</p>}
      </div>
    </Modal>
  )
}
