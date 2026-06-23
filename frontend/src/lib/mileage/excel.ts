import * as XLSX from 'xlsx'
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
  const wb = XLSX.utils.book_new()

  // ── Summary sheet ──
  const A: any[][] = []
  A.push([`INZU Route and Kilometer Reconciliation — ${project} Project — ${monthLabel}`])
  A.push([`Billed to FQM ${branchShort} · all amounts in USD`])
  A.push([])

  const classLabels = summary.classes.map((c) => SEAT_LABEL[c.seat_class])
  const vatLabel = `VAT @${summary.vat_pct}%`
  A.push(['', ...classLabels, 'Sub-Total', vatLabel, 'Total (VAT incl)'])
  A.push(['QTY (buses)', ...summary.classes.map((c) => c.qty)])

  const extSub = r2(summary.classes.reduce((s, c) => s + c.external_amt, 0))
  const extVat = r2(extSub * (summary.vat_pct / 100))
  const intSub = r2(summary.classes.reduce((s, c) => s + c.internal_amt, 0))
  const intVat = r2(intSub * (summary.vat_pct / 100))

  A.push(['External mileage (km)', ...summary.classes.map((c) => c.external_km)])
  A.push(['External amount (USD)', ...summary.classes.map((c) => r2(c.external_amt)), extSub, extVat, r2(extSub + extVat)])
  if (summary.hasInternal) {
    A.push(['Internal mileage (km)', ...summary.classes.map((c) => c.internal_km)])
    A.push(['Internal amount (USD)', ...summary.classes.map((c) => r2(c.internal_amt)), intSub, intVat, r2(intSub + intVat)])
  }
  A.push(['Grand total (USD)', ...summary.classes.map(() => ''), r2(summary.subtotal), r2(summary.vat), r2(summary.total)])
  A.push([])

  // Contract rates
  A.push(['Contract rates (USD/km)'])
  summary.classes.forEach((c) => A.push([SEAT_LABEL[c.seat_class], rateFor(rates, c.seat_class)]))
  A.push([])

  // Daily breakdown by bus class — mileage + costed amount per class, per day
  A.push(['Daily claimable & cost by bus class'])
  const dcHead: any[] = ['Date']
  summary.classes.forEach((c) => { if (summary.hasInternal) dcHead.push(`${SEAT_LABEL[c.seat_class]} Int`, `${SEAT_LABEL[c.seat_class]} Ext`); else dcHead.push(`${SEAT_LABEL[c.seat_class]} Ext`) })
  dcHead.push('Claimable km')
  summary.classes.forEach((c) => dcHead.push(`${SEAT_LABEL[c.seat_class]} (USD)`))
  dcHead.push('Day Total (USD)')
  A.push(dcHead)
  summary.dailyByClass.forEach((row) => {
    const r: any[] = [row.date]
    summary.classes.forEach((c) => { const cell = row.byClass[c.seat_class]; if (summary.hasInternal) r.push(cell?.internal ?? 0, cell?.external ?? 0); else r.push(cell?.external ?? 0) })
    r.push(row.claimable)
    summary.classes.forEach((c) => r.push(r2(row.byClass[c.seat_class]?.amount ?? 0)))
    r.push(r2(row.amount))
    A.push(r)
  })
  const dcTot: any[] = ['Month Total']
  summary.classes.forEach((c) => { if (summary.hasInternal) dcTot.push(c.internal_km, c.external_km); else dcTot.push(c.external_km) })
  dcTot.push(summary.total_km)
  summary.classes.forEach((c) => dcTot.push(r2(c.subtotal)))
  dcTot.push(r2(summary.subtotal))
  A.push(dcTot)
  A.push([])

  // Daily grid
  const fleetCols = summary.fleets.map((f) => f.fleet_no)
  A.push(['Date', ...fleetCols, 'Internal', 'External', 'Claimable km', 'Amount (USD)'])
  summary.days.forEach((d) => {
    A.push([d.date, ...fleetCols.map((f) => d.perFleet[f] ?? 0), d.internal, d.external, d.claimable, r2(d.amount)])
  })
  const fleetTotals = fleetCols.map((f) => summary.days.reduce((s, d) => s + (d.perFleet[f] ?? 0), 0))
  A.push(['Total', ...fleetTotals, summary.internal_km, summary.external_km, summary.total_km, r2(summary.subtotal)])
  A.push([])

  // Signatures
  A.push([`INZU MCS Limited`, '', '', `FQM ${branchShort}`])
  A.push(['Prepared By', sig.inzu_prepared, '', 'Checked By', sig.fqm_checked])
  A.push(['Checked By', sig.inzu_checked, '', 'Approved By', sig.fqm_approved])
  A.push(['Authorised By', sig.inzu_authorised])
  A.push(['Approved By', sig.inzu_approved])

  const ws = XLSX.utils.aoa_to_sheet(A)
  ws['!cols'] = [{ wch: 26 }, ...fleetCols.map(() => ({ wch: 11 })), { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Summary')

  // ── Per-vehicle movement sheets ──
  summary.fleets.forEach((f) => {
    const sheet = vehicleSheet(trips, f.fleet_no)
    const V: any[][] = []
    V.push([`${f.fleet_no} — ${f.vehicle_reg}`, `${SEAT_LABEL[f.seat_class]}`, project])
    V.push(['Internal Total', sheet.internal, 'External Total', sheet.external, 'Combined Total', sheet.total])
    V.push([])
    const head: any[] = ['Date']
    SHIFTS.forEach((s) => head.push(`${s} Route`, `${s} Int`, `${s} Ext`))
    head.push('Daily Total')
    V.push(head)
    sheet.days.forEach((d) => {
      const row: any[] = [d.date]
      SHIFTS.forEach((s) => { const x = d.shifts[s]; row.push(x?.route ?? '', x?.internal ?? '', x?.external ?? '') })
      row.push(d.total)
      V.push(row)
    })
    V.push(['Total', '', '', '', '', '', '', '', '', '', '', '', sheet.total])
    const vws = XLSX.utils.aoa_to_sheet(V)
    vws['!cols'] = [{ wch: 12 }, ...SHIFTS.flatMap(() => [{ wch: 22 }, { wch: 7 }, { wch: 7 }]), { wch: 11 }]
    // sheet name max 31 chars, no special chars
    const name = f.fleet_no.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, vws, name)
  })

  XLSX.writeFile(wb, `Mileage Report - ${project} (${monthLabel}).xlsx`)
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
