import ExcelJS from 'exceljs'
import type { Vehicle } from '@/lib/fleet/types'
import type { DocumentRecord } from '@/lib/documents/types'
import type { LicCat } from '@/lib/documents/licensingConfig'
import {
  buildLicensingRows, cellStatus, rowFlags, matchesFilter, FILTER_LABEL,
  type CellTone, type LicRow, type LicFilter,
} from './licensingStatus'
import { bookingKey, BOOKING_STATUS_LABEL, type Booking } from './inspectionBookings'

/**
 * Licensing expiry spreadsheet — current Road Tax / Insurance / Fitness /
 * FQM Inspection (any mix, incl. custom categories) per vehicle, with the
 * expiry date, days left and a plain-words status. One glance answers
 * "what do we need to renew, and by when". The whole fleet, or only the
 * vehicles matching a scope (expired / expiring soon / missing).
 *
 * Status comes from lib/fleet/licensingStatus — the SAME module the on-screen
 * grid uses, so the sheet and the page can never disagree.
 *
 * Styled with the INZU palette (exceljs — the community `xlsx` can't style):
 * navy title bar, navy category bands, light header row, real Excel dates,
 * status colours, frozen header + fleet columns, and a filter row.
 */

// Re-exported so existing importers (and tests) keep working from one place.
export { cellStatus, buildLicensingRows } from './licensingStatus'
export type { CellTone, LicRow } from './licensingStatus'

// ── INZU palette (ARGB) ──────────────────────────────────────────────────────
const NAVY = 'FF0F1B33'
const NAVY2 = 'FF1B2A4A'
const WHITE = 'FFFFFFFF'
const HEAD_BG = 'FFEDF1F7' // light blue-grey header row
const ZEBRA = 'FFF7F9FC' // alternate body rows, barely-there
const LINE = 'FFD8DEE9' // cell borders
const MUTED = 'FF6B7280'
const GOOD = 'FF2E7D4F'
const AMBER = 'FF8A6D10'
const RED = 'FFB3261E'
const RED_BG = 'FFFBEAE9'
const AMBER_BG = 'FFFAF3DC'

const STATUS_STYLE: Record<CellTone, { color: string; bg?: string; bold?: boolean }> = {
  valid: { color: GOOD },
  expiring: { color: AMBER, bg: AMBER_BG },
  today: { color: RED, bg: AMBER_BG, bold: true },
  expired: { color: RED, bg: RED_BG, bold: true },
  missing: { color: RED, bg: RED_BG, bold: true },
  quiet: { color: MUTED },
  nodate: { color: MUTED },
}

const thin = { style: 'thin' as const, color: { argb: LINE } }
const BOX = { top: thin, left: thin, bottom: thin, right: thin }

