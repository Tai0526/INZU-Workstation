import { useMemo, useRef, useState, type ReactNode } from 'react'
import * as XLSX from 'xlsx'
import { Bus, ChevronLeft, ChevronRight, X, Search, GripVertical, Users, Moon, Wrench, Download, FileText, CalendarRange, Trash2, Save } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { SECTIONS } from '@/lib/org/sections'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { putFile } from '@/lib/storage/fileStore'
import { documentsStore } from '@/lib/documents/store'
import { useDrivers } from '@/lib/drivers/store'
import { useVehicles } from '@/lib/fleet/store'
import { useOperatedVehicles } from '@/lib/fleet/operated'
import { useWeeklyAssign, weeklyAssignStore } from '@/lib/operations/store'
import type { Driver } from '@/lib/drivers/types'
import { driverShiftOnDate, dutyLabel, dutyHours, SHIFT_META, type ShiftType } from '@/lib/drivers/schedule'
import { useScheduling } from '@/lib/drivers/scheduling'
import { useDriverShifts, effectiveKind } from '@/lib/drivers/driverShifts'
import { leaveOverlaps, useDriverLeave } from '@/lib/drivers/leave'
import { WORKSHOP, fridayOf, datesInRange } from '@/lib/drivers/duty'
import { downloadTablePdf, buildTablePdf, type PdfTable } from '@/lib/reports/pdfDoc'

const cleanName = (s: string) => s.replace(/\s*\(demo\)$/, '')
const inputCls = 'rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function addDaysISO(iso: string, n: number): string { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return isoOf(d) }
function fmtDay(iso: string): string { return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : '—' }

function shiftsOver(d: Driver, dates: string[]) {
  let day = 0, night = 0
  for (const date of dates) {
    const k = SHIFT_META[driverShiftOnDate(d, date)].kind
    if (k === 'day') day++
    else if (k === 'night') night++
  }
  return { day, night, working: day + night }
}
function firstWorkingShift(d: Driver, dates: string[]): ShiftType | null {
  for (const date of dates) {
    const st = driverShiftOnDate(d, date)
    if (SHIFT_META[st].kind !== 'off') return st
  }
  return null
}
const shiftLabel = (s: { day: number; night: number }) => (s.day && s.night ? 'Day → Night' : s.day ? 'Day shift' : s.night ? 'Night shift' : 'Off')

interface Picked { driverId: string; name: string }
interface Slot { key: string; fleet: string; reg: string; sub: string; available: boolean; statusChip: string; sectionChip: string; workshop: boolean }

