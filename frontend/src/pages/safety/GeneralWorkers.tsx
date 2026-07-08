import { useMemo, useState } from 'react'
import { UserPlus, Pencil, Trash2, ChevronLeft, ChevronRight, CalendarClock, Plane, SlidersHorizontal } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import type { BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { useEmployees, employeesStore } from '@/lib/hr/store'
import type { Employee } from '@/lib/hr/types'
import { empLeaveStore, useEmployeeLeave } from '@/lib/hr/leave'
import { gwStore, useGw, GW_DEFAULT_CYCLE, type GwGroup, type GwCycle } from '@/lib/safety/generalWorkers'
import { isWorkingOn, weekdayOf, todayISO, cycleLabel, monthDays, shiftMonth, monthLabel, thisMonth } from '@/lib/schedule/workCycle'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import KpiCard from '@/components/ui/KpiCard'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const isWeekend = (wd: number) => wd === 5 || wd === 6 || wd === 0 // Fri / Sat / Sun
const GROUP_CLS: Record<GwGroup, string> = { A: 'bg-brand/10 text-brand', B: 'bg-navy/10 text-navy' }

export default function GeneralWorkers() {
  const { user } = useAuth()
  const branch = user!.branch
  const editable = canEdit(user!.role, 'safety')

  const workers = useEmployees().filter((e) => e.branch === branch && e.status === 'active' && e.job_role === 'General Worker')
  const gw = useGw()
  const leave = useEmployeeLeave()
  const cycle = gw.cycles[branch] ?? GW_DEFAULT_CYCLE
  const today = todayISO()
  const [month, setMonth] = useState(thisMonth())
  const [addOpen, setAddOpen] = useState(false)
  const [editWorker, setEditWorker] = useState<Employee | null>(null)
  const [leaveFor, setLeaveFor] = useState<Employee | null>(null)
  const [cycleOpen, setCycleOpen] = useState(false)

  const days = useMemo(() => monthDays(month), [month])
  const rows = useMemo(
    () => [...workers].sort((a, b) => (gw.assign[a.id] ?? 'Z').localeCompare(gw.assign[b.id] ?? 'Z') || a.full_name.localeCompare(b.full_name)),
    [workers, gw.assign],
  )

  const onLeaveNow = (id: string) => { const lp = leave[id]; return !!lp && lp.start <= today && today <= lp.end }
  function stateOf(id: string, d: string): 'on' | 'off' | 'leave' {
    const lp = leave[id]
    if (lp && lp.start <= d && d <= lp.end) return 'leave'
    const g = gw.assign[id]
    if (!g) return 'off'
    const anchor = g === 'A' ? cycle.aAnchor : cycle.bAnchor
    if (!anchor) return 'off'
    return isWorkingOn(cycle.onDays, cycle.offDays, anchor, d) ? 'on' : 'off'
  }
  const onToday = rows.filter((w) => stateOf(w.id, today) === 'on').length
  const leaveCount = rows.filter((w) => onLeaveNow(w.id)).length

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          General workers at {branch === 'trident' ? 'Trident' : 'Kansanshi'}, run by Safety. Two teams work an 11-on/3-off cycle, staggered so their rest days alternate across Friday/Saturday/Sunday. Add workers, put each on a team, set leave, and read the roster below.
        </p>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setCycleOpen(true)}><SlidersHorizontal size={15} /> Team cycle</Button>
            <Button onClick={() => setAddOpen(true)}><UserPlus size={15} /> Add general worker</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="General workers" value={rows.length} sub={branch === 'trident' ? 'Trident' : 'Kansanshi'} />
        <KpiCard label="On duty today" value={onToday} tone={onToday ? 'good' : 'neutral'} sub={today} />
        <KpiCard label="On leave now" value={leaveCount} tone={leaveCount ? 'warning' : 'good'} sub="away" />
        <KpiCard label="Cycle" value={cycleLabel(cycle.onDays, cycle.offDays)} sub="two teams, staggered" />
      </div>

      {editable && (!cycle.aAnchor || !cycle.bAnchor) && (
        <div className="rounded-lg border border-brand/25 bg-brand-tint/25 px-4 py-2.5 text-sm text-navy">
          Set each team's cycle start date under <button onClick={() => setCycleOpen(true)} className="font-semibold text-brand hover:underline">Team cycle</button> so the roster can show who is on and off.
        </div>
      )}

      {/* Month nav */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /> Prev</Button>
        <span className="min-w-[9rem] text-center text-sm font-semibold text-navy">{monthLabel(month)}</span>
        <Button variant="secondary" onClick={() => setMonth(shiftMonth(month, 1))}>Next <ChevronRight size={15} /></Button>
        <Button variant="secondary" onClick={() => setMonth(thisMonth())}>This month</Button>
        <span className="ml-auto flex items-center gap-3 text-[11px] text-status-neutral">
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-status-good/70" /> On</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-black/10" /> Off</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-status-warning/60" /> Leave</span>
        </span>
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-navy text-white">
                <th className="sticky left-0 top-0 z-30 bg-navy px-3 py-2 font-medium">Worker</th>
                {days.map((d) => {
                  const wd = weekdayOf(d)
                  return (
                    <th key={d} className={`sticky top-0 z-20 px-1 py-2 text-center font-medium ${d === today ? 'bg-brand' : isWeekend(wd) ? 'bg-[#1b2740]' : 'bg-navy'}`} title={d}>
                      <div className="text-[10px] opacity-80">{WD[wd]}</div>
                      <div className="text-xs tabular-nums">{d.slice(8)}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const g = gw.assign[w.id]
                return (
                  <tr key={w.id} className="border-b border-black/5">
                    <td className="sticky left-0 z-10 min-w-[13rem] whitespace-nowrap bg-white px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-navy">{w.full_name}</span>
                        {g ? <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold ${GROUP_CLS[g]}`}>{g}</span> : <span className="text-[10px] text-status-neutral/60">no team</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-status-neutral">
                        <span>{w.employee_no}{onLeaveNow(w.id) ? ' · on leave' : ''}</span>
                        {editable && (
                          <>
                            <button onClick={() => setLeaveFor(w)} title="Leave" className="rounded p-0.5 text-status-neutral hover:bg-brand/10 hover:text-brand"><Plane size={13} /></button>
                            <button onClick={() => setEditWorker(w)} title="Edit" className="rounded p-0.5 text-status-neutral hover:bg-navy/10 hover:text-navy"><Pencil size={13} /></button>
                          </>
                        )}
                      </div>
                    </td>
                    {days.map((d) => {
                      const st = stateOf(w.id, d)
                      const cls = st === 'on' ? 'bg-status-good/15 text-status-good' : st === 'leave' ? 'bg-status-warning/20 text-[#8a6d10]' : 'bg-black/5 text-status-neutral/50'
                      return (
                        <td key={d} className={`px-1 py-2 text-center ${d === today ? 'bg-brand-tint/30' : ''}`}>
                          <span className={`inline-block h-5 w-6 rounded text-[10px] font-bold leading-5 ${cls}`}>{st === 'on' ? 'On' : st === 'leave' ? 'L' : ''}</span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={days.length + 1} className="px-4 py-12 text-center text-sm text-status-neutral">No general workers yet.{editable && ' Add one to start the roster.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-status-neutral"><CalendarClock size={13} /> Fri/Sat/Sun columns are shaded. If both teams are on (or off) on the same weekend, nudge one team's start date by a few days under Team cycle until they alternate.</p>

      {addOpen && <WorkerModal branch={branch} onClose={() => setAddOpen(false)} nextNo={workers.length + 1} />}
      {editWorker && <WorkerModal branch={branch} worker={editWorker} onClose={() => setEditWorker(null)} />}
      {leaveFor && <LeaveModal worker={leaveFor} current={leave[leaveFor.id]} onClose={() => setLeaveFor(null)} />}
      {cycleOpen && <CycleModal branch={branch} current={cycle} onClose={() => setCycleOpen(false)} />}
    </div>
  )
}

function WorkerModal({ branch, worker, nextNo, onClose }: { branch: BranchCode; worker?: Employee; nextNo?: number; onClose: () => void }) {
  const isNew = !worker
  const [name, setName] = useState(worker?.full_name ?? '')
  const [phone, setPhone] = useState(worker?.phone ?? '')
  const [group, setGroup] = useState<GwGroup>((worker && gwStore.groupOf(worker.id)) ?? 'A')
  const ready = name.trim().length > 0
  function save() {
    if (!ready) return
    if (isNew) {
      const no = `GW-${branch === 'trident' ? 'T' : 'K'}${String(nextNo ?? 1).padStart(2, '0')}`
      const e = employeesStore.add({ branch, employee_no: no, full_name: name.trim(), job_role: 'General Worker', status: 'active', phone: phone.trim(), hod: 'Safety Officer' })
      gwStore.setGroup(e.id, group)
    } else {
      employeesStore.update(worker!.id, { full_name: name.trim(), phone: phone.trim() })
      gwStore.setGroup(worker!.id, group)
    }
    onClose()
  }
  function remove() {
    if (!worker) return
    if (!window.confirm(`Remove ${worker.full_name}?`)) return
    employeesStore.remove(worker.id); gwStore.setGroup(worker.id, null); empLeaveStore.clear(worker.id)
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add general worker' : `Edit ${worker!.full_name}`} subtitle="A general worker on Safety's roster (also appears in HR employees)."
      footer={<div className="flex w-full items-center justify-between">
        {!isNew ? <Button variant="danger" onClick={remove}><Trash2 size={15} /> Remove</Button> : <span />}
        <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}>{isNew ? 'Add worker' : 'Save'}</Button></div>
      </div>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Full name *</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Phone</span><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Team</span>
          <select className={inputCls} value={group} onChange={(e) => setGroup(e.target.value as GwGroup)}><option value="A">Team A</option><option value="B">Team B</option></select>
        </label>
      </div>
    </Modal>
  )
}

function LeaveModal({ worker, current, onClose }: { worker: Employee; current?: { start: string; end: string; reason?: string }; onClose: () => void }) {
  const [startD, setStartD] = useState(current?.start ?? todayISO())
  const [endD, setEndD] = useState(current?.end ?? todayISO())
  const [reason, setReason] = useState(current?.reason ?? '')
  const ready = !!startD && !!endD && startD <= endD
  return (
    <Modal open onClose={onClose} title={`Leave — ${worker.full_name}`} subtitle="Mark a date range as leave; it shows on the roster and in HR."
      footer={<div className="flex w-full items-center justify-between">
        {current ? <Button variant="danger" onClick={() => { empLeaveStore.clear(worker.id); onClose() }}>End leave</Button> : <span />}
        <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => { if (ready) { empLeaveStore.set(worker.id, startD, endD, reason); onClose() } }} disabled={!ready}>Save</Button></div>
      </div>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">From</span><input type="date" className={inputCls} value={startD} onChange={(e) => setStartD(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">To</span><input type="date" className={inputCls} value={endD} onChange={(e) => setEndD(e.target.value)} /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Reason</span><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Annual leave / Sick" /></label>
      </div>
    </Modal>
  )
}

function CycleModal({ branch, current, onClose }: { branch: BranchCode; current: GwCycle; onClose: () => void }) {
  const [onDays, setOnDays] = useState(String(current.onDays))
  const [offDays, setOffDays] = useState(String(current.offDays))
  const [aAnchor, setAAnchor] = useState(current.aAnchor)
  const [bAnchor, setBAnchor] = useState(current.bAnchor)
  const on = Math.max(1, Number(onDays) || 0)
  const off = Math.max(0, Number(offDays) || 0)
  function save() {
    gwStore.setCycle(branch, { onDays: on, offDays: off, aAnchor, bAnchor })
    onClose()
  }
  return (
    <Modal open onClose={onClose} title="Team cycle" subtitle="The on/off pattern and each team's cycle start date."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Days on</span><input type="number" className={inputCls} value={onDays} onChange={(e) => setOnDays(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Days off</span><input type="number" className={inputCls} value={offDays} onChange={(e) => setOffDays(e.target.value)} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Team A — first working day</span><input type="date" className={inputCls} value={aAnchor} onChange={(e) => setAAnchor(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Team B — first working day</span><input type="date" className={inputCls} value={bAnchor} onChange={(e) => setBAnchor(e.target.value)} /></label>
        </div>
        <p className="text-[11px] text-status-neutral">Both teams run {on} on / {off} off. Offsetting the two start dates is what makes their rest days land on alternating Fri/Sat/Sun weekends — check the roster and nudge a date if they line up.</p>
      </div>
    </Modal>
  )
}