/** ISO yyyy-mm-dd → Excel date (UTC so the day never shifts). */
function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** ISO → "12 Sep 2026" for prose lines inside the sheet. */
function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Serialise and hand the file to the browser. */
async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Build the styled workbook. Separate from the download so tests can reopen it. */
export function buildLicensingWorkbook(opts: {
  vehicles: Vehicle[]
  docs: Pick<DocumentRecord, 'entity_id' | 'category' | 'superseded' | 'expiry_date'>[]
  cats: LicCat[]
  branchLabel: string
  today?: Date
  /** Company logo (PNG, base64 without the data: prefix) — sits in the navy title bar. */
  logoBase64?: string
  /** Limit the sheet to vehicles matching this state (default: the whole fleet). */
  scope?: LicFilter
}): { wb: ExcelJS.Workbook; filename: string } {
  const { vehicles, docs, cats, branchLabel, logoBase64 } = opts
  const scope: LicFilter = opts.scope ?? 'all'
  const today = opts.today ?? new Date()
  // Same status module as the page, so a filtered sheet contains exactly the
  // vehicles the matching on-screen filter shows.
  const allRows = buildLicensingRows(vehicles, docs, cats, today)
  const rows: LicRow[] = scope === 'all' ? allRows : allRows.filter((r) => matchesFilter(rowFlags(r.cells), scope))
  const stamp = today.toISOString().slice(0, 10)
  const lastCol = 3 + cats.length * 3
  const scopeLabel = scope === 'all' ? '' : FILTER_LABEL[scope]

  const wb = new ExcelJS.Workbook()
  wb.creator = 'INZU Workstation'
  const ws = wb.addWorksheet('Licensing', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }], // fleet & reg + headers stay put
    properties: { defaultRowHeight: 16 },
  })

  ws.columns = [
    { width: 11 }, { width: 14 }, { width: 20 },
    ...cats.flatMap(() => [{ width: 13 }, { width: 9 }, { width: 21 }]),
  ]

  // Row 1 — navy banner: logo on the left, title centred (letterhead style).
  const title = ws.getRow(1)
  title.height = logoBase64 ? 42 : 28
  ws.mergeCells(1, 1, 1, lastCol)
  const t = ws.getCell(1, 1)
  t.value = scopeLabel ? `Vehicle Licensing — ${branchLabel} · ${scopeLabel}` : `Vehicle Licensing — ${branchLabel}`
  t.font = { name: 'Calibri', size: 14, bold: true, color: { argb: WHITE } }
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  t.alignment = { vertical: 'middle', horizontal: logoBase64 ? 'center' : 'left', indent: 1 }
  if (logoBase64) {
    const img = wb.addImage({ base64: logoBase64, extension: 'png' })
    // The logo is designed for a navy background (same as the app sidebar).
    ws.addImage(img, { tl: { col: 0.15, row: 0.12 }, ext: { width: 118, height: 40 } })
  }

  // Row 2 — quiet subtitle.
  ws.mergeCells(2, 1, 2, lastCol)
  const s = ws.getCell(2, 1)
  s.value = `Generated ${stamp} · ${rows.length} vehicle${rows.length === 1 ? '' : 's'}${scopeLabel ? ` matching "${scopeLabel}" (of ${allRows.length})` : ''} · ${cats.map((c) => c.short).join(' · ')}`
  s.font = { size: 9, color: { argb: MUTED } }
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(2).height = 15

  // Row 3 — category bands (merged over each trio), navy-secondary.
  const band = ws.getRow(3)
  band.height = 18
  ws.mergeCells(3, 1, 3, 3)
  const veh = ws.getCell(3, 1)
  veh.value = 'Vehicle'
  cats.forEach((c, i) => {
    const c0 = 4 + i * 3
    ws.mergeCells(3, c0, 3, c0 + 2)
    const cell = ws.getCell(3, c0)
    cell.value = c.label + (c.required ? '' : ' (optional)')
  })
  for (let col = 1; col <= lastCol; col++) {
    const cell = ws.getCell(3, col)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY2 } }
    cell.font = { size: 10, bold: true, color: { argb: WHITE } }
    cell.alignment = { vertical: 'middle', horizontal: col <= 3 ? 'left' : 'center', indent: col <= 3 ? 1 : 0 }
  }

  // Row 4 — field names, light header with a navy underline.
  const head = ws.getRow(4)
  head.height = 17
  const headNames = ['Fleet No', 'Reg Plate', 'Make / Model', ...cats.flatMap(() => ['Expiry', 'Days left', 'Status'])]
  headNames.forEach((name, i) => {
    const cell = ws.getCell(4, i + 1)
    cell.value = name
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } }
    cell.font = { size: 9, bold: true, color: { argb: NAVY } }
    cell.alignment = { vertical: 'middle', horizontal: i >= 3 ? 'center' : 'left', indent: i >= 3 ? 0 : 1 }
    cell.border = { ...BOX, bottom: { style: 'medium', color: { argb: NAVY } } }
  })
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: lastCol } }

  // Body.
  rows.forEach((r, ri) => {
    const row = ws.getRow(5 + ri)
    const zebra = ri % 2 === 1
    const base: (string | number | Date | null)[] = [r.fleet, r.reg, r.make]
    r.cells.forEach((c) => base.push(c.expiry ? isoToDate(c.expiry) : null, c.days ?? null, c.status))
    base.forEach((v, i) => {
      const cell = ws.getCell(5 + ri, i + 1)
      cell.value = v ?? '—'
      cell.border = BOX
      if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } }
      cell.font = { size: 10, color: { argb: 'FF25314A' } }
      cell.alignment = { vertical: 'middle', horizontal: i >= 3 ? 'center' : 'left', indent: i >= 3 ? 0 : 1 }
    })
    // Fleet no leads the row.
    ws.getCell(5 + ri, 1).font = { size: 10, bold: true, color: { argb: NAVY } }
    // Per-category styling: date format + status colours.
    r.cells.forEach((c, ci) => {
      const dateCell = ws.getCell(5 + ri, 4 + ci * 3)
      if (c.expiry) dateCell.numFmt = 'dd mmm yyyy'
      else dateCell.font = { size: 10, color: { argb: MUTED } }
      const st = STATUS_STYLE[c.tone]
      const statusCell = ws.getCell(5 + ri, 6 + ci * 3)
      statusCell.font = { size: 10, bold: !!st.bold, color: { argb: st.color } }
      if (st.bg) statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.bg } }
      if (c.days === null) ws.getCell(5 + ri, 5 + ci * 3).font = { size: 10, color: { argb: MUTED } }
    })
  })

  // A filtered export can legitimately match nothing — say so in the sheet
  // rather than handing over a file that looks broken.
  if (rows.length === 0) {
    ws.mergeCells(5, 1, 5, lastCol)
    const empty = ws.getCell(5, 1)
    empty.value = scopeLabel ? `No vehicles match "${scopeLabel}" — nothing to action.` : 'No vehicles to list.'
    empty.font = { size: 11, italic: true, color: { argb: MUTED } }
    empty.alignment = { vertical: 'middle', horizontal: 'center' }
    ws.getRow(5).height = 26
  }

  const scopeFile = scope === 'all' ? '' : ` (${FILTER_LABEL[scope]})`
  return { wb, filename: `Licensing Expiry - ${branchLabel}${scopeFile} - ${stamp}.xlsx` }
}

