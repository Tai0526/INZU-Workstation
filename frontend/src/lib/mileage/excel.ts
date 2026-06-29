import * as XLSX from 'xlsx'
import * as XS from 'xlsx-js-style'
import type { BranchCode } from '@/lib/roles'
import {
  type MileageTrip, type MileageTripInput, type MileageSummary, type MileageRates, type Signatories,
  type SeatClass, type Shift, SEAT_CLASSES, SEAT_LABEL, SHIFTS, classFromCapacity, rateFor, vehicleSheet, summarise,
} from './types'

const r2 = (n: number) => Math.round(n * 100) / 100

// ── Date parsing (Excel serials, d-mmm-yy, dd/mm/yyyy) ─────────────────
function parseDate(v: any): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(v).trim()
  // 2026-06-01
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  // dd/mm/yyyy
  m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/)
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  // 1-Jun-26
  m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2,4})$/)
  if (m) {
    const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase()) + 1
    if (mo) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  }
  return null
}

function normSeat(v: any): SeatClass {
  const s = String(v ?? '').replace(/[^0-9]/g, '')
  if (SEAT_CLASSES.includes(s as SeatClass)) return s as SeatClass
  return classFromCapacity(Number(s) || null)
}
function normShift(v: any): Shift {
  const s = String(v ?? '').trim().toLowerCase()
  const found = SHIFTS.find((x) => x.toLowerCase() === s)
  return found ?? 'Morning'
}

export interface TripImport { valid: MileageTripInput[]; errors: { row: number; reason: string }[] }

/** Parse a bulk-upload sheet of trips. Columns by header (order-independent). */
export async function parseTrips(file: File, branch: BranchCode, project: string): Promise<TripImport> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: '' })
  const valid: MileageTripInput[] = []
  const errors: { row: number; reason: string }[] = []
  const pick = (row: any, ...keys: string[]) => {
    const lk = Object.keys(row).find((k) => keys.some((want) => k.toLowerCase().trim() === want))
    return lk ? row[lk] : ''
  }
  rows.forEach((row, i) => {
    const date = parseDate(pick(row, 'date'))
    const fleet = String(pick(row, 'fleet no', 'fleet', 'fleet_no') ?? '').trim()
    if (!date || !fleet) { errors.push({ row: i + 2, reason: 'Missing date or fleet no' }); return }
    valid.push({
      branch, project, date, fleet_no: fleet,
      vehicle_reg: String(pick(row, 'reg', 'reg no', 'vehicle reg', 'reg_no') ?? '').trim(),
      seat_class: normSeat(pick(row, 'seat class', 'class', 'seat', 'seat_class')),
      shift: normShift(pick(row, 'shift')),
      route: String(pick(row, 'route') ?? '').trim(),
      internal_km: Number(pick(row, 'internal km', 'internal', 'internal_km')) || 0,
      external_km: Number(pick(row, 'external km', 'external', 'external_km')) || 0,
    })
  })
  return { valid, errors }
}

export function downloadTripTemplate() {
  const rows = [
    { Date: '2026-06-01', 'Fleet No': 'INZ 121', Reg: 'BCG 4271', 'Seat Class': '40', Shift: 'Morning', Route: 'Resettlement - Housing/Housing', 'Internal km': 64, 'External km': 18 },
    { Date: '2026-06-01', 'Fleet No': 'INZ 121', Reg: 'BCG 4271', 'Seat Class': '40', Shift: 'Evening', Route: 'Resettlement - Housing', 'Internal km': 64, 'External km': 28 },
  ]
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Trips')
  XLSX.writeFile(wb, 'Mileage upload template.xlsx')
}

