import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { SpeedReport, ReportSection, ReportTable } from './report'

/**
 * The speeding report as a fixed-layout PDF — for filing, signing and sending
 * to the client. It renders the same model as the Word version (see ./report),
 * so the two can never disagree, and it prints every chart with the table it
 * was drawn from: on paper nothing can be hovered, so the numbers have to be
 * on the page.
 */

const NAVY: [number, number, number] = [15, 27, 51]
const BRAND: [number, number, number] = [209, 107, 33]
const MUTE: [number, number, number] = [107, 114, 128]
const LINE: [number, number, number] = [230, 232, 236]
const TINT: [number, number, number] = [246, 247, 249]
const GOOD: [number, number, number] = [27, 127, 75]
const BAD: [number, number, number] = [179, 38, 30]

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

export function exportSpeedPdf(r: SpeedReport) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const M = 40
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  let y = 48

  const ensure = (need: number) => { if (y + need > pageH - M - 14) { doc.addPage(); y = 52 } }
  const para = (text: string, size: number, colour: [number, number, number], bold = false, gap = 10) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...colour)
    const lines = doc.splitTextToSize(text, pageW - 2 * M)
    ensure(lines.length * (size + 3) + gap)
    doc.text(lines, M, y)
    y += lines.length * (size + 3) + gap
  }
  const bullets = (items: string[], size = 9.5) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...NAVY)
    for (const s of items) {
      const lines = doc.splitTextToSize(`•  ${s}`, pageW - 2 * M - 6)
      ensure(lines.length * (size + 3) + 4)
      doc.text(lines, M + 4, y)
      y += lines.length * (size + 3) + 4
    }
    y += 6
  }
  const heading = (text: string) => {
    ensure(34)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...NAVY)
    doc.text(text, M, y); y += 5
    doc.setDrawColor(...BRAND); doc.setLineWidth(1); doc.line(M, y, pageW - M, y); y += 14
  }
  const subheading = (text: string) => {
    ensure(24)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY)
    doc.text(text, M, y); y += 12
  }
  const table = (t: ReportTable) => {
    if (t.title) subheading(t.title)
    const numeric = new Set(t.numeric ?? [])
    const columnStyles: Record<number, { halign: 'right' }> = {}
    for (const i of numeric) columnStyles[i] = { halign: 'right' }
    ensure(60)
    autoTable(doc, {
      startY: y,
      head: [t.head],
      body: t.rows.length ? t.rows.map((row) => row.map((c) => String(c))) : [t.head.map(() => '—')],
      styles: { fontSize: 8.5, cellPadding: 3.5, textColor: NAVY, lineColor: LINE, lineWidth: 0.5, overflow: 'linebreak' },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
      alternateRowStyles: { fillColor: TINT },
      columnStyles,
      margin: { left: M, right: M },
    })
    // @ts-expect-error lastAutoTable is added by the plugin
    y = (doc.lastAutoTable.finalY as number) + 8
    if (t.note) { doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(...MUTE)
      const lines = doc.splitTextToSize(t.note, pageW - 2 * M)
      doc.text(lines, M, y); y += lines.length * 10 + 6 }
  }

  // ── Header ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...NAVY)
  doc.text('Speeding Performance Report', M, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTE)
  doc.text(`${r.branchLabel}  ·  ${r.periodLabel}`, M, y + 15)
  doc.text(`Generated ${r.generated}`, pageW - M, y + 15, { align: 'right' })
  y += 25
  doc.setDrawColor(...BRAND); doc.setLineWidth(1.6); doc.line(M, y, pageW - M, y); y += 22

  // ── The answer, then the paragraph behind it ──
  para(r.headline, 15, r.headlineTone === 'good' ? GOOD : r.headlineTone === 'bad' ? BAD : NAVY, true, 8)
  para(r.verdict, 10, NAVY, false, 14)

  // ── KPI cards (3 per row) ──
  const gap = 10, cols = 3
  const cardW = (pageW - 2 * M - gap * (cols - 1)) / cols
  const cardH = 46
  r.kpis.forEach((k, i) => {
    const col = i % cols
    if (col === 0) { ensure(cardH + gap); if (i > 0) y += cardH + gap }
    const x = M + col * (cardW + gap)
    doc.setFillColor(...TINT); doc.setDrawColor(...LINE); doc.setLineWidth(0.5)
    doc.roundedRect(x, y, cardW, cardH, 4, 4, 'FD')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTE)
    doc.text(k.label.toUpperCase(), x + 8, y + 13)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
    doc.setTextColor(...(k.tone === 'good' ? GOOD : k.tone === 'bad' ? BAD : NAVY))
    doc.text(String(k.value), x + 8, y + 29)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...MUTE)
    doc.text(doc.splitTextToSize(k.sub, cardW - 14).slice(0, 2), x + 8, y + 39)
  })
  y += cardH + 20

  // ── What has changed ──
  heading('What has changed')
  bullets(r.progress, 10)

  // ── Sections ──
  for (const s of r.sections) {
    renderSection(s)
  }

  function renderSection(s: ReportSection) {
    heading(s.title)
    if (s.intro) para(s.intro, 9.5, MUTE, false, 8)
    const hasContent = (s.charts?.length ?? 0) + (s.tables?.length ?? 0) + (s.bullets?.length ?? 0) > 0
    if (!hasContent) { if (s.empty) para(s.empty, 9.5, MUTE, false, 8); return }
    for (const c of s.charts ?? []) {
      if (c.dataUrl) {
        const dispW = pageW - 2 * M
        const dispH = Math.min(210, dispW * (c.h / c.w))
        ensure(dispH + 34)
        subheading(c.title)
        try { doc.addImage(c.dataUrl, 'PNG', M, y, dispW, dispH) } catch { /* skip a bad image */ }
        y += dispH + 8
      } else {
        subheading(c.title)
      }
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...MUTE)
      const cap = doc.splitTextToSize(c.caption, pageW - 2 * M)
      ensure(cap.length * 10 + 8)
      doc.text(cap, M, y); y += cap.length * 10 + 10
      if (c.table) table(c.table)
    }
    for (const t of s.tables ?? []) table(t)
    if (s.bullets?.length) bullets(s.bullets)
  }

  // ── Footer ──
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTE)
    doc.text(`INZU MCS — Speeding report · ${r.branchLabel} · ${r.periodLabel}`, M, pageH - 22)
    doc.text(`Page ${i} of ${pages}`, pageW - M, pageH - 22, { align: 'right' })
  }

  doc.save(`${r.filename}.pdf`)
}
