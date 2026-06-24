import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { driversStore } from '@/lib/drivers/store'
import type { Driver } from '@/lib/drivers/types'
import { ROTATIONS, SHIFT_META, shiftHours, shiftOnDate, patternKeyFor, anchorFor } from '@/lib/drivers/schedule'
import { useScheduling } from '@/lib/drivers/scheduling'
import { effectiveShort, effectiveWindow, effectiveLabel, useDriverShifts } from '@/lib/drivers/driverShifts'

const selCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The rotation PATTERN is fixed by the driver's section (Pit → 14/7, Security &
 * Dewatering → 10/5, others → 7/7). Here you only set the cycle start date so
 * crews can be offset for continuous coverage.
 */
export default function SetScheduleModal({ driver, open, onClose }: { driver: Driver | null; open: boolean; onClose: () => void }) {
  const [anchor, setAnchor] = useState('')
  const [seen, setSeen] = useState('')
  useScheduling() // re-render when shift times change so the preview hours stay live
  useDriverShifts() // and when this driver's shift assignment changes

  if (open && driver && seen !== driver.id) {
    setSeen(driver.id)
    setAnchor(anchorFor(driver))
  }
  if (!open && seen) setSeen('')
  if (!driver) return null

  const pattern = patternKeyFor(driver)
  const start = new Date()
  const preview = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i)
    return { date: d, shift: shiftOnDate(pattern, anchor, iso(d)) }
  })

  function save() {
    driversStore.update(driver!.id, { schedule_anchor: anchor })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Work schedule — ${driver.full_name}`} subtitle={`${driver.employee_no} · ${driver.section}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save cycle start</Button></>}>
      <div className="rounded-xl border border-brand/30 bg-brand-tint/40 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8a4513]">Rotation (set by {driver.section} section)</div>
        <div className="mt-0.5 text-sm font-bold text-navy">{ROTATIONS[pattern]?.label}</div>
        <div className="text-xs text-status-neutral">{ROTATIONS[pattern]?.blurb}</div>
        <div className="mt-1 text-[11px] text-status-neutral">To change the pattern, move the driver to a different section (Drivers → Roster).</div>
      </div>

      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-navy">Cycle start date</span>
        <input type="date" className={selCls} value={anchor} onChange={(e) => setAnchor(e.target.value)} />
        <span className="mt-1 block text-[11px] text-status-neutral">The first "on" day of their rotation — offset crews so coverage is continuous.</span>
      </label>

      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">Next 14 days</div>
        <div className="flex flex-wrap gap-1.5">
          {preview.map(({ date, shift }) => {
            const meta = SHIFT_META[shift]
            const tone = meta.kind === 'day' ? 'bg-[#FCEAD3] text-[#8a4513]' : meta.kind === 'night' ? 'bg-[#DDE4F3] text-[#283a66]' : 'bg-canvas text-status-neutral'
            const wLabel = meta.kind === 'off' ? meta.label : (effectiveLabel(driver) || meta.label)
            const wHours = meta.kind === 'off' ? '' : (effectiveWindow(driver) || shiftHours(shift))
            const cellShort = meta.kind === 'off' ? meta.short : effectiveShort(driver)
            return (
              <div key={iso(date)} className={`flex w-12 flex-col items-center rounded-lg px-1 py-1.5 ${tone}`} title={`${date.toDateString()} — ${wLabel}${wHours ? ` (${wHours})` : ''}`}>
                <span className="text-[9px] uppercase opacity-70">{date.toLocaleDateString('en', { weekday: 'short' }).slice(0, 2)}</span>
                <span className="text-sm font-bold leading-tight">{date.getDate()}</span>
                <span className="text-[10px] font-semibold">{cellShort}</span>
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
