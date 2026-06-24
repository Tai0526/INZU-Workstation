import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import type { Driver } from '@/lib/drivers/types'
import { ROTATIONS, SHIFT_META, driverShiftOnDate, dutyShort, dutyLabel, dutyHours, patternKeyFor } from '@/lib/drivers/schedule'
import { useScheduling } from '@/lib/drivers/scheduling'
import { useDriverShifts } from '@/lib/drivers/driverShifts'

const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Read-only preview of a driver's next 14 days. The rotation itself — who is on
 * Day / Night / Off (or On / Off for 7/7) and when the cycle started — is set in
 * Admin → Scheduling and rotates automatically from there.
 */
export default function SetScheduleModal({ driver, open, onClose }: { driver: Driver | null; open: boolean; onClose: () => void }) {
  useScheduling()
  useDriverShifts()
  if (!driver) return null

  const pattern = patternKeyFor(driver)
  const start = new Date()
  const preview = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i)
    return { date: d, shift: driverShiftOnDate(driver, iso(d)) }
  })

  return (
    <Modal open={open} onClose={onClose} title={`Rotation — ${driver.full_name}`} subtitle={`${driver.employee_no} · ${driver.section} · Crew ${driver.crew}`}
      footer={<Button onClick={onClose}>Close</Button>}>
      <div className="rounded-xl border border-brand/30 bg-brand-tint/40 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8a4513]">Rotation (set by {driver.section} section)</div>
        <div className="mt-0.5 text-sm font-bold text-navy">{ROTATIONS[pattern]?.label}</div>
        <div className="text-xs text-status-neutral">{ROTATIONS[pattern]?.blurb}</div>
        <div className="mt-1 text-[11px] text-status-neutral">Who's on Day / Night / Off (or On / Off) and the cycle start are set in Admin → Scheduling, then rotate automatically.</div>
      </div>

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
