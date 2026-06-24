import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { SECTIONS } from '@/lib/org/sections'
import { driversStore } from '@/lib/drivers/store'
import type { Driver, Crew } from '@/lib/drivers/types'
import { useScheduling } from '@/lib/drivers/scheduling'
import { driverShiftsStore } from '@/lib/drivers/driverShifts'
import { isContinuousSection, crewPhaseIndex } from '@/lib/drivers/schedule'

const selCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

/** Roster reassignment — change a driver's section and crew (with Day/Afternoon for 7/7). */
export default function ReassignModal({ driver, open, onClose }: { driver: Driver | null; open: boolean; onClose: () => void }) {
  const sched = useScheduling()
  const [crew, setCrew] = useState<Crew>(driver?.crew ?? sched.crews[0]?.id ?? 'A')
  const [section, setSection] = useState(driver?.section ?? '')
  const [shiftId, setShiftId] = useState<string>('')

  const [seen, setSeen] = useState('')
  if (open && driver && seen !== driver.id) {
    setSeen(driver.id); setCrew(driver.crew); setSection(driver.section); setShiftId(driverShiftsStore.shiftFor(driver.id))
  }
  if (!open && seen) setSeen('')
  if (!driver) return null

  const sec = section || driver.section
  const cont = isContinuousSection(sec)
  const todayISO = new Date().toISOString().slice(0, 10)
  const PHASE = ['Day', 'Night', 'Off']
  const crewOpts = cont
    ? sched.crews.map((c) => ({ value: c.id, label: `Crew ${c.label} · ${PHASE[crewPhaseIndex(sec, c.id, todayISO)]}` }))
    : sched.crews.slice(0, 2).flatMap((c) => {
        const on = crewPhaseIndex(sec, c.id, todayISO) === 0 ? 'on' : 'off'
        return [
          { value: `${c.id}__day`, label: `Crew ${c.label} · Day (${on})` },
          { value: `${c.id}__afternoon`, label: `Crew ${c.label} · Afternoon (${on})` },
        ]
      })
  const crewVal = cont ? crew : `${crew}__${shiftId === 'afternoon' ? 'afternoon' : 'day'}`
  function onCrewChange(v: string) {
    if (cont) { setCrew(v); setShiftId('') }
    else { const [cid, blk] = v.split('__'); setCrew(cid); setShiftId(blk === 'afternoon' ? 'afternoon' : 'day') }
  }
  function onSectionChange(v: string) {
    setSection(v)
    if (!isContinuousSection(v) && !sched.crews.slice(0, 2).some((c) => c.id === crew)) setCrew(sched.crews[0]?.id ?? 'A')
    setShiftId((prev) => (isContinuousSection(v) ? '' : (prev === 'afternoon' ? 'afternoon' : 'day')))
  }

  function save() {
    driversStore.update(driver!.id, { crew, section })
    driverShiftsStore.set(driver!.id, cont ? undefined : (shiftId || 'day'))
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Reassign ${driver.full_name}`} subtitle={`${driver.employee_no} · ${driver.branch === 'kansanshi' ? 'Kansanshi' : 'Trident'}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save reassignment</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Section</span>
          <select className={selCls} value={section} onChange={(e) => onSectionChange(e.target.value)}>
            {SECTIONS[driver.branch].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Crew</span>
          <select className={selCls} value={crewVal} onChange={(e) => onCrewChange(e.target.value)}>
            {crewOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-3 text-[11px] text-status-neutral">
        {cont
          ? 'Continuous section — the crew rotates Day → Night → Off automatically from the section start (set in Admin → Scheduling).'
          : 'Crews A & B alternate week on / week off; Day = morning block, Afternoon runs to ~02:00.'}
      </p>
    </Modal>
  )
}