export default function WeeklyPlan() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canPlan = canEdit(role, 'operations') || role === 'route_supervisor'

  const drivers = useDrivers().filter((d) => d.branch === branch)
  const ownedBuses = useVehicles().filter((v) => v.branch === branch && v.status !== 'grounded').sort((a, b) => a.fleet_no.localeCompare(b.fleet_no))
  const operatedAll = useOperatedVehicles().filter((v) => v.branch === branch && v.status !== 'grounded').sort((a, b) => a.fleet_no.localeCompare(b.fleet_no))
  const assigns = useWeeklyAssign()
  useScheduling() // re-render when shift times / crews change so duty windows stay live
  useDriverShifts() // …and when a driver's morning/afternoon assignment changes
  const leaveMap = useDriverLeave() // …and when leave changes (on-leave drivers drop out of the pools)

  // The week runs Friday → Friday (shift change Friday 10:00); the period is customizable.
  const [period, setPeriod] = useState(() => { const start = fridayOf(isoOf(new Date())); return { start, end: addDaysISO(start, 6) } })
  const [custom, setCustom] = useState(false)
  const [section, setSection] = useState('all')
  const [source, setSource] = useState<'all' | 'owned' | 'operated'>('all')
  const [pendingOT, setPendingOT] = useState<{ driverId: string; name: string; fleet: string } | null>(null)
  const [otDays, setOtDays] = useState(7)
  const [otStart, setOtStart] = useState('')
  const [otError, setOtError] = useState('')
  const [selected, setSelected] = useState<Picked | null>(null)
  const [qOn, setQOn] = useState('')
  const [qOff, setQOff] = useState('')
  const pickedRef = useRef<Picked | null>(null)

  const periodDates = useMemo(() => datesInRange(period.start, period.end), [period])
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers])
  const weekAssigns = useMemo(() => assigns.filter((a) => a.branch === branch && a.week_start === period.start), [assigns, branch, period.start])
  const prevStart = addDaysISO(period.start, -(periodDates.length || 7))
  const lastWeekAssigns = useMemo(() => assigns.filter((a) => a.branch === branch && a.week_start === prevStart), [assigns, branch, prevStart])

  const assignedThis = useMemo(() => {
    const m = new Map<string, typeof weekAssigns>()
    weekAssigns.forEach((a) => { const list = m.get(a.fleet_no) ?? []; list.push(a); m.set(a.fleet_no, list) })
    return m
  }, [weekAssigns])
  const lastByFleet = useMemo(() => {
    const m = new Map<string, { driver_id: string; driver_name: string }[]>()
    lastWeekAssigns.forEach((a) => { const list = m.get(a.fleet_no) ?? []; list.push({ driver_id: a.driver_id, driver_name: a.driver_name }); m.set(a.fleet_no, list) })
    return m
  }, [lastWeekAssigns])
  const lastVehicleByDriver = useMemo(() => new Map(lastWeekAssigns.map((a) => [a.driver_id, a.fleet_no])), [lastWeekAssigns])

  const isOffThisWeek = (driverId: string) => { const d = driverById.get(driverId); return d ? shiftsOver(d, periodDates).working === 0 : true }

  // ── Section-aware vehicle slots: owned buses + operated vehicles + the workshop.
  // Pick a section → its drivers and its operated vehicles (or owned buses for a
  // bus section); "All" shows everything.
  // Vehicle source (owned / operated / all) is independent of the driver pools —
  // toggling it keeps the same people, just changes which vehicles are shown.
  const showOwned = source !== 'operated'
  const shownOperated = source === 'owned' ? [] : (section === 'all' ? operatedAll : operatedAll.filter((v) => v.section === section))
  const slots: Slot[] = useMemo(() => {
    const arr: Slot[] = []
    if (showOwned) for (const v of ownedBuses) arr.push({ key: v.id, fleet: v.fleet_no, reg: v.reg_plate, sub: `${v.capacity} seats`, available: v.status === 'active', statusChip: v.status === 'under_repair' ? 'In workshop' : '', sectionChip: '', workshop: false })
    for (const v of shownOperated) arr.push({ key: v.id, fleet: v.fleet_no, reg: v.reg_plate, sub: v.owner || 'Operated', available: v.status === 'active', statusChip: v.status === 'under_repair' ? 'In workshop' : '', sectionChip: v.section, workshop: false })
    arr.push({ key: '__workshop__', fleet: WORKSHOP, reg: '', sub: 'On-site duty · not a bus', available: true, statusChip: '', sectionChip: '', workshop: true })
    return arr
  }, [showOwned, ownedBuses, shownOperated])

  // Driver pools — active drivers (in the chosen section) not yet assigned this period.
  // Only a FULL (non-overtime) booking removes a driver; an overtime cover is
  // partial, so an off-duty driver stays available to take another non-overlapping
  // overtime stint on a different vehicle/period.
  const assignedIds = useMemo(() => new Set(weekAssigns.filter((a) => !a.overtime).map((a) => a.driver_id)), [weekAssigns])
  const otDaysByDriver = useMemo(() => {
    const m = new Map<string, number>()
    weekAssigns.filter((a) => a.overtime).forEach((a) => {
      m.set(a.driver_id, (m.get(a.driver_id) ?? 0) + datesInRange(a.cover_start || a.week_start, a.cover_end || a.week_end).length)
    })
    return m
  }, [weekAssigns])
  // Drivers on leave over this period drop out of the assignable pools.
  const onLeaveCount = useMemo(
    () => drivers.filter((d) => d.status === 'active' && (section === 'all' || d.section === section) && leaveOverlaps(d.id, period.start, period.end)).length,
    [drivers, section, period.start, period.end, leaveMap],
  )
  const { onShift, offDuty } = useMemo(() => {
    const on: { d: Driver; s: ReturnType<typeof shiftsOver> }[] = []
    const off: { d: Driver; s: ReturnType<typeof shiftsOver> }[] = []
    drivers.filter((d) => d.status === 'active' && !assignedIds.has(d.id) && !leaveOverlaps(d.id, period.start, period.end) && (section === 'all' || d.section === section)).forEach((d) => {
      const s = shiftsOver(d, periodDates)
      ;(s.working > 0 ? on : off).push({ d, s })
    })
    const byName = (a: { d: Driver }, b: { d: Driver }) => a.d.full_name.localeCompare(b.d.full_name)
    return { onShift: on.sort(byName), offDuty: off.sort(byName) }
  }, [drivers, assignedIds, periodDates, section, period.start, period.end, leaveMap])

  const fOn = onShift.filter(({ d }) => { const t = qOn.trim().toLowerCase(); return !t || `${d.full_name} ${d.section}`.toLowerCase().includes(t) })
  const fOff = offDuty.filter(({ d }) => { const t = qOff.trim().toLowerCase(); return !t || `${d.full_name} ${d.section}`.toLowerCase().includes(t) })

  /** First free day for a driver's next overtime — the day after their latest existing OT. */
  function nextOtStart(driverId: string): string {
    const ot = weekAssigns.filter((a) => a.driver_id === driverId && a.overtime)
    if (!ot.length) return period.start
    const latest = ot.reduce((m, a) => { const e = a.cover_end || a.week_end; return e > m ? e : m }, '')
    const next = addDaysISO(latest, 1)
    return next < period.start ? period.start : next > period.end ? period.end : next
  }
  function assignDriver(p: Picked, fleet: string) {
    if (!canPlan) return
    if (isOffThisWeek(p.driverId)) {
      // Off this period → overtime cover. Default the start to the day after any
      // existing overtime, so a driver can do back-to-back stints on different buses.
      const start = nextOtStart(p.driverId)
      setPendingOT({ driverId: p.driverId, name: p.name, fleet })
      setOtStart(start)
      setOtDays(Math.max(1, datesInRange(start, period.end).length))
      setOtError('')
    } else {
      if (weekAssigns.some((a) => a.fleet_no === fleet && a.driver_id === p.driverId && !a.overtime)) { setSelected(null); pickedRef.current = null; return }
      weeklyAssignStore.add({ branch, week_start: period.start, week_end: period.end, fleet_no: fleet, driver_id: p.driverId, driver_name: p.name, overtime: false })
    }
    setSelected(null)
    pickedRef.current = null
  }
  function confirmOT() {
    if (!pendingOT) return
    const days = Math.max(1, Math.min(otDays || 1, periodDates.length))
    const start = otStart && otStart >= period.start && otStart <= period.end ? otStart : period.start
    const rawEnd = addDaysISO(start, days - 1)
    const end = rawEnd > period.end ? period.end : rawEnd
    // Overtime stints for the same driver must not overlap.
    const clash = weekAssigns.some((a) => {
      if (a.driver_id !== pendingOT.driverId || !a.overtime) return false
      const s = a.cover_start || a.week_start, e = a.cover_end || a.week_end
      return start <= e && s <= end
    })
    if (clash) { setOtError('That overlaps overtime this driver already has. Start it after the existing stint ends.'); return }
    weeklyAssignStore.add({ branch, week_start: period.start, week_end: period.end, cover_start: start, cover_end: end, fleet_no: pendingOT.fleet, driver_id: pendingOT.driverId, driver_name: pendingOT.name, overtime: true })
    setPendingOT(null)
  }
  function shiftPeriod(dir: -1 | 1) {
    setPeriod((p) => { const len = datesInRange(p.start, p.end).length || 7; const start = addDaysISO(p.start, dir * len); return { start, end: addDaysISO(start, len - 1) } })
  }
  function goThisWeek() { const start = fridayOf(isoOf(new Date())); setPeriod({ start, end: addDaysISO(start, 6) }); setCustom(false) }

  // ── Export (respects the Owned / Operated / section filter — they're separate
  //    operations and must never print together) ──
  const srcLabel = source === 'owned' ? 'Owned vehicles' : source === 'operated' ? 'Operated vehicles' : 'All vehicles'
  function exportAssigns() {
    const shownFleets = new Set(slots.filter((s) => !s.workshop).map((s) => s.fleet))
    return weekAssigns.filter((a) => (a.fleet_no === WORKSHOP ? source === 'all' : shownFleets.has(a.fleet_no)))
  }
  function planRows() {
    const regBy = new Map<string, string>()
    ownedBuses.forEach((v) => regBy.set(v.fleet_no, v.reg_plate))
    operatedAll.forEach((v) => regBy.set(v.fleet_no, v.reg_plate))
    return [...exportAssigns()]
      .sort((a, b) => a.fleet_no.localeCompare(b.fleet_no) || a.driver_name.localeCompare(b.driver_name))
      .map((a) => {
        const drv = driverById.get(a.driver_id)
        const st = drv ? firstWorkingShift(drv, periodDates) : null
        const coverDays = datesInRange(a.cover_start || a.week_start, a.cover_end || a.week_end).length
        const win = drv && st ? dutyHours(drv, st) : ''
        const shiftName = drv && st ? dutyLabel(drv, st) : ''
        const duty = a.overtime ? `Overtime — ${coverDays} day${coverDays === 1 ? '' : 's'}` : a.fleet_no === WORKSHOP ? 'Workshop duty' : st ? `${shiftName}${win ? ` · ${win}` : ''}` : 'On shift'
        return { vehicle: a.fleet_no === WORKSHOP ? 'Workshop' : a.fleet_no, reg: a.fleet_no === WORKSHOP ? '—' : (regBy.get(a.fleet_no) ?? '—'), driver: cleanName(a.driver_name), duty }
      })
  }
  const periodLabel = `${period.start} → ${period.end}`
  // Vehicle on the left, then the Day shift, then the Night shift — each driver
  // with their hours in brackets. Portrait, compact, easy to read on one page.
  function planPdfTables(): PdfTable[] {
    const regBy = new Map<string, string>()
    ownedBuses.forEach((v) => regBy.set(v.fleet_no, v.reg_plate))
    operatedAll.forEach((v) => regBy.set(v.fleet_no, v.reg_plate))
    const vehicles = new Map<string, { day: string[]; night: string[] }>()
    const workshop: string[] = []
    for (const a of exportAssigns()) {
      const drv = driverById.get(a.driver_id)
      const st = drv ? firstWorkingShift(drv, periodDates) : null
      const isNight = st ? SHIFT_META[st].kind === 'night' : (drv ? effectiveKind(drv) === 'night' : false)
      const hrs = drv && st ? dutyHours(drv, st).replace(/ · /g, ', ') : ''
      const cover = a.overtime ? ` [OT ${datesInRange(a.cover_start || a.week_start, a.cover_end || a.week_end).length}d]` : ''
      const entry = `${cleanName(a.driver_name)}${hrs ? ` (${hrs})` : ''}${cover}`
      if (a.fleet_no === WORKSHOP) { workshop.push(`${cleanName(a.driver_name)}${cover}`); continue }
      const v = vehicles.get(a.fleet_no) ?? { day: [], night: [] }
      ;(isNight ? v.night : v.day).push(entry)
      vehicles.set(a.fleet_no, v)
    }
    const rows = [...vehicles.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fleet, v]) => [`${fleet}${regBy.get(fleet) ? `\n${regBy.get(fleet)}` : ''}`, v.day.join('\n') || '—', v.night.join('\n') || '—'])
    const tables: PdfTable[] = [{
      head: ['Vehicle', 'Day shift', 'Night shift'],
      rows,
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 84 } },
    }]
    if (workshop.length) tables.push({ heading: 'Workshop duty', head: ['Driver'], rows: workshop.map((w) => [w]) })
    return tables
  }
  const pdfSubtitle = () => { const n = exportAssigns().length; return `${srcLabel} · ${fmtDay(period.start)} → ${fmtDay(period.end)} · ${n} assignment${n === 1 ? '' : 's'}` }
  function exportPdf() {
    downloadTablePdf({
      title: `Weekly Plan — ${branchLabel}`,
      subtitle: pdfSubtitle(),
      tables: planPdfTables(),
      landscape: false,
      dense: true,
      filename: `Weekly Plan - ${branchLabel} - ${srcLabel} - ${period.start}.pdf`,
    })
  }
  function exportExcel() {
    const rows = planRows().map((r) => ({ Vehicle: r.vehicle, 'Reg No': r.reg, Driver: r.driver, Duty: r.duty }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Weekly Plan')
    XLSX.writeFile(wb, `INZU_Weekly_Plan_${branchLabel}_${period.start}.xlsx`)
  }
  function clearWeek() {
    if (weekAssigns.length === 0) return
    if (!confirm(`Clear all ${weekAssigns.length} assignment(s) for this period? This can't be undone.`)) return
    weekAssigns.forEach((a) => weeklyAssignStore.remove(a.id))
  }
  function saveToDocs() {
    if (weekAssigns.length === 0) return
    const doc = buildTablePdf({ title: `Weekly Plan — ${branchLabel}`, subtitle: pdfSubtitle(), tables: planPdfTables(), landscape: false, dense: true })
    const blob = doc.output('blob')
    const fileName = `Weekly Plan - ${branchLabel} - ${srcLabel} - ${period.start}.pdf`
    const fileId = `wplan_${branch}_${period.start}_${Date.now()}`
    putFile(fileId, new File([blob], fileName, { type: 'application/pdf' })).then(() => {
      documentsStore.add({ category: 'other', entity_type: 'general', entity_id: `weekly-plan-${branch}-${period.start}`, entity_label: `Weekly Plan — ${branchLabel} · ${srcLabel} (${fmtDay(period.start)})`, branch, issue_date: isoOf(new Date()), expiry_date: '', reference_no: '', issuer: '', file_id: fileId, file_name: fileName, file_size: blob.size, mime_type: 'application/pdf', notes: `${srcLabel} · ${exportAssigns().length} assignments · ${periodLabel}`, uploaded_by_role: role })
      alert('Weekly plan saved to Documents.')
    })
  }

  // A draggable / tap-selectable driver token.
  function Token({ p, subtitle, grayed, compact }: { p: Picked; subtitle: string; grayed?: boolean; compact?: boolean }) {
    const picked = selected?.driverId === p.driverId
    return (
      <button
        draggable={canPlan}
        onDragStart={(e) => { pickedRef.current = p; e.stopPropagation() }}
        onDragEnd={() => { pickedRef.current = null }}
        onClick={(e) => { e.stopPropagation(); if (canPlan) setSelected(picked ? null : p) }}
        className={clsx('flex w-full items-center gap-2 rounded-lg border text-left transition-colors',
          compact ? 'px-2 py-1' : 'px-2.5 py-2',
          picked ? 'border-brand bg-brand-tint/60 ring-1 ring-brand/30' : grayed ? 'border-dashed border-black/15 bg-canvas/50' : 'border-black/10 bg-white hover:border-brand/40',
          canPlan && 'cursor-grab active:cursor-grabbing')}
      >
        {canPlan && !compact && <GripVertical size={13} className="shrink-0 text-status-neutral" />}
        <span className="min-w-0 flex-1">
          <span className={clsx('block truncate font-medium', compact ? 'text-xs' : 'text-sm', grayed ? 'text-status-neutral' : 'text-navy')}>{cleanName(p.name)}</span>
          <span className="block truncate text-[11px] text-status-neutral">{subtitle}</span>
        </span>
      </button>
    )
  }

  const vehicleCount = slots.filter((s) => !s.workshop).length

  return (
    <div className="page space-y-4">
      <p className="max-w-3xl text-sm text-status-neutral">
        Assign drivers to vehicles for the week (Friday → Friday, shift change 10:00). Pick a <span className="font-medium text-navy">section</span> to plan its drivers against its vehicles — owned buses for the transport sections, the contract (operated) vehicles for Pit, Security and Dewatering. Drag a driver onto a vehicle, or tap a driver then tap a vehicle.
      </p>

      {/* Period navigation + export */}
      <div className="card flex flex-wrap items-center gap-3 p-3">
        {!custom ? (
          <>
            <div className="flex items-center gap-1">
              <button onClick={() => shiftPeriod(-1)} className="rounded-lg border border-black/15 p-1.5 text-navy hover:bg-canvas"><ChevronLeft size={16} /></button>
              <button onClick={() => shiftPeriod(1)} className="rounded-lg border border-black/15 p-1.5 text-navy hover:bg-canvas"><ChevronRight size={16} /></button>
            </div>
            <div>
              <div className="font-display text-sm font-bold text-navy">{fmtDay(period.start)} → {fmtDay(addDaysISO(period.start, 7))}</div>
              <div className="text-[11px] text-status-neutral">Shift change · Fri 10:00 · {weekAssigns.length} assignment{weekAssigns.length === 1 ? '' : 's'} · {weekAssigns.filter((a) => a.overtime).length} overtime</div>
            </div>
            <button onClick={goThisWeek} className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium text-navy hover:bg-canvas">This week</button>
            <button onClick={() => setCustom(true)} className="inline-flex items-center gap-1 rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium text-navy hover:bg-canvas"><CalendarRange size={13} /> Customise</button>
          </>
        ) : (
          <>
            <CalendarRange size={16} className="text-brand" />
            <span className="text-xs font-medium text-navy">Plan period</span>
            <input type="date" value={period.start} onChange={(e) => { const start = e.target.value; setPeriod((p) => ({ start, end: p.end && p.end >= start ? p.end : start })) }} className="rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-brand" />
            <span className="text-xs text-status-neutral">to</span>
            <input type="date" value={period.end} onChange={(e) => { const end = e.target.value; setPeriod((p) => ({ start: p.start, end })) }} className="rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-brand" />
            <span className="text-[11px] text-status-neutral">{periodDates.length} day{periodDates.length === 1 ? '' : 's'} · {weekAssigns.length} assignment{weekAssigns.length === 1 ? '' : 's'}</span>
            <button onClick={goThisWeek} className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium text-navy hover:bg-canvas">Back to weekly</button>
          </>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportPdf} disabled={weekAssigns.length === 0}><FileText size={15} /> PDF</Button>
          <Button variant="secondary" onClick={exportExcel} disabled={weekAssigns.length === 0}><Download size={15} /> Excel</Button>
          {canPlan && <Button variant="secondary" onClick={saveToDocs} disabled={weekAssigns.length === 0}><Save size={15} /> Save to docs</Button>}
          {canPlan && <Button variant="secondary" onClick={clearWeek} disabled={weekAssigns.length === 0}><Trash2 size={15} /> Clear all</Button>}
        </div>
      </div>

      {/* Section filter (people) + vehicle source (owned / operated) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-navy">Plan for</span>
        <select value={section} onChange={(e) => setSection(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All sections</option>
          {SECTIONS[branch].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="ml-1 text-xs font-medium text-navy">Vehicles</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
          {(['all', 'owned', 'operated'] as const).map((s) => (
            <button key={s} onClick={() => setSource(s)} className={clsx('px-3 py-1.5 text-xs font-semibold transition-colors', source === s ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas')}>
              {s === 'all' ? 'All' : s === 'owned' ? 'Owned' : 'Operated'}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-status-neutral">{fOn.length + fOff.length} drivers · {vehicleCount} vehicle{vehicleCount === 1 ? '' : 's'}{onLeaveCount > 0 ? ` · ${onLeaveCount} on leave` : ''}</span>
      </div>

      {/* Tap-to-place banner */}
      {selected && (
        <div className="flex items-center gap-2 rounded-xl border border-brand/40 bg-brand-tint/50 px-4 py-2.5 text-sm">
          <span className="text-navy">Placing <b>{cleanName(selected.name)}</b>{isOffThisWeek(selected.driverId) && <span className="text-[#8a6d10]"> (off duty → overtime)</span>} — tap an available vehicle to assign.</span>
          <button onClick={() => setSelected(null)} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-status-neutral hover:text-navy"><X size={13} /> Cancel</button>
        </div>
      )}

      {/* Three areas: on-shift pool · vehicles · off-duty pool. Fixed height on
          desktop so all three columns stay put and scroll independently. */}
      <div className="grid grid-cols-1 gap-3 lg:h-[calc(100vh-15rem)] lg:grid-cols-[240px_1fr_240px]">
        {/* On shift */}
        <Pool title="On shift" count={fOn.length} q={qOn} setQ={setQOn} icon={<Users size={14} className="text-status-good" />} accent="good">
          {fOn.map(({ d, s }) => <Token key={d.id} p={{ driverId: d.id, name: d.full_name }} subtitle={`${d.section} · ${shiftLabel(s)}`} />)}
          {fOn.length === 0 && <Empty>No on-shift drivers free.</Empty>}
        </Pool>

        {/* Vehicles */}
        <div className="card flex min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-black/5 px-4 py-2.5">
            <Bus size={14} className="text-brand" />
            <h3 className="font-display text-sm font-bold text-navy">Vehicles</h3>
            <span className="text-[11px] text-status-neutral">{vehicleCount}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
            {slots.map((slot) => {
              const assigned = assignedThis.get(slot.fleet) ?? []
              const last = lastByFleet.get(slot.fleet) ?? []
              const isTarget = slot.available && !!selected
              return (
                <div
                  key={slot.key}
                  onDragOver={(e) => { if (slot.available && canPlan) e.preventDefault() }}
                  onDrop={() => { if (slot.available && pickedRef.current) assignDriver(pickedRef.current, slot.fleet) }}
                  onClick={() => { if (slot.available && selected) assignDriver(selected, slot.fleet) }}
                  className={clsx('rounded-xl border p-3 transition-colors',
                    !slot.available ? 'border-dashed border-black/15 bg-canvas/50 opacity-70'
                      : isTarget ? 'cursor-pointer border-brand/60 bg-brand-tint/20 ring-1 ring-brand/20 hover:bg-brand-tint/40' : 'border-black/10 bg-white')}
                >
                  {/* ── header ── */}
                  <div className="flex items-center gap-2">
                    <span className="h-px flex-1 bg-black/10" />
                    <span className={clsx('inline-flex items-center gap-1 font-display text-sm font-bold tracking-wider', slot.available ? 'text-navy' : 'text-status-neutral')}>
                      {slot.workshop && <Wrench size={12} className="text-brand" />}{slot.workshop ? 'Workshop' : slot.fleet}
                    </span>
                    <span className="h-px flex-1 bg-black/10" />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[11px] text-status-neutral">
                    <span>{[slot.reg, slot.sub].filter(Boolean).join(' · ')}</span>
                    {slot.sectionChip && <span className="rounded-full bg-navy/5 px-1.5 py-0.5 font-medium text-navy">{slot.sectionChip}</span>}
                    {slot.statusChip && <span className="inline-flex items-center gap-1 rounded-full bg-status-neutral/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide"><Wrench size={9} /> {slot.statusChip}</span>}
                  </div>

                  {/* Left = this week · Right = last week (off duty) */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-status-neutral">This week</div>
                      <div className="space-y-1">
                        {assigned.map((a) => {
                          const drv = driverById.get(a.driver_id)
                          const st = drv ? firstWorkingShift(drv, periodDates) : null
                          const cs = a.cover_start || a.week_start
                          const ce = a.cover_end || a.week_end
                          const coverDays = datesInRange(cs, ce).length
                          const win = drv && st ? dutyHours(drv, st) : ''
                          const shiftName = drv && st ? dutyLabel(drv, st) : ''
                          const label = a.overtime
                            ? `Overtime · ${coverDays}d`
                            : slot.workshop ? 'Workshop duty'
                              : st ? `${shiftName}${win ? ` · ${win}` : ''}`
                                : 'On shift'
                          return (
                            <div key={a.id} className="flex items-start gap-1.5 rounded-lg border border-black/10 bg-white px-2 py-1">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-navy">{cleanName(a.driver_name)}</div>
                                <div className={clsx('truncate text-[10px]', a.overtime ? 'font-medium text-[#8a6d10]' : 'text-status-neutral')} title={a.overtime ? `Cover ${cs} → ${ce}` : undefined}>{label}</div>
                              </div>
                              {canPlan && <button onClick={(e) => { e.stopPropagation(); weeklyAssignStore.remove(a.id) }} className="shrink-0 rounded p-0.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><X size={11} /></button>}
                            </div>
                          )
                        })}
                        {assigned.length === 0 && (
                          <div className="rounded-lg border border-dashed border-black/15 px-2 py-2 text-center text-[10px] text-status-neutral">
                            {slot.available ? (canPlan ? 'Drop driver here' : 'Unassigned') : 'Unavailable'}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-status-neutral"><Moon size={9} /> Last week · off</div>
                      <div className="space-y-1">
                        {last.map((l) => (
                          <Token key={l.driver_id} p={{ driverId: l.driver_id, name: l.driver_name }} subtitle="off duty" grayed compact />
                        ))}
                        {last.length === 0 && <div className="px-1 py-1 text-[10px] text-status-neutral">—</div>}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {vehicleCount === 0 && <Empty>No vehicles for this section.</Empty>}
          </div>
        </div>

        {/* Off duty */}
        <Pool title="Off duty" count={fOff.length} q={qOff} setQ={setQOff} icon={<Moon size={14} className="text-status-neutral" />} accent="neutral" hint="Drag in to cover → overtime">
          {fOff.map(({ d }) => {
            const lastV = lastVehicleByDriver.get(d.id)
            const ot = otDaysByDriver.get(d.id)
            const sub = `${d.section}${lastV ? ` · drove ${lastV}` : ''}${ot ? ` · ${ot}d OT booked` : ''}`
            return <Token key={d.id} p={{ driverId: d.id, name: d.full_name }} subtitle={sub} grayed />
          })}
          {fOff.length === 0 && <Empty>Everyone is on shift.</Empty>}
        </Pool>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-status-neutral">
        <span className="inline-flex items-center gap-1"><span className="rounded bg-status-warning/30 px-1 text-[9px] font-bold uppercase text-[#8a6d10]">OT</span> Off-duty cover is logged as overtime.</span>
        <span className="inline-flex items-center gap-1"><Wrench size={11} /> Greyed vehicles are in the workshop — can’t be assigned.</span>
        {!canPlan && <span>· View only — Bus Controllers, Route Supervisors and Operations can plan.</span>}
      </div>

      {/* Overtime cover — confirm how many days (leave overrun, sickness, …) */}
      <Modal open={!!pendingOT} onClose={() => { setPendingOT(null); setOtError('') }} title="Overtime cover"
        subtitle={pendingOT ? `${cleanName(pendingOT.name)} · ${pendingOT.fleet === WORKSHOP ? 'Workshop' : pendingOT.fleet}` : ''}
        footer={<><Button variant="secondary" onClick={() => { setPendingOT(null); setOtError('') }}>Cancel</Button><Button onClick={confirmOT}>Add overtime</Button></>}>
        <p className="mb-3 text-sm text-status-neutral">They're off this period — confirm how many days they're covering (e.g. while someone's leave overruns or they're off sick). It doesn't have to be the full week, and you can add more than one stint as long as the dates don't overlap.</p>
        {pendingOT && (() => {
          const existing = weekAssigns.filter((a) => a.driver_id === pendingOT.driverId && a.overtime).sort((a, b) => (a.cover_start || '').localeCompare(b.cover_start || ''))
          if (!existing.length) return null
          return (
            <div className="mb-3 rounded-lg border border-black/10 bg-canvas px-3 py-2 text-xs text-navy">
              <div className="mb-1 font-semibold text-status-neutral">Already covering this period:</div>
              <ul className="space-y-0.5">
                {existing.map((a) => <li key={a.id}>• {a.fleet_no === WORKSHOP ? 'Workshop' : a.fleet_no} — {fmtDay(a.cover_start || a.week_start)} → {fmtDay(a.cover_end || a.week_end)}</li>)}
              </ul>
            </div>
          )
        })()}
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Days</span>
            <input type="number" min={1} max={periodDates.length} value={otDays} onChange={(e) => { setOtDays(Number(e.target.value)); setOtError('') }} className={`${inputCls} w-24`} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Starting</span>
            <input type="date" min={period.start} max={period.end} value={otStart} onChange={(e) => { setOtStart(e.target.value); setOtError('') }} className={inputCls} /></label>
          <div className="flex gap-1 pb-0.5">
            {[2, 3, 5].filter((n) => n <= periodDates.length).map((n) => (
              <button key={n} onClick={() => { setOtDays(n); setOtError('') }} className={clsx('rounded-lg border px-2.5 py-2 text-xs font-medium', otDays === n ? 'border-brand bg-brand-tint/60 text-navy' : 'border-black/15 text-navy hover:bg-canvas')}>{n}d</button>
            ))}
            <button onClick={() => { setOtDays(periodDates.length); setOtError('') }} className={clsx('rounded-lg border px-2.5 py-2 text-xs font-medium', otDays === periodDates.length ? 'border-brand bg-brand-tint/60 text-navy' : 'border-black/15 text-navy hover:bg-canvas')}>Full</button>
          </div>
        </div>
        {pendingOT && (() => {
          const days = Math.max(1, Math.min(otDays || 1, periodDates.length))
          const start = otStart && otStart >= period.start && otStart <= period.end ? otStart : period.start
          const rawEnd = addDaysISO(start, days - 1); const end = rawEnd > period.end ? period.end : rawEnd
          return <p className="mt-3 text-xs text-status-neutral">Covering <b className="text-navy">{datesInRange(start, end).length} day(s)</b> · {fmtDay(start)} → {fmtDay(end)}.</p>
        })()}
        {otError && <p className="mt-3 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-xs text-status-critical">{otError}</p>}
      </Modal>
    </div>
  )
}

function Pool({ title, count, q, setQ, icon, hint, accent, children }: {
  title: string; count: number; q: string; setQ: (v: string) => void; icon: ReactNode; hint?: string; accent: 'good' | 'neutral'; children: ReactNode
}) {
  return (
    <div className="card flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-black/5 px-4 py-2.5">
        {icon}
        <h3 className="font-display text-sm font-bold text-navy">{title}</h3>
        <span className={clsx('rounded-full px-1.5 py-0.5 text-[11px] font-semibold', accent === 'good' ? 'bg-status-good/10 text-status-good' : 'bg-navy/5 text-navy')}>{count}</span>
      </div>
      {hint && <div className="border-b border-black/5 bg-canvas/50 px-4 py-1.5 text-[11px] text-status-neutral">{hint}</div>}
      <div className="border-b border-black/5 px-3 py-2">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full rounded-lg border border-black/15 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand" />
        </div>
      </div>
      <div className="min-h-0 max-h-[55vh] flex-1 space-y-1.5 overflow-y-auto p-2 lg:max-h-none">{children}</div>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-6 text-center text-xs text-status-neutral">{children}</p>
}
