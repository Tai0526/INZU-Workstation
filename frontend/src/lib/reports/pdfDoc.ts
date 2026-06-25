import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * Generate a real PDF *file* (Blob) from headed tables — used where we need an
 * attachable document (e.g. emailing the daily bus allocation). For on-screen
 * "print to PDF" reports we still use the print window in exporter.ts.
 */
export interface PdfColStyle {
  halign?: 'left' | 'center' | 'right'
  cellWidth?: number
  fontStyle?: 'normal' | 'bold'
}
export interface PdfTable {
  heading?: string
  head: string[]
  rows: (string | number)[][]
  /** Optional per-column styling (keyed by column index). */
  columnStyles?: Record<number, PdfColStyle>
}

export function buildTablePdf(opts: { title: string; subtitle?: string; tables: PdfTable[]; landscape?: boolean; dense?: boolean }): jsPDF {
  const doc = new jsPDF({ orientation: opts.landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const M = 40
  const pageW = doc.internal.pageSize.getWidth()
  // ── Clean header: bold title, muted subtitle, a thin rule ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(15, 27, 51)
  doc.text(opts.title, M, 48)
  let headBottom = 56
  if (opts.subtitle) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(107, 114, 128)
    doc.text(opts.subtitle, M, 64)
    headBottom = 74
  }
  doc.setDrawColor(209, 107, 33); doc.setLineWidth(1.2) // brand rule
  doc.line(M, headBottom, pageW - M, headBottom)
  let startY = headBottom + 14

  const fontSize = opts.dense ? 8 : 9
  const cellPadding = opts.dense ? 3 : 4
  for (const t of opts.tables) {
    if (t.heading) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(15, 27, 51); doc.text(t.heading, M, startY); startY += 4 }
    autoTable(doc, {
      startY: startY + 6,
      head: [t.head],
      body: t.rows.map((r) => r.map((c) => String(c))),
      styles: { fontSize, cellPadding, textColor: [15, 27, 51], valign: 'top', lineColor: [230, 232, 236], lineWidth: 0.5 },
      headStyles: { fillColor: [15, 27, 51], textColor: 255, fontStyle: 'bold', halign: 'left' },
      alternateRowStyles: { fillColor: [246, 247, 249] },
      columnStyles: t.columnStyles as never,
      margin: { left: M, right: M },
    })
    // @ts-expect-error lastAutoTable is added by the plugin
    startY = (doc.lastAutoTable.finalY as number) + 18
  }
  return doc
}

/** Download the PDF to the user's machine. */
export function downloadTablePdf(opts: { title: string; subtitle?: string; tables: PdfTable[]; landscape?: boolean; dense?: boolean; filename: string }) {
  buildTablePdf(opts).save(opts.filename.endsWith('.pdf') ? opts.filename : `${opts.filename}.pdf`)
}
