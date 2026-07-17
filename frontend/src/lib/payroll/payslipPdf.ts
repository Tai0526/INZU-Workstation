import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { payslipHtml, PAYSLIP_PREVIEW_CSS, type Payslip, type PayslipTemplate } from './payslip'

/**
 * A payslip as a real PDF file — needed to attach one to an email (the print-window
 * export produces no file). It renders the SAME HTML the on-screen preview and the
 * PDF/Word exports use, so there is only ever one payslip layout to maintain.
 *
 * Optionally encrypted: emailed payslips carry salary, NRC and bank details, so a
 * misdirected message would otherwise expose them. jsPDF's encryption is RC4 — it
 * stops a wrong recipient reading the file, not a determined attacker.
 */

const A4 = { w: 210, h: 297 }
const MARGIN = 8

/** Render a payslip off-screen, rasterise it, and wrap it in an A4 PDF. */
export async function payslipPdfBlob(
  slip: Payslip,
  template: PayslipTemplate,
  opts: { logo?: string; password?: string } = {},
): Promise<Blob> {
  // 794px ≈ A4 width at 96dpi, so the layout rasterises at its intended proportions.
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;padding:24px;'
  host.innerHTML = `<style>${PAYSLIP_PREVIEW_CSS}</style><div class="pv">${payslipHtml(slip, template, { logo: opts.logo })}</div>`
  document.body.appendChild(host)

  try {
    const canvas = await html2canvas(host, { scale: 2, backgroundColor: '#ffffff', windowWidth: 794, logging: false, useCORS: true })
    const pdf = new jsPDF({
      orientation: 'portrait', unit: 'mm', format: 'a4', compress: true,
      ...(opts.password ? { encryption: { userPassword: opts.password, ownerPassword: `${opts.password}-inzu`, userPermissions: ['print', 'copy'] } } : {}),
    })
    // JPEG at 92% — a payslip is text on white, so it stays crisp at a fraction of
    // PNG's size, which matters when 40 of them go out as email attachments.
    const img = canvas.toDataURL('image/jpeg', 0.92)
    const w = A4.w - MARGIN * 2
    const h = Math.min((canvas.height * w) / canvas.width, A4.h - MARGIN * 2)
    pdf.addImage(img, 'JPEG', MARGIN, MARGIN, w, h)
    return pdf.output('blob')
  } finally {
    host.remove()
  }
}

/** Base64 (no data: prefix) — what the send-payslips function expects for an attachment. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  // Chunked: String.fromCharCode(...huge) blows the call stack on a ~400 kB file.
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  return btoa(bin)
}

export const payslipFileName = (slip: Payslip): string =>
  `INZU_Payslip_${slip.name.replace(/[^a-z0-9]+/gi, '_')}_${slip.month}.pdf`
