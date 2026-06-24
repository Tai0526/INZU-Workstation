import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import type { Driver } from '@/lib/drivers/types'
import { ROTATIONS, SHIFT_META, previewShiftOnDate, dutyShort, dutyLabel, dutyHours, patternKeyFor, cycleKeyFor } from '@/lib/drivers/schedule'
import { useScheduling, schedulingStore } from '@/lib/drivers/scheduling'
import { useDriverShifts } from '@/lib/drivers/driverShifts'

const selCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The rotation is driven by the driver's SECTION (Pit → 14/7, Security &
 * Dewatering → 10/5, the rest → 7/7) and their CREW, which staggers Day → Night
 * → Off across the crews. Here you set the single global cycle start; crews
 * offset from it automatically. For 7/7 sections day/night comes from each
 * driver's Morning/Afternoon block (set on their profile).
 */
export default function SetScheduleModal({ driver, open, onClose }: { driver: Driver | null; open: boolean; onClose: () => void }) {
  const [anchor, setAnchor] = useState('')
  const [seen, setSeen] = useState('')
  useScheduling()
  useDriverShifts()

  if (open && driver && seen !== driver.id) {
    setSeen(driver.id)
    setAnchor(schedulingStore.get().cycleAnchors[cycleKeyFor(driver.section)])
  }
  if (!open && seen) setSeen('')
  if (!driver) return null

  const pattern = patternKeyFor(driver)
  const start = new Date()
  const preview = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i)
    return { date: d, shift: previewShiftOnDate(driver, anchor, iso(d)) }
  })

  function save() {
    schedulingStore.setCycleAnchor(cycleKeyFor(driver!.section), anchor)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Rotation cycle — ${driver.full_name}`} subtitle={`${driver.employee_no} · ${driver.section}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save cycle start</Button></>}>
      <div className="rounded-xl border border-brand/30 bg-brand-tint/40 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8a4513]">Rotation (set by {driver.section} section)</div>
        <div className="mt-0.5 text-sm font-bold text-navy">{ROTATIONS[pattern]?.label}</div>
        <div className="text-xs text-status-neutral">{ROTATIONS[pattern]?.blurb}</div>
        <div className="mt-1 text-[11px] text-status-neutral">Crews are staggered automatically — A on Day, B on Night, C resting — and rotate each block. To change the pattern, move the driver to a different section (Drivers → Roster).</div>
      </div>

      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-navy">Cycle start date — {ROTATIONS[pattern]?.label.split(' — ')[0]} rotation</span>
        <input type="date" className={selCls} value={anchor} onChange={(e) => setAnchor(e.target.value)} />
        <span className="mt-1 block text-[11px] text-status-neutral">When this rotation began. Applies to every crew on the {ROTATIONS[pattern]?.label.split(' — ')[0]} cycle (each cycle type — 14/7, 10/5, 7/7 — has its own start). Crews offset automatically.</span>
      </label>

      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">{driver.full_name} — next 14 days</div>
        <div className="flex flex-wrap gap-1.5">
          {preview.map(({ date, shift }) => {
            const meta = SHIFT_META[shift]
            const tone = meta.kind === 'day' ? 'bg-[#FCEAD3] text-[#8a4513]' : meta.kind === 'night' ? 'bg-[#DDE4F3] text-[#283a66]' : 'bg-canvas text-status-neutral'
            const wHours = dutyHours(driver, shift)
            return (
              <div key={iso(date)} className={`flex w-12 flex-col items-center rounded-lg px-1 py-1.5 ${tone}`} title={`${date.toDateString()} — ${dutyLabel(driver, shift)}${wHours ? ` (${wHours})` : ''}`}>
                <span className="text-[9px] uppercase opacity-70">{date.toLocaleDateString('en', { weekday: 'short' }).slice(0, 2)}</span>
                <span className="text-sm font-bold leading-tight">{date.getDate()}</span>
                <span className="text-[10px] font-semibold">{dutyShort(driver, shift)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