/** Export the day-by-day trips currently shown (flat log). */
export function exportTrips(trips: MileageTrip[], project: string) {
  const rows = trips.map((t) => ({
    Date: t.date, 'Fleet No': t.fleet_no, Reg: t.vehicle_reg, 'Seat Class': SEAT_LABEL[t.seat_class],
    Shift: t.shift, Route: t.route, 'Internal km': t.internal_km, 'External km': t.external_km, 'Total km': t.internal_km + t.external_km,
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Trips')
  XLSX.writeFile(wb, `Mileage log - ${project}.xlsx`)
}

// ── Workbook styling (xlsx-js-style) — branded, presentable for stakeholders ──
const CLR = { navy: '0F1B33', brand: 'D16B21', tint: 'F8E7D7', grey: 'EEF1F5', zebra: 'F7F8FA', border: 'D7DBE3', white: 'FFFFFF', text: '0F1B33' }
const FMT = { km: '#,##0', usd: '"$"#,##0.00', rate: '"$"#,##0.0000', int: '#,##0' }
const BD = { style: 'thin', color: { rgb: CLR.border } }
const ALL_BD = { top: BD, bottom: BD, left: BD, right: BD }
const baseFont = { name: 'Calibri', sz: 10, color: { rgb: CLR.text } }
const ST = {
  title: { font: { name: 'Calibri', sz: 14, bold: true, color: { rgb: CLR.white } }, fill: { fgColor: { rgb: CLR.navy } }, alignment: { horizontal: 'left', vertical: 'center' } },
  subtitle: { font: { name: 'Calibri', sz: 10, italic: true, color: { rgb: CLR.white } }, fill: { fgColor: { rgb: CLR.brand } }, alignment: { horizontal: 'left', vertical: 'center' } },
  section: { font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: CLR.navy } }, fill: { fgColor: { rgb: CLR.grey } }, alignment: { horizontal: 'left', vertical: 'center' } },
  header: { font: { ...baseFont, bold: true, color: { rgb: CLR.white } }, fill: { fgColor: { rgb: CLR.navy } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: ALL_BD },
  label: { font: { ...baseFont, bold: true }, fill: { fgColor: { rgb: CLR.grey } }, alignment: { horizontal: 'left', vertical: 'center' }, border: ALL_BD },
  totalLabel: { font: { ...baseFont, bold: true }, fill: { fgColor: { rgb: CLR.tint } }, alignment: { horizontal: 'left', vertical: 'center' }, border: ALL_BD },
  left: { font: baseFont, alignment: { horizontal: 'left', vertical: 'center' }, border: ALL_BD },
  center: { font: baseFont, alignment: { horizontal: 'center', vertical: 'center' }, border: ALL_BD },
  tint: { font: baseFont, fill: { fgColor: { rgb: CLR.tint } }, border: ALL_BD },
  orgL: { font: { ...baseFont, bold: true, sz: 11, color: { rgb: CLR.brand } } },
  sigLbl: { font: { ...baseFont, bold: true } },
  sigName: { font: baseFont },
}
const numCell = (fmt: string) => ({ font: baseFont, alignment: { horizontal: 'right', vertical: 'center' }, border: ALL_BD, numFmt: fmt })
const totCell = (fmt: string) => ({ font: { ...baseFont, bold: true }, fill: { fgColor: { rgb: CLR.tint } }, alignment: { horizontal: 'right', vertical: 'center' }, border: ALL_BD, numFmt: fmt })
function put(ws: any, r: number, c: number, s: any) {
  const addr = XS.utils.encode_cell({ r, c })
  if (!ws[addr]) ws[addr] = { t: 's', v: '' }
  ws[addr].s = s
}
const span = (ws: any, r: number, c0: number, c1: number, s: any) => { for (let c = c0; c <= c1; c++) put(ws, r, c, s) }

// ── Full reconciliation workbook (summary + per-vehicle sheets) ────────
export function exportWorkbook(opts: {
  trips: MileageTrip[]
  rates: MileageRates
  signatories: Signatories
  project: string
  monthLabel: string
  branchShort: string
}) {
  const { trips, rates, signatories: sig, project, monthLabel, branchShort } = opts
  const summary = summarise(trips, rates)
  const wb = XS.utils.book_new()

  const classLabels = summary.classes.map((c) => SEAT_LABEL[c.seat_class])
  const vatLabel = `VAT @${summary.vat_pct}%`
  const nC = summary.classes.length
  const kmCols = summary.hasInternal ? 2 : 1
  const csW = 1 + nC + 3 // class summary width

  const A: any[][] = []
  const ix: Record<string, number> = {}
  const at = () => A.length - 1

  A.push([`INZU Route & Kilometre Reconciliation — ${project} — ${monthLabel}`]); ix.title = at()
  A.push([`Billed to FQM ${branchShort}  ·  all amounts in USD  ·  generated ${new Date().toLocaleDateString()}`]); ix.sub = at()
  A.push([])

  // ── Class summary ──
  A.push(['', ...classLabels, 'Sub-Total', vatLabel, 'Total (VAT incl)']); ix.csHead = at()
  A.push(['QTY (buses)', ...summary.classes.map((c) => c.qty)]); ix.csQty = at()
  const extSub = r2(summary.classes.reduce((s, c) => s + c.external_amt, 0))
  const extVat = r2(extSub * (summary.vat_pct / 100))
  const intSub = r2(summary.classes.reduce((s, c) => s + c.internal_amt, 0))
  const intVat = r2(intSub * (summary.vat_pct / 100))
  A.push(['External mileage (km)', ...summary.classes.map((c) => c.external_km)]); ix.csExtKm = at()
  A.push(['External amount (USD)', ...summary.classes.map((c) => r2(c.external_amt)), extSub, extVat, r2(extSub + extVat)]); ix.csExtAmt = at()
  if (summary.hasInternal) {
    A.push(['Internal mileage (km)', ...summary.classes.map((c) => c.internal_km)]); ix.csIntKm = at()
    A.push(['Internal amount (USD)', ...summary.classes.map((c) => r2(c.internal_amt)), intSub, intVat, r2(intSub + intVat)]); ix.csIntAmt = at()
  }
  A.push(['Grand total (USD)', ...summary.classes.map(() => ''), r2(summary.subtotal), r2(summary.vat), r2(summary.total)]); ix.csGrand = at()
  A.push([])

  // ── Contract rates ──
  A.push(['Contract rates (USD/km)']); ix.ratesTitle = at()
  A.push(['Seat class', 'Rate (USD/km)']); ix.ratesHead = at()
  ix.ratesStart = A.length
  summary.classes.forEach((c) => A.push([SEAT_LABEL[c.seat_class], rateFor(rates, c.seat_class)]))
  ix.ratesEnd = at()
  A.push([])

  // ── Daily claimable & cost by bus class ──
  A.push(['Daily claimable & cost by bus class']); ix.dcTitle = at()
  const dcHead: any[] = ['Date']
  summary.classes.forEach((c) => { if (summary.hasInternal) dcHead.push(`${SEAT_LABEL[c.seat_class]} Int`, `${SEAT_LABEL[c.seat_class]} Ext`); else dcHead.push(`${SEAT_LABEL[c.seat_class]} Ext`) })
  dcHead.push('Claimable km')
  summary.classes.forEach((c) => dcHead.push(`${SEAT_LABEL[c.seat_class]} (USD)`))
  dcHead.push('Day Total (USD)')
  A.push(dcHead); ix.dcHead = at()
  ix.dcStart = A.length
  summary.dailyByClass.forEach((row) => {
    const r: any[] = [row.date]
    summary.classes.forEach((c) => { const cell = row.byClass[c.seat_class]; if (summary.hasInternal) r.push(cell?.internal ?? 0, cell?.external ?? 0); else r.push(cell?.external ?? 0) })
    r.push(row.claimable)
    summary.classes.forEach((c) => r.push(r2(row.byClass[c.seat_class]?.amount ?? 0)))
    r.push(r2(row.amount))
    A.push(r)
  })
  ix.dcEnd = at()
  const dcTot: any[] = ['Month Total']
  summary.classes.forEach((c) => { if (summary.hasInternal) dcTot.push(c.internal_km, c.external_km); else dcTot.push(c.external_km) })
  dcTot.push(summary.total_km)
  summary.classes.forEach((c) => dcTot.push(r2(c.subtotal)))
  dcTot.push(r2(summary.subtotal))
  A.push(dcTot); ix.dcTot = at()
  const dcW = dcHead.length
  A.push([])

  // ── Daily mileage by bus ──
  const fleetCols = summary.fleets.map((f) => f.fleet_no)
  const gridW = 1 + fleetCols.length + 4
  A.push(['Daily mileage by bus']); ix.gridTitle = at()
  A.push(['Date', ...fleetCols, 'Internal', 'External', 'Claimable km', 'Amount (USD)']); ix.gridHead = at()
  ix.gridStart = A.length
  summary.days.forEach((d) => A.push([d.date, ...fleetCols.map((f) => d.perFleet[f] ?? 0), d.internal, d.external, d.claimable, r2(d.amount)]))
  ix.gridEnd = at()
  const fleetTotals = fleetCols.map((f) => summary.days.reduce((s, d) => s + (d.perFleet[f] ?? 0), 0))
  A.push(['Total', ...fleetTotals, summary.internal_km, summary.external_km, summary.total_km, r2(summary.subtotal)]); ix.gridTot = at()
  A.push([])

  // ── Signatures ──
  A.push(['Authorisation']); ix.sigTitle = at()
  A.push(['INZU MCS Limited', '', '', `FQM ${branchShort}`]); ix.sigOrg = at()
  A.push(['Prepared By', sig.inzu_prepared, '', 'Checked By', sig.fqm_checked]); ix.sig1 = at()
  A.push(['Checked By', sig.inzu_checked, '', 'Approved By', sig.fqm_approved]); ix.sig2 = at()
  A.push(['Authorised By', sig.inzu_authorised]); ix.sig3 = at()
  A.push(['Approved By', sig.inzu_approved]); ix.sig4 = at()

  const maxCols = Math.max(csW, dcW, gridW, 5)
  const ws: any = XS.utils.aoa_to_sheet(A)
  ws['!ref'] = XS.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: A.length - 1, c: maxCols - 1 } })
  ws['!cols'] = Array.from({ length: maxCols }, (_, c) => ({ wch: c === 0 ? 26 : 13 }))
  ws['!rows'] = []; ws['!rows'][ix.title] = { hpt: 26 }; ws['!rows'][ix.sub] = { hpt: 18 }
  const mrg = (r: number) => ({ s: { r, c: 0 }, e: { r, c: maxCols - 1 } })
  ws['!merges'] = [mrg(ix.title), mrg(ix.sub), mrg(ix.ratesTitle), mrg(ix.dcTitle), mrg(ix.gridTitle), mrg(ix.sigTitle)]

  // Banner + section bands
  span(ws, ix.title, 0, maxCols - 1, ST.title)
  span(ws, ix.sub, 0, maxCols - 1, ST.subtitle)
  ;[ix.ratesTitle, ix.dcTitle, ix.gridTitle, ix.sigTitle].forEach((r) => span(ws, r, 0, maxCols - 1, ST.section))

  // Class summary
  span(ws, ix.csHead, 0, csW - 1, ST.header)
  const csKm = [ix.csExtKm, ...(summary.hasInternal ? [ix.csIntKm] : [])]
  const csAmt = [ix.csExtAmt, ...(summary.hasInternal ? [ix.csIntAmt] : [])]
  put(ws, ix.csQty, 0, ST.label); span(ws, ix.csQty, 1, nC, numCell(FMT.int))
  csKm.forEach((r) => { put(ws, r, 0, ST.label); span(ws, r, 1, nC, numCell(FMT.km)) })
  csAmt.forEach((r) => { put(ws, r, 0, ST.label); span(ws, r, 1, csW - 1, numCell(FMT.usd)) })
  put(ws, ix.csGrand, 0, ST.totalLabel); span(ws, ix.csGrand, 1, nC, ST.tint); span(ws, ix.csGrand, nC + 1, csW - 1, totCell(FMT.usd))

  // Contract rates
  span(ws, ix.ratesHead, 0, 1, ST.header)
  for (let r = ix.ratesStart; r <= ix.ratesEnd; r++) { put(ws, r, 0, ST.label); put(ws, r, 1, numCell(FMT.rate)) }

  // Daily-by-class column bands
  const kmC0 = 1, kmC1 = nC * kmCols, claimC = kmC1 + 1, usdC0 = claimC + 1, usdC1 = usdC0 + nC - 1, dayC = dcW - 1
  span(ws, ix.dcHead, 0, dcW - 1, ST.header)
  for (let r = ix.dcStart; r <= ix.dcEnd; r++) {
    put(ws, r, 0, ST.center); span(ws, r, kmC0, kmC1, numCell(FMT.km)); put(ws, r, claimC, numCell(FMT.km)); span(ws, r, usdC0, usdC1, numCell(FMT.usd)); put(ws, r, dayC, numCell(FMT.usd))
  }
  put(ws, ix.dcTot, 0, ST.totalLabel); span(ws, ix.dcTot, kmC0, claimC, totCell(FMT.km)); span(ws, ix.dcTot, usdC0, dayC, totCell(FMT.usd))

  // Daily grid column bands
  const nF = fleetCols.length, gInt = 1 + nF, gExt = gInt + 1, gClaim = gExt + 1, gAmt = gridW - 1
  span(ws, ix.gridHead, 0, gridW - 1, ST.header)
  for (let r = ix.gridStart; r <= ix.gridEnd; r++) {
    put(ws, r, 0, ST.center); span(ws, r, 1, gClaim, numCell(FMT.km)); put(ws, r, gAmt, numCell(FMT.usd))
  }
  put(ws, ix.gridTot, 0, ST.totalLabel); span(ws, ix.gridTot, 1, gClaim, totCell(FMT.km)); put(ws, ix.gridTot, gAmt, totCell(FMT.usd))

  // Signatures
  put(ws, ix.sigOrg, 0, ST.orgL); put(ws, ix.sigOrg, 3, ST.orgL)
  ;[ix.sig1, ix.sig2, ix.sig3, ix.sig4].forEach((r) => { put(ws, r, 0, ST.sigLbl); put(ws, r, 1, ST.sigName); put(ws, r, 3, ST.sigLbl); put(ws, r, 4, ST.sigName) })

  XS.utils.book_append_sheet(wb, ws, 'Summary')

  // ── Per-vehicle movement sheets ──
  summary.fleets.forEach((f) => {
    const sheet = vehicleSheet(trips, f.fleet_no)
    const vW = 1 + SHIFTS.length * 3 + 1
    const V: any[][] = []
    V.push([`${f.fleet_no} — ${f.vehicle_reg} · ${SEAT_LABEL[f.seat_class]} · ${project}`])
    V.push(['Internal Total', sheet.internal, 'External Total', sheet.external, 'Combined Total', sheet.total])
    V.push([])
    const head: any[] = ['Date']
    SHIFTS.forEach((s) => head.push(`${s} Route`, `${s} Int`, `${s} Ext`))
    head.push('Daily Total')
    V.push(head)
    const vDataStart = V.length
    sheet.days.forEach((d) => {
      const row: any[] = [d.date]
      SHIFTS.forEach((s) => { const x = d.shifts[s]; row.push(x?.route ?? '', x?.internal ?? '', x?.external ?? '') })
      row.push(d.total)
      V.push(row)
    })
    const vDataEnd = V.length - 1
    const totRow: any[] = ['Total']; for (let i = 1; i < vW - 1; i++) totRow.push(''); totRow.push(sheet.total)
    V.push(totRow); const vTot = V.length - 1

    const vws: any = XS.utils.aoa_to_sheet(V)
    vws['!ref'] = XS.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: V.length - 1, c: vW - 1 } })
    vws['!cols'] = [{ wch: 12 }, ...SHIFTS.flatMap(() => [{ wch: 22 }, { wch: 7 }, { wch: 7 }]), { wch: 12 }]
    vws['!rows'] = []; vws['!rows'][0] = { hpt: 20 }
    vws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: vW - 1 } }]
    span(vws, 0, 0, vW - 1, ST.title)
    // KPI line: label / value pairs
    ;[0, 2, 4].forEach((c) => { put(vws, 1, c, ST.label) })
    put(vws, 1, 1, numCell(FMT.km)); put(vws, 1, 3, numCell(FMT.km)); put(vws, 1, 5, totCell(FMT.km))
    span(vws, 3, 0, vW - 1, ST.header)
    for (let r = vDataStart; r <= vDataEnd; r++) {
      put(vws, r, 0, ST.center)
      SHIFTS.forEach((_s, si) => { const base = 1 + si * 3; put(vws, r, base, ST.left); put(vws, r, base + 1, numCell(FMT.km)); put(vws, r, base + 2, numCell(FMT.km)) })
      put(vws, r, vW - 1, numCell(FMT.km))
    }
    put(vws, vTot, 0, ST.totalLabel); span(vws, vTot, 1, vW - 2, ST.tint); put(vws, vTot, vW - 1, totCell(FMT.km))

    const name = f.fleet_no.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
    XS.utils.book_append_sheet(wb, vws, name)
  })

  XS.writeFile(wb, `Mileage Report - ${project} (${monthLabel}).xlsx`)
}

