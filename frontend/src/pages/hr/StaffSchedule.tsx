import { useMemo, useState } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { useUsers } from '@/lib/auth/users'
import { staffScheduleStore, useStaffSchedule, type StaffCycle } from '@/lib/hr/staffSchedule'
import { CYCLE_PRESETS, cycleLabel, isWorkingOn, addDaysISO, weekdayOf, todayISO } from '@/lib/schedule/workCycle'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import KpiCard from '@/components/ui/KpiCard'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WINDOW = 14 // days shown at once

export default function StaffSchedule() {
  const { user } = useAuth()
  const branch = user!.branch
  const editable = canEdit(user!.role, 'hr')
  const myName = user!.fullName

  const users = useUsers().filter((u) => u.branch === branch && u.active).sort((a, b) => a.full_name.localeCompare(b.full_name))
  const sched = useStaffSchedule()
  const today = todayISO()
  const [start, setStart] = useState(today)
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null)

  const days = useMemo(() => Array.from({ length: WINDOW }, (_, i) => addDaysISO(start, i)), [start])
  const scheduled = users.filter((u) => sched[u.id])
  const onToday = scheduled.filter((u) => { const c = sched[u.id]; return isWorkingOn(c.onDays, c.offDays, c.anchor, today) }).length

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          Work-rest cycles for system users at {branch === 'trident' ? 'Trident' : 'Kansanshi'} — e.g. 21-on/7-off, or 7-on/7-off for route supervisors and bus controllers. Set a cycle and its first working day; the roster then shows who is on duty each day.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard label="Scheduled" value={scheduled.length} sub="staff with a cycle" />
        <KpiCard label="On duty today" value={onToday} tone={onToday ? 'good' : 'neutral'} sub={today} />
        <KpiCard label="Off today" value={Math.max(0, scheduled.length - onToday)} sub="resting" />
      </div>

      {/* Window nav */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setStart(addDaysISO(start, -WINDOW))}><ChevronLeft size={15} /> Earlier</Button>
        <input type="date" className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
        <Button variant="secondary" onClick={() => setStart(addDaysISO(start, WINDOW))}>Later <ChevronRight size={15} /></Button>
        <Button variant="secondary" onClick={() => setStart(today)}>Today</Button>
        <span className="ml-auto flex items-center gap-3 text-[11px] text-status-neutral">
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-status-good/70" /> On duty</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-black/10" /> Off</span>
        </span>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-navy text-white">
                <th className="sticky left-0 z-10 bg-navy px-3 py-2 font-medium">Staff member</th>
                <th className="px-3 py-2 font-medium">Cycle</th>
                {days.map((d) => {
                  const wd = weekdayOf(d)
                  const weekend = wd === 0 || wd === 6
                  return (
                    <th key={d} className={`px-1 py-2 text-center font-medium ${d === today ? 'bg-brand' : weekend ? 'bg-white/10' : ''}`} title={d}>
                      <div className="text-[10px] opacity-80">{WD[wd]}</div>
                      <div className="text-xs tabular-nums">{d.slice(8)}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => {
                const c = sched[u.id]
                return (
                  <tr key={u.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-3 py-2">
                      <div className="font-medium text-navy">{u.full_name}</div>
                      <div className="text-[11px] text-status-neutral">{ROLES[u.role]?.label ?? u.role}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {c ? (
                        <button disabled={!editable} onClick={() => setEdit({ id: u.id, name: u.full_name })} className={`inline-flex items-center gap-1 rounded-full bg-navy/5 px-2 py-0.5 text-[11px] text-navy ${editable ? 'hover:bg-navy/10' : ''}`}>
                          {cycleLabel(c.onDays, c.offDays)} {editable && <Pencil size={11} className="text-status-neutral" />}
                        </button>
                      ) : editable ? (
                        <button onClick={() => setEdit({ id: u.id, name: u.full_name })} className="rounded-full border border-dashed border-brand/40 px-2 py-0.5 text-[11px] font-medium text-brand hover:border-brand">Set cycle</button>
                      ) : <span className="text-[11px] text-status-neutral/70">—</span>}
                    </td>
                    {days.map((d) => {
                      if (!c) return <td key={d} className="px-1 py-2 text-center text-status-neutral/40">·</td>
                      const on = isWorkingOn(c.onDays, c.offDays, c.anchor, d)
                      return (
                        <td key={d} className={`px-1 py-2 text-center ${d === today ? 'bg-brand-tint/30' : ''}`}>
                          <span className={`inline-block h-5 w-6 rounded text-[10px] font-bold leading-5 ${on ? 'bg-status-good/15 text-status-good' : 'bg-black/5 text-status-neutral/60'}`}>{on ? 'On' : ''}</span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {users.length === 0 && <tr><td colSpan={WINDOW + 2} className="px-4 py-12 text-center text-sm text-status-neutral">No system users at this branch yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-status-neutral"><CalendarClock size={13} /> The cycle repeats from its first working day. Adjust that date if a cycle starts on a different day.</p>

      {edit && <CycleModal id={edit.id} name={edit.name} current={sched[edit.id]} myName={myName} onClose={() => setEdit(null)} />}
    </div>
  )
}

function CycleModal({ id, name, current, myName, onClose }: { id: string; name: string; current?: StaffCycle; myName: string; onClose: () => void }) {
  const initPreset = current ? (CYCLE_PRESETS.find((p) => p.onDays === current.onDays && p.offDays === current.offDays)?.key ?? 'custom') : '21x7'
  const [preset, setPreset] = useState(initPreset)
  const [onDays, setOnDays] = useState(String(current?.onDays ?? 21))
  const [offDays, setOffDays] = useState(String(current?.offDays ?? 7))
  const [anchor, setAnchor] = useState(current?.anchor ?? todayISO())

  function choosePreset(key: string) {
    setPreset(key)
    const p = CYCLE_PRESETS.find((x) => x.key === key)
    if (p) { setOnDays(String(p.onDays)); setOffDays(String(p.offDays)) }
  }
  const on = Math.max(1, Number(onDays) || 0)
  const off = Math.max(0, Number(offDays) || 0)
  const ready = on > 0 && !!anchor
  function save() {
    if (!ready) return
    staffScheduleStore.set(id, { onDays: on, offDays: off, anchor }, myName)
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={`Work-rest cycle — ${name}`} subtitle="How many days on, how many off, and when the current cycle began."
      footer={<div className="flex w-full items-center justify-between">
        {current ? <Button variant="danger" onClick={() => { staffScheduleStore.clear(id); onClose() }}><Trash2 size={15} /> Remove</Button> : <span />}
        <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}>Save</Button></div>
      </div>}>
      <div className="space-y-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Cycle</span>
          <select className={inputCls} value={preset} onChange={(e) => choosePreset(e.target.value)}>
            {CYCLE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            <option value="custom">Custom…</option>
          </select>
        </label>
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Days on</span><input type="number" className={inputCls} value={onDays} onChange={(e) => setOnDays(e.target.value)} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Days off</span><input type="number" className={inputCls} value={offDays} onChange={(e) => setOffDays(e.target.value)} /></label>
          </div>
        )}
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">First working day of the current cycle</span><input type="date" className={inputCls} value={anchor} onChange={(e) => setAnchor(e.target.value)} /></label>
        <p className="text-[11px] text-status-neutral">{on} day{on === 1 ? '' : 's'} on, then {off} off, repeating from {anchor || '…'}.</p>
      </div>
    </Modal>
  )
}
