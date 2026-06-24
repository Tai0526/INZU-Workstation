import { useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { SECTIONS } from '@/lib/org/sections'
import { driversStore } from '@/lib/drivers/store'
import { type Driver, type Crew, SHIFT_LABEL, patternFor, shiftWindow } from '@/lib/drivers/types'
import { useScheduling, crewShiftKind, crewShiftLabel, shiftKindOf, shiftTime } from '@/lib/drivers/scheduling'
import { driverShiftsStore } from '@/lib/drivers/driverShifts'

const selCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

/** Roster reassignment — change a driver's crew (shift) and section only. */
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

  const selShift = sched.shifts.find((s) => s.id === shiftId)
  const shiftKey = selShift ? shiftKindOf(selShift) : crewShiftKind(sched, crew)
  const ShiftIcon = shiftKey === 'day' ? Sun : Moon
  const window = selShift ? shiftTime(selShift) : shiftWindow(patternFor(driver.branch, section || driver.section), shiftKey)

  function save() {
    driversStore.update(driver!.id, { crew, section })
    driverShiftsStore.set(driver!.id, shiftId || undefined)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Reassign ${driver.full_name}`} subtitle={`${driver.employee_no} · ${driver.branch === 'kansanshi' ? 'Kansanshi' : 'Trident'}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save reassignment</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Crew (rotation)</span>
          <select className={selCls} value={crew} onChange={(e) => setCrew(e.target.value as Crew)}>
            {sched.crews.map((c) => (
              <option key={c.id} value={c.id}>Crew {c.label}{crewShiftLabel(sched, c.id) ? ` · ${crewShiftLabel(sched, c.id)}` : ''}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Shift / block</span>
          <select className={selCls} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
            <option value="">Use crew default</option>
            {sched.shifts.map((s) => <option key={s.id} value={s.id}>{s.label}{shiftTime(s) ? ` · ${shiftTime(s)}` : ''}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-navy">Section</span>
          <select className={selCls} value={section} onChange={(e) => setSection(e.target.value)}>
            {SECTIONS[driver.branch].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-canvas px-3 py-2.5 text-sm text-navy">
        <ShiftIcon size={16} className="text-brand" />
        <span>{selShift?.label ?? `${SHIFT_LABEL[shiftKey]} shift`} · {section || driver.section} — <span className="text-status-neutral">{window || '—'}</span></span>
      </div>
      <p className="mt-2 text-[11px] text-status-neutral">Crew is the rotation (on/off cycle); shift is the daily block (e.g. Morning → day, Afternoon → night). To edit a driver's record or add a driver, use Driver Profiles.</p>
    </Modal>
  )
}
