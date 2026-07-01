import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * Stakeholder-facing speeding report: headline verdict, KPIs, the on-screen
 * charts (rasterised from their SVG), plus hotspot and offender tables. Built so
 * a manager or client can tell at a glance whether we're improving.
 */

const NAVY: [number, number, number] = [15, 27, 51]
const BRAND: [number, number, number] = [209, 107, 33]
const MUTE: [number, number, number] = [107, 114, 128]
const LINE: [number, number, number] = [230, 232, 236]
const TINT: [number, number, number] = [246, 247, 249]

/** Rasterise a recharts <svg> to a PNG data URL (charts are pure vector, so this
 *  is reliable and needs no html2canvas). Returns null if it can't be drawn. */
export async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const rect = svg.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height))
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('width', String(w)); clone.setAttribute('height', String(h))
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const xml = new XMLSerializer().serializeToString(clone)
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
    const img = new Image()
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('svg load')); img.src = url })
    const canvas = document.createElement('canvas')
    canvas.width = w * scale; canvas.height = h * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, w, h)
    return { dataUrl: canvas.toDataURL('image/png'), w, h }
  } catch { return null }
}

export interface SpeedPdfChart { title: string; dataUrl: string; w: number; h: number }
export interface SpeedPdfInput {
  branchLabel: string
  periodLabel: string
  generated: string
  verdict: string
  kpis: { label: string; value: string; sub?: string }[]
  charts: SpeedPdfChart[]
  hotspots: { name: string; count: number; buses: number; avgOver: number }[]
  offenders: { name: string; count: number }[]
  suggestions: string[]
  filename: string
}

export function exportSpeedPdf(input: SpeedPdfInput) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const M = 40
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  let y = 48

  const ensure = (need: number) => { if (y + need > pageH - M) { doc.addPage(); y = 52 } }

  // ── Header ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...NAVY)
  doc.text('Speeding Performance Report', M, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTE)
  doc.text(`${input.branchLabel} · ${input.periodLabel}`, M, y + 16)
  doc.text(`Generated ${input.generated}`, pageW - M, y + 16, { align: 'right' })
  y += 26
  doc.setDrawColor(...BRAND); doc.setLineWidth(1.4); doc.line(M, y, pageW - M, y); y += 20

  // ── Verdict ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...NAVY)
  const verdict = doc.splitTextToSize(input.verdict, pageW - 2 * M)
  doc.text(verdict, M, y); y += verdict.length * 15 + 10

  // ── KPI cards (3 per row) ──
  const gap = 10, cols = 3
  const cardW = (pageW - 2 * M - gap * (cols - 1)) / cols
  const cardH = 42
  input.kpis.forEach((k, i) => {
    const col = i % cols
    if (col === 0) { ensure(cardH + gap); if (i > 0) y += cardH + gap }
    const x = M + col * (cardW + gap)
    doc.setFillColor(...TINT); doc.setDrawColor(...LINE); doc.setLineWidth(0.5)
    doc.roundedRect(x, y, cardW, cardH, 4, 4, 'FD')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTE)
    doc.text(k.label.toUpperCase(), x + 8, y + 13)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...NAVY)
    doc.text(String(k.value), x + 8, y + 29)
    if (k.sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTE); doc.text(k.sub, x + 8, y + 38) }
  })
  y += cardH + 18

  // ── Charts (full width, 1 per row) ──
  for (const c of input.charts) {
    const dispW = pageW - 2 * M
    const dispH = Math.min(230, dispW * (c.h / c.w))
    ensure(dispH + 22)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY)
    doc.text(c.title, M, y); y += 8
    try { doc.addImage(c.dataUrl, 'PNG', M, y, dispW, dispH) } catch { /* skip a bad image */ }
    y += dispH + 16
  }

  // ── Hotspots table ──
  if (input.hotspots.length) {
    ensure(60)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY)
    doc.text('Where it happens — top hotspots', M, y); y += 6
    autoTable(doc, {
      startY: y + 6,
      head: [['Location', 'Events', 'Buses', 'Avg over (km/h)']],
      body: input.hotspots.map((h) => [h.name, h.count, h.buses, `+${h.avgOver}`]),
      styles: { fontSize: 9, cellPadding: 4, textColor: NAVY, lineColor: LINE, lineWidth: 0.5 },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: TINT },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: M, right: M },
    })
    // @ts-expect-error lastAutoTable is added by the plugin
    y = (doc.lastAutoTable.finalY as number) + 16
  }

  // ── Repeat offenders ──
  if (input.offenders.length) {
    ensure(60)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY)
    doc.text('Repeat offenders', M, y); y += 6
    autoTable(doc, {
      startY: y + 6,
      head: [['#', 'Driver', 'Confirmed events']],
      body: input.offenders.map((o, i) => [i + 1, o.name, o.count]),
      styles: { fontSize: 9, cellPadding: 4, textColor: NAVY, lineColor: LINE, lineWidth: 0.5 },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: TINT },
      columnStyles: { 0: { cellWidth: 24, halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: M, right: M },
    })
    // @ts-expect-error lastAutoTable is added by the plugin
    y = (doc.lastAutoTable.finalY as number) + 16
  }

  // ── Suggestions ──
  if (input.suggestions.length) {
    ensure(40 + input.suggestions.length * 14)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY)
    doc.text('Recommended actions', M, y); y += 14
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...NAVY)
    for (const s of input.suggestions) {
      const lines = doc.splitTextToSize(`•  ${s}`, pageW - 2 * M - 6)
      ensure(lines.length * 12 + 4)
      doc.text(lines, M + 4, y); y += lines.length * 12 + 4
    }
  }

  // ── Footer page numbers ──
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTE)
    doc.text(`INZU MCS — Speeding report · page ${i} of ${pages}`, M, pageH - 20)
  }

  doc.save(input.filename.endsWith('.pdf') ? input.filename : `${input.filename}.pdf`)
}