/** Fetch the app logo as base64 for the banner; quietly skip if unavailable. */
async function fetchLogoBase64(): Promise<string | undefined> {
  try {
    const res = await fetch('/logo.png')
    if (!res.ok) return undefined
    const blob = await res.blob()
    return await new Promise<string | undefined>((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result).split(',')[1] || undefined)
      fr.onerror = () => resolve(undefined)
      fr.readAsDataURL(blob)
    })
  } catch { return undefined }
}

// ── Inspection booking sheet (the one you email to FQM) ─────────────────────

export type BookingMode = 'with-expiry' | 'schedule-only'

export interface BookingSheetRow {
  fleet: string
  reg: string
  make: string
  expiry: string
  days: number | null
  docStatus: string
  tone: CellTone
  bookedFor: string // '' when not yet booked
  bookingStatus: string
  note: string
}

/**
 * Rows for the booking sheet: one per vehicle we are presenting (and, when
 * asked, the ones falling due that we have NOT booked yet — so the other party
 * can see what is coming, not just what is agreed). Pure, so it is testable.
 */
export function buildBookingRows(opts: {
  vehicles: Vehicle[]
  docs: Pick<DocumentRecord, 'entity_id' | 'category' | 'superseded' | 'expiry_date'>[]
  cat: LicCat
  bookings: Record<string, Booking>
  includeUnbooked?: boolean
  today?: Date
}): BookingSheetRow[] {
  const { vehicles, docs, cat, bookings, includeUnbooked } = opts
  const today = opts.today ?? new Date()
  const out: BookingSheetRow[] = []
  for (const v of vehicles) {
    const cur = docs.find((d) => d.entity_id === v.id && d.category === cat.key && !d.superseded)
    const cell = cellStatus(cur?.expiry_date, cat.required, today)
    const b = bookings[bookingKey(v.id, cat.key)]
    // Unbooked vehicles are only worth listing when something is actually due.
    const due = cell.tone === 'expired' || cell.tone === 'today' || cell.tone === 'expiring' || cell.tone === 'missing'
    if (!b && !(includeUnbooked && due)) continue
    out.push({
      fleet: v.fleet_no,
      reg: v.reg_plate,
      make: [v.make, v.model].filter(Boolean).join(' '),
      expiry: cell.expiry,
      days: cell.days,
      docStatus: cell.status,
      tone: cell.tone,
      bookedFor: b?.date ?? '',
      bookingStatus: b ? BOOKING_STATUS_LABEL[b.status] : 'Not yet booked',
      note: b?.note ?? '',
    })
  }
  // Booked first, earliest date first; unbooked fall to the bottom by urgency.
  return out.sort((a, b) => {
    if (a.bookedFor && b.bookedFor) return a.bookedFor.localeCompare(b.bookedFor) || a.fleet.localeCompare(b.fleet, undefined, { numeric: true })
    if (a.bookedFor) return -1
    if (b.bookedFor) return 1
    return (a.days ?? 9999) - (b.days ?? 9999) || a.fleet.localeCompare(b.fleet, undefined, { numeric: true })
  })
}

