import * as XLSX from 'xlsx'
import { isCompliantCell, type Credential, type ComplianceClass, type CellState } from './registers'

// Excel export of Driver Compliance for stakeholders. Three sheets:
//  • Matrix   — drivers × selected classes, each cell a plain status word (mirrors
//               the on-screen grid), plus each driver's score.
//  • Details  — one row per driver × class (filtered to the chosen statuses), with
//               dates, expiry, days left, where it was done, proof and notes.
//  • Summary  — per-class counts + % compliant across the exported drivers.
// The caller decides which classes and which cell statuses to include.

const STATE_LABEL: Record<CellState, string> = {
  current: 'Current', expiring: 'Expiring soon', expired: 'Expired', not_done: 'Not done', locked: 'Locked',
}

function daysLeft(expiry: string): number | '' {
  if (!expiry) return ''
  const today = new Date().toISOString().slice(0, 10)
  const ms = new Date(`${expiry}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()
  return Math.round(ms / 86_400_000)
}

/** Unique, readable column header per class (disambiguates duplicate short names). */
function classHeaders(classes: ComplianceClass[]): Record<string, string> {
  const seen = new Set<string>(); const out: Record<string, string> = {}
  for (const c of classes) {
    let h = c.short || c.label
    while (seen.has(h)) h = `${h} ·`
    seen.add(h); out[c.key] = h
  }
  return out
}

/** Size each column to its widest cell (capped), so the sheet is readable as sent. */
function autoWidth(ws: XLSX.WorkSheet) {
  const ref = ws['!ref']; if (!ref) return
  const range = XLSX.utils.decode_range(ref)
  const cols: { wch: number }[] = []
  for (let C = range.s.c; C <= range.e.c; C++) {
    let w = 8
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
      if (cell && cell.v != null) w = Math.max(w, String(cell.v).length + 2)
    }
    cols.push({ wch: Math.min(42, w) })
  }
  ws['!cols'] = cols
}

export interface ExportDriver { id: string; full_name: string; employee_no: string; status: string }
export interface ExportCell { cls: ComplianceClass; state: CellState; cred?: Credential }
export interface ExportRow { driver: ExportDriver; cells: ExportCell[] }

export function exportCompliance(opts: {
  branchLabel: string
  rows: ExportRow[]
  classes: ComplianceClass[]      // the classes chosen for export (columns / scope)
  includeStates: Set<CellState>   // which cell statuses appear in the Details sheet
}) {
  const { branchLabel, rows, classes, includeStates } = opts
  const today = new Date().toISOString().slice(0, 10)
  const headers = classHeaders(classes)
  const wb = XLSX.utils.book_new()

  // ── Matrix ──
  const matrix = rows.map((r) => {
    const done = r.cells.filter((c) => isCompliantCell(c.state)).length
    const rec: Record<string, string | number> = {
      Driver: r.driver.full_name,
      'Employee No': r.driver.employee_no,
      'Driver status': r.driver.status,
      Score: `${done}/${classes.length}`,
      'Compliant %': classes.length ? Math.round((done / classes.length) * 100) : 0,
    }
    r.cells.forEach((c) => { rec[headers[c.cls.key]] = STATE_LABEL[c.state] })
    return rec
  })
  const wsM = XLSX.utils.json_to_sheet(matrix.length ? matrix : [{ Driver: 'No drivers in this selection' }])
  autoWidth(wsM)
  XLSX.utils.book_append_sheet(wb, wsM, 'Matrix')

  // ── Details (filtered to the chosen statuses) ──
  const details: Record<string, string | number>[] = []
  for (const r of rows) {
    for (const c of r.cells) {
      if (!includeStates.has(c.state)) continue
      details.push({
        Driver: r.driver.full_name,
        'Employee No': r.driver.employee_no,
        Class: c.cls.label,
        Prerequisite: c.cls.prerequisite ? 'Yes' : '',
        Status: STATE_LABEL[c.state],
        'Date done': c.cred?.issued || '',
        Expires: c.cls.has_expiry ? (c.cred?.expiry || '') : 'n/a',
        'Days left': c.cls.has_expiry ? daysLeft(c.cred?.expiry || '') : '',
        'Where done': c.cred?.location || '',
        Proof: c.cred?.cert_file ? c.cred.cert_file.file_name : (c.cls.requires_attachment ? 'MISSING' : ''),
        Notes: c.cred?.notes || '',
      })
    }
  }
  const wsD = XLSX.utils.json_to_sheet(details.length ? details : [{ Driver: 'No records match the chosen statuses', Class: '', Status: '' }])
  autoWidth(wsD)
  XLSX.utils.book_append_sheet(wb, wsD, 'Details')

  // ── Summary (per class) ──
  const summary = classes.map((cls) => {
    const states = rows.map((r) => r.cells.find((c) => c.cls.key === cls.key)!.state)
    const n = (s: CellState) => states.filter((x) => x === s).length
    const compliant = states.filter((s) => isCompliantCell(s)).length
    return {
      Class: cls.label,
      Prerequisite: cls.prerequisite ? 'Yes' : '',
      Current: n('current'),
      'Expiring soon': n('expiring'),
      Expired: n('expired'),
      'Not done': n('not_done'),
      Locked: n('locked'),
      'Compliant %': rows.length ? Math.round((compliant / rows.length) * 100) : 0,
    }
  })
  const wsS = XLSX.utils.json_to_sheet(summary.length ? summary : [{ Class: 'No classes selected' }])
  autoWidth(wsS)
  XLSX.utils.book_append_sheet(wb, wsS, 'Summary')

  const safe = branchLabel.replace(/\s+/g, '_')
  XLSX.writeFile(wb, `INZU_Driver_Compliance_${safe}_${today}.xlsx`)
}
