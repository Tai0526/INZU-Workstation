import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Pencil, Users, ArrowRight } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useEmployees } from '@/lib/hr/store'
import type { Employee } from '@/lib/hr/types'
import { useMechSchedules, mechScheduleStore } from '@/lib/workshop/store'
import { type MechShift, WEEKDAYS, SHIFT_LABEL, DEFAULT_MECH_SHIFT } from '@/lib/workshop/types'

const DAY = 86_400_000
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const patternText = (s: MechShift) => {
  if (s.workdays.length === 0) return 'No work days'
  if (s.workdays.length === 7) return `Every day · ${SHIFT_LABEL[s.shift]}`
  const days = [...s.workdays].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join(', ')
  return `${days} · ${SHIFT_LABEL[s.shift]}`
}

export default function MechanicsSchedule() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'workshop') // Workshop Supervisor / Admin

  const mechanics = useEmployees().filter((e) => e.branch === branch && e.status === 'active' && e.job_role === 'Mechanic')
  useMechSchedules() // re-render when a pattern changes
  const [editing, setEditing] = useState<Employee | null>(null)

  // 14-day window from today.
  const days = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    return Array.from({ length: 14 }, (_, i) => new Date(start.getTime() + i * DAY))
  }, [])
  const todayKey = iso(new Date())

  return (
    <div className="page space-y-4">
      <p className="max-w-2xl text-sm text-status-neutral">
        Work &amp; rest for the workshop mechanics in <span className="font-medium text-navy">{branchLabel}</span>.
        Mechanics are pulled from <span className="font-medium text-navy">HR → Employees</span> (job role “Mechanic”); set each one’s working days and shift.
      </p>

      {mechanics.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center text-sm text-status-neutral">
          <Users size={26} className="text-status-neutral/60" />
          No mechanics on record for {branchLabel}.
          <Link to="/hr/employees" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">Add them in HR → Employees <ArrowRight size={14} /></Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <CalendarClock size={16} className="text-brand" />
            <h3 className="font-display text-sm font-bold text-navy">Mechanics — next 14 days</h3>
            <span className="ml-auto text-[11px] text-status-neutral">{mechanics.length} mechanic{mechanics.length === 1 ? '' : 's'}</span>
          </div>
          <div className="max-h-[30rem] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-20 bg-navy text-white">
                <tr>
                  <th className="sticky left-0 z-30 bg-navy px-3 py-2 text-left font-medium">Mechanic</th>
                  {days.map((d) => (
                    <th key={iso(d)} className={clsx('px-1.5 py-2 text-center font-medium', iso(d) === todayKey && 'bg-navy-secondary')}>
                      <div className="text-[10px] font-normal opacity-80">{WEEKDAYS[d.getDay()]}</div>
                      <div>{d.getDate()}</div>
                    </th>
                  ))}
                  {canManage && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {mechanics.map((m, i) => {
                  const sched = mechScheduleStore.for(m.id)
                  const rowBg = i % 2 ? 'bg-canvas' : 'bg-white'
                  return (
                    <tr key={m.id} className={rowBg}>
                      <td className={clsx('sticky left-0 z-10 px-3 py-2', rowBg)}>
                        <div className="font-medium text-navy">{m.full_name}</div>
                        <div className="text-[11px] text-status-neutral">{patternText(sched)}</div>
                      </td>
                      {days.map((d) => {
                        const works = sched.workdays.includes(d.getDay())
                        const isToday = iso(d) === todayKey
                        return (
                          <td key={iso(d)} className="px-1 py-1 text-center">
                            <span className={clsx(
                              'inline-flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-semibold',
                              works
                                ? (sched.shift === 'day' ? 'bg-brand-tint text-[#8a4513]' : 'bg-navy/10 text-navy')
                                : 'bg-canvas text-status-neutral',
                              isToday && 'ring-1 ring-brand',
                            )} title={works ? SHIFT_LABEL[sched.shift] : 'Rest'}>
                              {works ? (sched.shift === 'day' ? 'D' : 'N') : '·'}
                            </span>
                          </td>
                        )
                      })}
                      {canManage && (
                        <td className="px-2 py-1 text-right">
                          <button onClick={() => setEditing(m)} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Edit pattern"><Pencil size={14} /></button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-black/5 px-5 py-2.5 text-[11px] text-status-neutral">
            <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center rounded bg-brand-tint text-[10px] font-semibold text-[#8a4513]">D</span> Day shift</span>
            <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center rounded bg-navy/10 text-[10px] font-semibold text-navy">N</span> Night shift</span>
            <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center rounded bg-canvas text-[10px] font-semibold text-status-neutral">·</span> Rest</span>
          </div>
        </div>
      )}

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
      {!canManage && mechanics.length > 0 && <p className="text-xs text-status-neutral">View only — the Workshop Supervisor sets the schedule.</p>}

      <EditPatternModal mech={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function EditPatternModal({ mech, onClose }: { mech: Employee | null; onClose: () => void }) {
  const [f, setF] = useState<MechShift>(DEFAULT_MECH_SHIFT)
  const [key, setKey] = useState('')
  if (mech && key !== mech.id) { setKey(mech.id); setF(mechScheduleStore.for(mech.id)) }
  if (!mech) return null

  const toggleDay = (d: number) => setF((p) => ({ ...p, workdays: p.workdays.includes(d) ? p.workdays.filter((x) => x !== d) : [...p.workdays, d].sort((a, b) => a - b) }))
  function save() { mechScheduleStore.set(mech!.id, { workdays: [...f.workdays].sort((a, b) => a - b), shift: f.shift }); onClose() }

  return (
    <Modal open={!!mech} onClose={onClose} title={`Schedule — ${mech.full_name}`} subtitle="Pick the working days and the shift. Days not selected are rest days."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save schedule</Button></>}>
      <div>
        <span className="mb-1.5 block text-xs font-medium text-navy">Working days</span>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((w, d) => (
            <button key={w} type="button" onClick={() => toggleDay(d)}
              className={clsx('h-9 w-11 rounded-lg border text-xs font-medium', f.workdays.includes(d) ? 'border-brand bg-brand-tint text-[#8a4513]' : 'border-black/15 text-status-neutral hover:border-brand')}>
              {w}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <span className="mb-1.5 block text-xs font-medium text-navy">Shift</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
          {(['day', 'night'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setF((p) => ({ ...p, shift: s }))}
              className={clsx('px-4 py-2 text-sm font-medium', f.shift === s ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas')}>
              {SHIFT_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-[11px] text-status-neutral">Pattern: <b className="text-navy">{patternText(f)}</b>. Leave management for mechanics stays in HR → Leave.</p>
    </Modal>
  )
}
