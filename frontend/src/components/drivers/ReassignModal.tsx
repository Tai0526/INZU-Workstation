import { useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { SECTIONS } from '@/lib/org/sections'
import { driversStore } from '@/lib/drivers/store'
import { type Driver, type Crew, CREW_SHIFT, SHIFT_LABEL, patternFor, shiftWindow } from '@/lib/drivers/types'

const selCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

/** Roster reassignment — change a driver's crew (shift) and section only. */
export default function ReassignModal({ driver, open, onClose }: { driver: Driver | null; open: boolean; onClose: () => void }) {
  const [crew, setCrew] = useState<Crew>(driver?.crew ?? 'A')
  const [section, setSection] = useState(driver?.section ?? '')

  const [seen, setSeen] = useState('')
  if (open && driver && seen !== driver.id) {
    setSeen(driver.id); setCrew(driver.crew); setSection(driver.section)
  }
  if (!open && seen) setSeen('')
  if (!driver) return null

  const shiftKey = CREW_SHIFT[crew]
  const ShiftIcon = shiftKey === 'day' ? Sun : Moon
  const window = shiftWindow(patternFor(driver.branch, section || driver.section), shiftKey)

  function save() {
    driversStore.update(driver!.id, { crew, section })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Reassign ${driver.full_name}`} subtitle={`${driver.employee_no} · ${driver.branch === 'kansanshi' ? 'Kansanshi' : 'Trident'}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save reassignment</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Crew (shift)</span>
          <select className={selCls} value={crew} onChange={(e) => setCrew(e.target.value as Crew)}>
            <option value="A">Crew A · {SHIFT_LABEL.day} shift</option>
            <option value="B">Crew B · {SHIFT_LABEL.night} shift</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Section</span>
          <select className={selCls} value={section} onChange={(e) => setSection(e.target.value)}>
            {SECTIONS[driver.branch].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-canvas px-3 py-2.5 text-sm text-navy">
        <ShiftIcon size={16} className="text-brand" />
        <span>{SHIFT_LABEL[shiftKey]} shift · {section || driver.section} — <span className="text-status-neutral">{window}</span></span>
      </div>
      <p className="mt-2 text-[11px] text-status-neutral">Rostering changes a driver's crew/shift and section. To edit a driver's record (licence, contact, etc.) or add a new driver, use Driver Profiles.</p>
    </Modal>
  )
}
