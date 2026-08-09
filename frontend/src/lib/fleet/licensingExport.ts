import ExcelJS from 'exceljs'
import type { Vehicle } from '@/lib/fleet/types'
import { daysUntil, type DocumentRecord } from '@/lib/documents/types'
import type { LicCat } from '@/lib/documents/licensingConfig'

/**
 * Licensing expiry spreadsheet — current Road Tax / Insurance / Fitness /
 * FQM Inspection (any mix, incl. custom categories) per vehicle, with the
 * expiry date, days left and a plain-words status. One glance answers
 * "what do we need to renew, and by when".
 *
 * Styled with the INZU palette (exceljs — the community `xlsx` can't style):
 * navy title bar, navy category bands, light header row, real Excel dates,
 * status colours, frozen header + fleet columns, and a filter row.
 */

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

export type CellTone = 'valid' | 'expiring' | 'today' | 'expired' | 'missing' | 'quiet' | 'nodate'

export interface LicExportRow {
  fleet: string
  reg: string
  make: string
  cells: { expiry: string; days: number | null; status: string; tone: CellTone }[]
}

/** Plain-words status for one vehicle × category. Pure — unit-tested. */
export function cellStatus(expiry: string | undefined, required: boolean, today = new Date()): LicExportRow['cells'][number] {
  if (!expiry) return { expiry: '', days: null, status: required ? 'MISSING' : 'Not on file', tone: required ? 'missing' : 'quiet' }
  const days = daysUntil(expiry, today)
  if (days === null) return { expiry, days: null, status: 'No expiry date', tone: 'nodate' }
  if (days < 0) return { expiry, days, status: `EXPIRED ${-days} day${days === -1 ? '' : 's'} ago`, tone: 'expired' }
  if (days === 0) return { expiry, days, status: 'Expires TODAY', tone: 'today' }
  if (days <= 30) return { expiry, days, status: `Expiring in ${days} day${days === 1 ? '' : 's'}`, tone: 'expiring' }
  return { expiry, days, status: 'Valid', tone: 'valid' }
}

/** Rows for the sheet: every branch vehicle × the chosen categories. Pure. */
export function buildLicensingRows(
  vehicles: Vehicle[],
  docs: Pick<DocumentRecord, 'entity_id' | 'category' | 'superseded' | 'expiry_date'>[],
  cats: LicCat[],
  today = new Date(),
): LicExportRow[] {
  return [...vehicles]
    .sort((a, b) => a.fleet_no.localeCompare(b.fleet_no, undefined, { numeric: true }))
    .map((v) => ({
      fleet: v.fleet_no,
      reg: v.reg_plate,
      make: [v.make, v.model].filter(Boolean).join(' '),
      cells: cats.map((cat) => {
        const cur = docs.find((d) => d.entity_id === v.id && d.category === cat.key && !d.superseded)
        return cellStatus(cur?.expiry_date, cat.required, today)
      }),
    }))
}

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

/** Build the styled workbook. Separate from the download so tests can reopen it. */
export function buildLicensingWorkbook(opts: {
  vehicles: Vehicle[]
  docs: Pick<DocumentRecord, 'entity_id' | 'category' | 'superseded' | 'expiry_date'>[]
  cats: LicCat[]
  branchLabel: string
  today?: Date
  /** Company logo (PNG, base64 without the data: prefix) — sits in the navy title bar. */
  logoBase64?: string
}): { wb: ExcelJS.Workbook; filename: string } {
  const { vehicles, docs, cats, branchLabel, logoBase64 } = opts
  const today = opts.today ?? new Date()
  const rows = buildLicensingRows(vehicles, docs, cats, today)
  const stamp = today.toISOString().slice(0, 10)
  const lastCol = 3 + cats.length * 3

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
  t.value = `Vehicle Licensing — ${branchLabel}`
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
  s.value = `Generated ${stamp} · ${rows.length} vehicle${rows.length === 1 ? '' : 's'} · ${cats.map((c) => c.short).join(' · ')}`
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

  return { wb, filename: `Licensing Expiry - ${branchLabel} - ${stamp}.xlsx` }
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

/** Build and download — the browser-side entry point. */
export async function exportLicensingXlsx(opts: {
  vehicles: Vehicle[]
  docs: DocumentRecord[]
  cats: LicCat[]
  branchLabel: string
}) {
  const logoBase64 = await fetchLogoBase64()
  const { wb, filename } = buildLicensingWorkbook({ ...opts, logoBase64 })
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