/** Fetch an asset and turn it into a data URL so it survives the detached print window. */
async function toDataURL(url: string): Promise<string> {
  try {
    const res = await fetch(url)
    if (!res.ok) return ''
    const blob = await res.blob()
    return await new Promise<string>((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => resolve('')
      fr.readAsDataURL(blob)
    })
  } catch { return '' }
}

/** Build a print-ready HTML document for the summary and open the print dialog (Save as PDF). */
export async function printSummaryPDF(opts: {
  summary: MileageSummary
  signatories: Signatories
  project: string
  monthLabel: string
  branchShort: string
}) {
  const { summary, signatories: sig, project, monthLabel, branchShort } = opts
  // Open the window synchronously (inside the click) so it isn't blocked, then fetch logos.
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) { alert('Allow pop-ups to export the PDF summary.'); return }
  const origin = window.location.origin
  const [inzuLogo, fqmLogo] = await Promise.all([toDataURL(`${origin}/logo.png`), toDataURL(`${origin}/FQM%20LOGO.png`)])
  const money = (n: number) => `$${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const classCols = summary.classes
  const kmCols = summary.hasInternal ? 2 : 1
  const totalCols = 1 + classCols.length * kmCols + 1 + classCols.length + 1

  // One combined invoice table: daily detail → monthly totals (qty, mileage,
  // cost per class) → VAT → grand total.
  const headCells = ['<th>Date</th>']
  classCols.forEach((c) => { if (summary.hasInternal) headCells.push(`<th>${SEAT_LABEL[c.seat_class]} Int</th>`, '<th>Ext</th>'); else headCells.push(`<th>${SEAT_LABEL[c.seat_class]} Ext</th>`) })
  headCells.push('<th>Claimable km</th>')
  classCols.forEach((c) => headCells.push(`<th>${SEAT_LABEL[c.seat_class]} (USD)</th>`))
  headCells.push('<th>Day Total</th>')

  const qtyCells = ['<td class="lbl">Buses (qty)</td>']
  classCols.forEach((c) => qtyCells.push(`<td colspan="${kmCols}">${c.qty}</td>`))
  qtyCells.push('<td></td>')
  classCols.forEach(() => qtyCells.push('<td></td>'))
  qtyCells.push('<td></td>')

  const body = summary.dailyByClass.map((row) => {
    const cells = [`<td class="lbl">${row.date}</td>`]
    classCols.forEach((c) => { const cell = row.byClass[c.seat_class]; if (summary.hasInternal) cells.push(`<td>${cell?.internal || ''}</td>`, `<td>${cell?.external || ''}</td>`); else cells.push(`<td>${cell?.external || ''}</td>`) })
    cells.push(`<td>${row.claimable.toLocaleString()}</td>`)
    classCols.forEach((c) => cells.push(`<td>${money(row.byClass[c.seat_class]?.amount ?? 0)}</td>`))
    cells.push(`<td>${money(row.amount)}</td>`)
    return `<tr>${cells.join('')}</tr>`
  }).join('')

  const totCells = ['<td class="lbl">Month Total</td>']
  classCols.forEach((c) => { if (summary.hasInternal) totCells.push(`<td>${c.internal_km.toLocaleString()}</td>`, `<td>${c.external_km.toLocaleString()}</td>`); else totCells.push(`<td>${c.external_km.toLocaleString()}</td>`) })
  totCells.push(`<td>${summary.total_km.toLocaleString()}</td>`)
  classCols.forEach((c) => totCells.push(`<td>${money(c.subtotal)}</td>`))
  totCells.push(`<td>${money(summary.subtotal)}</td>`)

  const subRow = `<tr class="sumline"><td class="lbl" colspan="${totalCols - 1}">Sub-Total</td><td>${money(summary.subtotal)}</td></tr>`
  const vatRow = `<tr class="sumline"><td class="lbl" colspan="${totalCols - 1}">VAT @${summary.vat_pct}%</td><td>${money(summary.vat)}</td></tr>`
  const totalRow = `<tr class="grand"><td class="lbl" colspan="${totalCols - 1}">Total (VAT inclusive)</td><td>${money(summary.total)}</td></tr>`

  const invoiceTable = `<table class="daily">
    <tr>${headCells.join('')}</tr>
    <tr class="sub">${qtyCells.join('')}</tr>
    ${body}
    <tr class="sub">${totCells.join('')}</tr>
    ${subRow}${vatRow}${totalRow}
  </table>`

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Mileage Reconciliation — ${project} — ${monthLabel}</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;color:#0F1B33;margin:0;}
    /* Laid out at the landscape printable width; scaled to one page on load. */
    #sheet{width:1062px;}
    h1{font-size:15px;margin:0;} .subt{color:#6B7280;font-size:10px;margin:3px 0 0;}
    table{border-collapse:collapse;width:100%;}
    th,td{border:1px solid #d0d4dc;padding:2px 5px;text-align:right;font-size:10px;line-height:1.25;}
    th{background:#0F1B33;color:#fff;font-weight:600;}
    td.lbl{text-align:left;font-weight:600;background:#f6f7f9;}
    tr.grand td{background:#F8E7D7;font-weight:700;}
    tr.sub td{background:#eef0f3;font-weight:600;}
    tr.sumline td{font-weight:600;}
    .head{display:flex;align-items:center;gap:14px;border-bottom:2px solid #0F1B33;padding-bottom:8px;margin-bottom:10px;}
    .head img{max-height:44px;max-width:150px;object-fit:contain;}
    .sig{display:flex;justify-content:space-between;font-size:11px;margin-top:12px;}
    .sig .col.right{text-align:right;}
    .sig img{max-height:26px;max-width:100px;object-fit:contain;display:block;margin-bottom:4px;}
    .sig .col.right img{margin-left:auto;}
    .sig h3{font-size:11px;margin:0 0 8px;color:#D16B21;text-transform:uppercase;letter-spacing:.04em;}
    .sig .line{margin-bottom:12px;} .sig .name{font-weight:600;}
    .muted{color:#6B7280;font-size:9px;margin-top:8px;}
    @page{size:A4 landscape;margin:8mm;}
  </style></head><body>
    <div id="sheet">
      <div class="head">
        ${inzuLogo ? `<img src="${inzuLogo}" alt="INZU MCS Limited">` : ''}
        <div>
          <h1>INZU Route &amp; Kilometer Reconciliation</h1>
          <p class="subt">${project} Project · ${monthLabel} · Billed to FQM ${branchShort} · all amounts in USD</p>
        </div>
      </div>
      ${invoiceTable}
      <div class="sig">
        <div class="col">
          ${inzuLogo ? `<img src="${inzuLogo}" alt="INZU">` : ''}
          <h3>INZU MCS Limited</h3>
          <div class="line">Prepared By: <span class="name">${sig.inzu_prepared || '&nbsp;'}</span></div>
          <div class="line">Checked By: <span class="name">${sig.inzu_checked || '&nbsp;'}</span></div>
          <div class="line">Authorised By: <span class="name">${sig.inzu_authorised || '&nbsp;'}</span></div>
          <div class="line">Approved By: <span class="name">${sig.inzu_approved || '&nbsp;'}</span></div>
        </div>
        <div class="col right">
          ${fqmLogo ? `<img src="${fqmLogo}" alt="FQM">` : ''}
          <h3>FQM ${branchShort}</h3>
          <div class="line">Checked By: <span class="name">${sig.fqm_checked || '&nbsp;'}</span></div>
          <div class="line">Approved By: <span class="name">${sig.fqm_approved || '&nbsp;'}</span></div>
        </div>
      </div>
      <p class="muted">Generated by INZU Workstation · ${new Date().toLocaleString()}</p>
    </div>
    <script>
      window.addEventListener('load', function () {
        var s = document.getElementById('sheet')
        // Scale down (Chrome 'zoom' affects pagination) so everything fits one page.
        var z = Math.min(1, 1062 / s.scrollWidth, 728 / s.scrollHeight)
        if (z < 1) document.body.style.zoom = String(z)
        setTimeout(function () { window.print() }, 80)
      })
    </script>
  </body></html>`

  w.document.open(); w.document.write(html); w.document.close()
}
