import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { Download, FileText } from 'lucide-react'
import clsx from 'clsx'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import type { Driver } from '@/lib/drivers/types'
import type { WeeklyAssignment } from '@/lib/operations/types'
import { buildAssignmentIndex, datesInRange, summarizeDuty, fridayOf, type DutyKind } from '@/lib/drivers/duty'
import { downloadTablePdf } from '@/lib/reports/pdfDoc'

const clean = (s: string) => s.replace(/\s*\(demo\)$/, '')
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const inputCls = 'rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

type RangeMode = 'month' | 'week' | 'custom'
const otText = (ot: Record<string, number>) => Object.entries(ot).map(([v, n]) => `${v} (${n})`).join(', ')
function cellText(d: { kind: DutyKind; vehicle: string }): string {
  if (d.kind === 'worked') return d.vehicle || 'Work'
  if (d.kind === 'overtime') return `OT ${d.vehicle}`.trim()
  if (d.kind === 'leave') return 'Leave'
  if (d.kind === 'suspended') return 'Susp'
  return 'Off'
}

export default function DutyReportModal({
  open, onClose, drivers, assigns, branchLabel, month,
}: {
  open: boolean
  onClose: () => void
  drivers: Driver[]
  assigns: WeeklyAssignment[] // branch-scoped weekly assignments
  branchLabel: string
  month: { y: number; m: number } // the calendar's current month
}) {
  const [mode, setMode] = useState<RangeMode>('month')
  const [custom, setCustom] = useState<{ start: string; end: string }>({ start: '', end: '' })

  const { start, end } = useMemo(() => {
    if (mode === 'month') {
      return { start: isoOf(new Date(month.y, month.m, 1)), end: isoOf(new Date(month.y, month.m + 1, 0)) }
    }
    if (mode === 'week') {
      const fri = fridayOf(isoOf(new Date()))
      const last = new Date(`${fri}T00:00:00`); last.setDate(last.getDate() + 6)
      return { start: fri, end: isoOf(last) }
    }
    return { start: custom.start, end: custom.end }
  }, [mode, month, custom])

  const idx = useMemo(() => buildAssignmentIndex(assigns), [assigns])
  const valid = !!start && !!end && start <= end
  const dates = useMemo(() => (valid ? datesInRange(start, end) : []), [valid, start, end])
  const summary = useMemo(() => (valid ? summarizeDuty(drivers, dates, idx) : []), [valid, drivers, dates, idx])

  function exportExcel() {
    const wb = XLSX.utils.book_new()
    const summaryRows = summary.map((s) => ({
      Driver: clean(s.driver.full_name), Section: s.driver.section,
      'Worked (days)': s.worked, 'Off (days)': s.off, 'Overtime (days)': s.overtime,
      'Vehicles worked': s.vehicles.join(', '), 'Overtime on': otText(s.otByVehicle),
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary')
    const header = ['Driver', ...dates]
    const dailyRows = summary.map((s) => {
      const row: Record<string, string> = { Driver: clean(s.driver.full_name) }
      s.daily.forEach((d) => { row[d.dateISO] = cellText(d) })
      return row
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows, { header }), 'Daily')
    XLSX.writeFile(wb, `INZU_Duty_Report_${branchLabel}_${start}_to_${end}.xlsx`)
  }

  function exportPdf() {
    const head = ['Driver', 'Section', 'Worked', 'Off', 'OT', 'Vehicles', 'Overtime on']
    const rows = summary.map((s) => [clean(s.driver.full_name), s.driver.section, s.worked, s.off, s.overtime, s.vehicles.join(', ') || '-', otText(s.otByVehicle) || '-'])
    downloadTablePdf({
      title: `Driver Duty Report — ${branchLabel}`,
      subtitle: `${start} to ${end} · ${dates.length} days · ${summary.length} drivers`,
      tables: [{ heading: 'Per-driver summary', head, rows }],
      landscape: true,
      filename: `Duty Report - ${branchLabel} - ${start} to ${end}.pdf`,
    })
  }

  const totals = summary.reduce((a, s) => ({ worked: a.worked + s.worked, off: a.off + s.off, overtime: a.overtime + s.overtime }), { worked: 0, off: 0, overtime: 0 })

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Duty report" subtitle="Days worked (with vehicles), days off, and overtime — by driver, over any period."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button variant="secondary" onClick={exportExcel} disabled={!valid || summary.length === 0}><Download size={15} /> Excel</Button>
        <Button onClick={exportPdf} disabled={!valid || summary.length === 0}><FileText size={15} /> PDF</Button>
      </>}>
      {/* Range picker */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
          {(['month', 'week', 'custom'] as RangeMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={clsx('px-3 py-1.5 text-xs font-semibold capitalize transition-colors', mode === m ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas')}>
              {m === 'month' ? 'This month' : m === 'week' ? 'This week' : 'Custom'}
            </button>
          ))}
        </div>
        {mode === 'custom' ? (
          <div className="flex items-center gap-2">
            <input type="date" className={inputCls} value={custom.start} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} />
            <span className="text-xs text-status-neutral">to</span>
            <input type="date" className={inputCls} value={custom.end} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))} />
          </div>
        ) : (
          <span className="text-xs text-status-neutral">{valid ? `${start} → ${end} (${dates.length} days)` : 'Pick a range'}</span>
        )}
        <div className="ml-auto flex gap-3 text-[11px] text-status-neutral">
          <span><b className="text-navy">{totals.worked}</b> worked</span>
          <span><b className="text-navy">{totals.off}</b> off</span>
          <span><b className="text-[#8a6d10]">{totals.overtime}</b> overtime</span>
        </div>
      </div>

      {!valid ? (
        <p className="rounded-lg bg-canvas px-4 py-8 text-center text-sm text-status-neutral">Choose a valid date range.</p>
      ) : summary.length === 0 ? (
        <p className="rounded-lg bg-canvas px-4 py-8 text-center text-sm text-status-neutral">No drivers in the current filter.</p>
      ) : (
        <div className="max-h-[55vh] overflow-auto rounded-lg border border-black/10">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-navy text-white">
              <tr>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Section</th>
                <th className="px-3 py-2 text-center font-medium">Worked</th>
                <th className="px-3 py-2 text-center font-medium">Off</th>
                <th className="px-3 py-2 text-center font-medium">OT</th>
                <th className="px-3 py-2 font-medium">Vehicles worked</th>
                <th className="px-3 py-2 font-medium">Overtime on</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.driver.id} className="border-t border-black/5">
                  <td className="px-3 py-2 font-medium text-navy">{clean(s.driver.full_name)}</td>
                  <td className="px-3 py-2 text-status-neutral">{s.driver.section}</td>
                  <td className="px-3 py-2 text-center text-navy">{s.worked}</td>
                  <td className="px-3 py-2 text-center text-status-neutral">{s.off}</td>
                  <td className="px-3 py-2 text-center font-semibold text-[#8a6d10]">{s.overtime || ''}</td>
                  <td className="px-3 py-2 text-status-neutral">{s.vehicles.join(', ') || '—'}</td>
                  <td className="px-3 py-2 text-[#8a6d10]">{otText(s.otByVehicle) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] text-status-neutral">Excel includes a per-day grid (each day’s vehicle, OT or Off). Worked/off come from each driver’s rotation; vehicles and overtime come from the Weekly Plan.</p>
    </Modal>
  )
}
