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

export function buildTablePdf(opts: { title: string; subtitle?: string; tables: PdfTable[]; landscape?: boolean }): jsPDF {
  const doc = new jsPDF({ orientation: opts.landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const M = 40
  doc.setFontSize(14); doc.setTextColor(15, 27, 51); doc.text(opts.title, M, 46)
  let startY = 62
  if (opts.subtitle) { doc.setFontSize(10); doc.setTextColor(107, 114, 128); doc.text(opts.subtitle, M, 62); startY = 80 }
  for (const t of opts.tables) {
    if (t.heading) { doc.setFontSize(11); doc.setTextColor(15, 27, 51); doc.text(t.heading, M, startY); startY += 6 }
    autoTable(doc, {
      startY: startY + 6,
      head: [t.head],
      body: t.rows.map((r) => r.map((c) => String(c))),
      styles: { fontSize: 9, cellPadding: 4, textColor: [15, 27, 51] },
      headStyles: { fillColor: [15, 27, 51], textColor: 255, fontStyle: 'bold' },
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
export function downloadTablePdf(opts: { title: string; subtitle?: string; tables: PdfTable[]; landscape?: boolean; filename: string }) {
  buildTablePdf(opts).save(opts.filename.endsWith('.pdf') ? opts.filename : `${opts.filename}.pdf`)
}
