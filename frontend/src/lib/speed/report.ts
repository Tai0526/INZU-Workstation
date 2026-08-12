import { downloadWordDoc, escapeHtml } from '@/lib/reports/word'

/**
 * One report, two formats.
 *
 * The speeding report is read on paper and in email, where nothing can be
 * hovered or clicked. So every chart in it carries its own figures and is
 * followed by the table it was drawn from, and every claim about progress is
 * written out with the numbers behind it — "down 34%, 84 events against 128"
 * rather than a line that happens to slope downwards.
 *
 * The model below is built once from what is on screen, then rendered to PDF
 * (fixed layout, for filing and signing) and to Word (editable, for management
 * to add their own paragraph before sending it on). Neither format re-derives
 * anything, so the two can never disagree.
 */

export interface ReportKpi {
  label: string
  value: string
  /** The comparison or the context — never left blank on a printed page. */
  sub: string
  tone?: 'good' | 'bad' | 'plain'
}

export interface ReportTable {
  title?: string
  note?: string
  head: string[]
  rows: (string | number)[][]
  /** Columns to right-align (0-based). Numbers should always be right-aligned. */
  numeric?: number[]
}

export interface ReportChart {
  title: string
  /** What the picture says, in words, with the figures in it. */
  caption: string
  dataUrl: string
  w: number
  h: number
  /** The numbers the chart was drawn from — the whole point on a static page. */
  table?: ReportTable
}

export interface ReportSection {
  title: string
  intro?: string
  charts?: ReportChart[]
  tables?: ReportTable[]
  bullets?: string[]
  /** Shown instead of the content when there is nothing to report. */
  empty?: string
}

export interface SpeedReport {
  branchLabel: string
  periodLabel: string
  comparison: boolean
  generated: string
  /** "Speeding down 34%" — the answer, before any detail. */
  headline: string
  headlineTone: 'good' | 'bad' | 'plain'
  /** A paragraph a manager can read aloud. */
  verdict: string
  /** What has changed, each line carrying its own numbers. */
  progress: string[]
  kpis: ReportKpi[]
  sections: ReportSection[]
  /** Filename without an extension. */
  filename: string
}

// ── Small helpers the page and both renderers share ────────────────────

export const pct = (now: number, before: number) =>
  before > 0 ? Math.round(((now - before) / before) * 100) : now > 0 ? 100 : 0

/** "down 34% (84 against 128)" — a change nobody has to work out. */
export function movement(now: number, before: number, unit = ''): string {
  const u = unit ? ` ${unit}` : ''
  if (before === now) return `unchanged at ${now}${u}`
  const p = Math.abs(pct(now, before))
  const dir = now < before ? 'down' : 'up'
  return `${dir} ${p}% (${now}${u} against ${before}${u})`
}

// ── Word ───────────────────────────────────────────────────────────────

function tableHtml(t: ReportTable): string {
  const num = new Set(t.numeric ?? [])
  const head = t.head.map((h, i) => `<th${num.has(i) ? ' class="num"' : ''}>${escapeHtml(h)}</th>`).join('')
  const body = t.rows.map((r, ri) => `<tr${ri % 2 ? ' class="alt"' : ''}>${
    r.map((c, i) => `<td${num.has(i) ? ' class="num"' : ''}>${escapeHtml(c).replace(/\n/g, '<br />')}</td>`).join('')
  }</tr>`).join('')
  return `${t.title ? `<h3>${escapeHtml(t.title)}</h3>` : ''}<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${t.head.length}">Nothing to report.</td></tr>`}</tbody></table>${t.note ? `<p class="caption">${escapeHtml(t.note)}</p>` : ''}`
}

function sectionHtml(s: ReportSection): string {
  const parts: string[] = [`<h2>${escapeHtml(s.title)}</h2>`]
  if (s.intro) parts.push(`<p>${escapeHtml(s.intro)}</p>`)
  const hasContent = (s.charts?.length ?? 0) + (s.tables?.length ?? 0) + (s.bullets?.length ?? 0) > 0
  if (!hasContent && s.empty) parts.push(`<p class="sub">${escapeHtml(s.empty)}</p>`)
  for (const c of s.charts ?? []) {
    parts.push(`<h3>${escapeHtml(c.title)}</h3>`)
    if (c.dataUrl) parts.push(`<p><img src="${c.dataUrl}" width="${Math.round(Math.min(680, c.w))}" /></p>`)
    parts.push(`<p class="caption">${escapeHtml(c.caption)}</p>`)
    if (c.table) parts.push(tableHtml(c.table))
  }
  for (const t of s.tables ?? []) parts.push(tableHtml(t))
  if (s.bullets?.length) parts.push(`<ul>${s.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`)
  return parts.join('\n')
}

/** The document body — pure, so it can be rendered and checked without a browser. */
export function renderReportHtml(r: SpeedReport): string {
  const kpiCells = r.kpis.map((k) => `<td class="kpi" width="${Math.floor(100 / Math.min(3, r.kpis.length))}%">
    <div class="k">${escapeHtml(k.label)}</div>
    <div class="v${k.tone === 'good' ? ' good' : k.tone === 'bad' ? ' bad' : ''}">${escapeHtml(k.value)}</div>
    <div class="s">${escapeHtml(k.sub)}</div></td>`)
  const kpiRows: string[] = []
  for (let i = 0; i < kpiCells.length; i += 3) kpiRows.push(`<tr>${kpiCells.slice(i, i + 3).join('')}</tr>`)

  return `
<h1>Speeding Performance Report</h1>
<p class="sub">${escapeHtml(r.branchLabel)} &middot; ${escapeHtml(r.periodLabel)} &middot; generated ${escapeHtml(r.generated)}</p>
<div class="rule"></div>

<p class="verdict ${r.headlineTone === 'good' ? 'good' : r.headlineTone === 'bad' ? 'bad' : ''}">${escapeHtml(r.headline)}</p>
<p>${escapeHtml(r.verdict)}</p>

<table style="margin-top:8pt">${kpiRows.join('')}</table>

<h2>What has changed</h2>
<ul>${r.progress.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>

${r.sections.map(sectionHtml).join('\n')}

<p class="foot">INZU MCS Limited &middot; Speeding performance report &middot; ${escapeHtml(r.branchLabel)} &middot; ${escapeHtml(r.periodLabel)}.
Figures exclude GPS faults (readings a governed bus cannot reach). Charges are raised once per journey: a run that crossed the limit
several times is one offence, with the other readings kept as evidence.</p>`
}

export function exportSpeedWord(r: SpeedReport) {
  downloadWordDoc({
    filename: r.filename,
    title: `Speeding Report — ${r.branchLabel} ${r.periodLabel}`,
    bodyHtml: renderReportHtml(r),
  })
}