/** The booking workbook. `schedule-only` drops every expiry column. */
export function buildBookingWorkbook(opts: {
  vehicles: Vehicle[]
  docs: Pick<DocumentRecord, 'entity_id' | 'category' | 'superseded' | 'expiry_date'>[]
  cat: LicCat
  bookings: Record<string, Booking>
  branchLabel: string
  mode: BookingMode
  includeUnbooked?: boolean
  preparedBy?: string
  today?: Date
  logoBase64?: string
}): { wb: ExcelJS.Workbook; filename: string; rowCount: number } {
  const { cat, branchLabel, mode, preparedBy, logoBase64 } = opts
  const today = opts.today ?? new Date()
  const withExpiry = mode === 'with-expiry'
  const rows = buildBookingRows({ ...opts, includeUnbooked: withExpiry && opts.includeUnbooked })
  const stamp = today.toISOString().slice(0, 10)

  const headers = withExpiry
    ? ['#', 'Fleet No', 'Reg Plate', 'Make / Model', 'Current expiry', 'Days left', 'Status', 'Booked for', 'Booking', 'Notes']
    : ['#', 'Fleet No', 'Reg Plate', 'Make / Model', 'Booked for', 'Booking', 'Notes']
  const widths = withExpiry
    ? [5, 11, 14, 20, 14, 10, 22, 14, 13, 26]
    : [5, 11, 14, 22, 14, 13, 34]
  const lastCol = headers.length

  const wb = new ExcelJS.Workbook()
  wb.creator = 'INZU Workstation'
  const ws = wb.addWorksheet('Inspection booking', {
    views: [{ state: 'frozen', ySplit: 4 }],
    properties: { defaultRowHeight: 16 },
  })
  ws.columns = widths.map((width) => ({ width }))

  // Banner
  ws.getRow(1).height = logoBase64 ? 42 : 28
  ws.mergeCells(1, 1, 1, lastCol)
  const t = ws.getCell(1, 1)
  t.value = `${cat.label} Booking — ${branchLabel}`
  t.font = { name: 'Calibri', size: 14, bold: true, color: { argb: WHITE } }
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  t.alignment = { vertical: 'middle', horizontal: logoBase64 ? 'center' : 'left', indent: 1 }
  if (logoBase64) {
    const img = wb.addImage({ base64: logoBase64, extension: 'png' })
    ws.addImage(img, { tl: { col: 0.15, row: 0.12 }, ext: { width: 118, height: 40 } })
  }

  // Subtitle: what this is, who prepared it, and the window it covers.
  const booked = rows.filter((r) => r.bookedFor).map((r) => r.bookedFor).sort()
  const window = booked.length ? `${fmtDay(booked[0])} – ${fmtDay(booked[booked.length - 1])}` : 'no dates set yet'
  ws.mergeCells(2, 1, 2, lastCol)
  const s = ws.getCell(2, 1)
  s.value = `${rows.length} vehicle${rows.length === 1 ? '' : 's'} · proposed ${window} · prepared ${stamp}${preparedBy ? ` by ${preparedBy}` : ''} · INZU MCS Limited`
  s.font = { size: 9, color: { argb: MUTED } }
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(2).height = 15

  // A line of plain words, so the recipient knows what is being asked.
  ws.mergeCells(3, 1, 3, lastCol)
  const ask = ws.getCell(3, 1)
  ask.value = withExpiry
    ? 'These vehicles are due for inspection on the dates shown. Current expiry is included so both sides can align — please confirm or propose alternatives.'
    : 'Proposed inspection dates for the vehicles below — please confirm or propose alternatives.'
  ask.font = { size: 9, italic: true, color: { argb: 'FF25314A' } }
  ask.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: false }
  ws.getRow(3).height = 16

  // Header row
  ws.getRow(4).height = 18
  headers.forEach((h, i) => {
    const cell = ws.getCell(4, i + 1)
    cell.value = h
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } }
    cell.font = { size: 9, bold: true, color: { argb: NAVY } }
    cell.alignment = { vertical: 'middle', horizontal: i === 0 || i > 3 ? 'center' : 'left', indent: i === 0 || i > 3 ? 0 : 1 }
    cell.border = { ...BOX, bottom: { style: 'medium', color: { argb: NAVY } } }
  })
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: lastCol } }

  rows.forEach((r, ri) => {
    const rowNo = 5 + ri
    const values: (string | number | Date | null)[] = withExpiry
      ? [ri + 1, r.fleet, r.reg, r.make, r.expiry ? isoToDate(r.expiry) : null, r.days, r.docStatus, r.bookedFor ? isoToDate(r.bookedFor) : null, r.bookingStatus, r.note]
      : [ri + 1, r.fleet, r.reg, r.make, r.bookedFor ? isoToDate(r.bookedFor) : null, r.bookingStatus, r.note]
    values.forEach((v, i) => {
      const cell = ws.getCell(rowNo, i + 1)
      cell.value = v ?? '—'
      cell.border = BOX
      if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } }
      cell.font = { size: 10, color: { argb: 'FF25314A' } }
      cell.alignment = { vertical: 'middle', horizontal: i === 0 || i > 3 ? 'center' : 'left', indent: i === 0 || i > 3 ? 0 : 1 }
    })
    ws.getCell(rowNo, 2).font = { size: 10, bold: true, color: { argb: NAVY } }
    const bookedCol = withExpiry ? 8 : 5
    const bookedCell = ws.getCell(rowNo, bookedCol)
    if (r.bookedFor) {
      bookedCell.numFmt = 'ddd dd mmm yyyy'
      bookedCell.font = { size: 10, bold: true, color: { argb: NAVY } }
    } else {
      bookedCell.font = { size: 10, italic: true, color: { argb: MUTED } }
    }
    if (withExpiry) {
      const expCell = ws.getCell(rowNo, 5)
      if (r.expiry) expCell.numFmt = 'dd mmm yyyy'
      else expCell.font = { size: 10, color: { argb: MUTED } }
      const st = STATUS_STYLE[r.tone]
      const statusCell = ws.getCell(rowNo, 7)
      statusCell.font = { size: 10, bold: !!st.bold, color: { argb: st.color } }
      if (st.bg) statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.bg } }
    }
  })

  if (rows.length === 0) {
    ws.mergeCells(5, 1, 5, lastCol)
    const empty = ws.getCell(5, 1)
    empty.value = 'Nothing booked yet — set inspection dates in the Workstation, then export again.'
    empty.font = { size: 11, italic: true, color: { argb: MUTED } }
    empty.alignment = { vertical: 'middle', horizontal: 'center' }
    ws.getRow(5).height = 26
  }

  const kind = withExpiry ? 'with expiry' : 'schedule'
  return { wb, filename: `${cat.label} Booking - ${branchLabel} (${kind}) - ${stamp}.xlsx`, rowCount: rows.length }
}

/** Build and download the booking sheet. */
export async function exportBookingXlsx(opts: Parameters<typeof buildBookingWorkbook>[0]) {
  const logoBase64 = await fetchLogoBase64()
  const { wb, filename } = buildBookingWorkbook({ ...opts, logoBase64 })
  await downloadWorkbook(wb, filename)
}

/** Build and download — the browser-side entry point. */
export async function exportLicensingXlsx(opts: {
  vehicles: Vehicle[]
  docs: DocumentRecord[]
  cats: LicCat[]
  branchLabel: string
  scope?: LicFilter
}) {
  const logoBase64 = await fetchLogoBase64()
  const { wb, filename } = buildLicensingWorkbook({ ...opts, logoBase64 })
  await downloadWorkbook(wb, filename)
}
