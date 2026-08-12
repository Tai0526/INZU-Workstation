/**
 * A Word document, without a Word library.
 *
 * Word opens an HTML file that declares itself as a Word document and keeps the
 * styling, tables and embedded images intact — which is everything a report
 * needs, at none of the weight of a full .docx writer. The MSO block sets A4 and
 * the margins, so it prints on the paper people here actually use rather than
 * defaulting to US Letter.
 *
 * The point of a Word version is that it can be edited: management add a
 * paragraph, sign it off and send it on, without asking for the numbers again.
 */

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Line breaks typed into a note should survive into the document. */
export function nl2br(s: unknown): string {
  return escapeHtml(s).replace(/\n/g, '<br />')
}

const PAGE = { portrait: { w: '21cm', h: '29.7cm' }, landscape: { w: '29.7cm', h: '21cm' } }

export function wordDocument({ title, bodyHtml, landscape = false }: {
  title: string
  bodyHtml: string
  landscape?: boolean
}): string {
  const p = landscape ? PAGE.landscape : PAGE.portrait
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml>
<w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument>
</xml><![endif]-->
<style>
@page { size: ${p.w} ${p.h}; margin: 1.6cm 1.4cm; mso-page-orientation: ${landscape ? 'landscape' : 'portrait'}; }
body { font-family: Calibri, Arial, sans-serif; font-size: 10.5pt; color: #0F1B33; }
h1 { font-size: 19pt; margin: 0 0 2pt 0; color: #0F1B33; }
h2 { font-size: 13pt; margin: 20pt 0 4pt 0; color: #0F1B33; border-bottom: 1.5pt solid #D16B21; padding-bottom: 3pt; }
h3 { font-size: 11pt; margin: 12pt 0 3pt 0; color: #0F1B33; }
p { margin: 0 0 7pt 0; line-height: 1.4; }
.sub { color: #6B7280; font-size: 9.5pt; }
.verdict { font-size: 12pt; font-weight: bold; line-height: 1.45; margin: 8pt 0 12pt 0; }
.rule { border-top: 2pt solid #D16B21; margin: 6pt 0 12pt 0; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 10pt 0; font-size: 9.5pt; }
th { background: #0F1B33; color: #ffffff; text-align: left; padding: 5pt 6pt; font-weight: bold; }
td { border-bottom: 0.5pt solid #E6E8EC; padding: 4pt 6pt; vertical-align: top; }
tr.alt td { background: #F6F7F9; }
.num { text-align: right; }
.kpi { border: 0.5pt solid #E6E8EC; background: #F6F7F9; padding: 6pt 8pt; }
.kpi .k { font-size: 7.5pt; color: #6B7280; text-transform: uppercase; letter-spacing: .4pt; }
.kpi .v { font-size: 15pt; font-weight: bold; }
.kpi .s { font-size: 8pt; color: #6B7280; }
.caption { font-size: 8.5pt; color: #6B7280; margin: 2pt 0 10pt 0; font-style: italic; }
ul { margin: 0 0 10pt 0; padding-left: 16pt; }
li { margin-bottom: 4pt; line-height: 1.4; }
.good { color: #1B7F4B; font-weight: bold; }
.bad { color: #B3261E; font-weight: bold; }
.foot { color: #6B7280; font-size: 8.5pt; border-top: 0.5pt solid #E6E8EC; padding-top: 6pt; margin-top: 18pt; }
img { max-width: 100%; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`
}

export function downloadWordDoc(opts: { filename: string; title: string; bodyHtml: string; landscape?: boolean }) {
  const html = wordDocument(opts)
  // The BOM makes Word read it as UTF-8 rather than the system codepage, which
  // otherwise mangles the en-dashes and degree signs in the narrative.
  const blob = new Blob(['﻿', html], { type: 'application/msword;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.filename.endsWith('.doc') ? opts.filename : `${opts.filename}.doc`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
