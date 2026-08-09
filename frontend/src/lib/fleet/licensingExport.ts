import * as XLSX from 'xlsx'
import type { Vehicle } from '@/lib/fleet/types'
import { daysUntil, type DocumentRecord } from '@/lib/documents/types'
import type { LicCat } from '@/lib/documents/licensingConfig'

/**
 * Licensing expiry spreadsheet — current Road Tax / Insurance / Fitness /
 * FQM Inspection (any mix, incl. custom categories) per vehicle, with the
 * expiry date, days left and a plain-words status. One glance answers
 * "what do we need to renew, and by when".
 */

export interface LicExportRow {
  fleet: string
  reg: string
  make: string
  cells: { expiry: string; days: number | null; status: string }[]
}

/** Plain-words status for one vehicle × category. Pure — unit-tested. */
export function cellStatus(expiry: string | undefined, required: boolean, today = new Date()): { expiry: string; days: number | null; status: string } {
  if (!expiry) return { expiry: '', days: null, status: required ? 'MISSING' : 'Not on file' }
  const days = daysUntil(expiry, today)
  if (days === null) return { expiry, days: null, status: 'No expiry date' }
  if (days < 0) return { expiry, days, status: `EXPIRED ${-days} day${days === -1 ? '' : 's'} ago` }
  if (days === 0) return { expiry, days, status: 'Expires TODAY' }
  if (days <= 30) return { expiry, days, status: `Expiring in ${days} day${days === 1 ? '' : 's'}` }
  return { expiry, days, status: 'Valid' }
}

/** Rows for the sheet: every branch vehicle × the chosen categories. Pure. */
export function buildLicensingRows(
  vehicles: Vehicle[],
  docs: Pick<DocumentRecord, 'entity_id' | 'category' | 'superseded' | 'expiry_date'>[],
  cats: LicCat[],
  today = new Date(),
): LicExportRow[] {
  return [...vehicles]
    .sort((a, b) => a.fleet_no.localeCompare(b.fleet_no, undefined, { numeric: true }))
    .map((v) => ({
      fleet: v.fleet_no,
      reg: v.reg_plate,
      make: [v.make, v.model].filter(Boolean).join(' '),
      cells: cats.map((cat) => {
        const cur = docs.find((d) => d.entity_id === v.id && d.category === cat.key && !d.superseded)
        return cellStatus(cur?.expiry_date, cat.required, today)
      }),
    }))
}

export function exportLicensingXlsx(opts: {
  vehicles: Vehicle[]
  docs: DocumentRecord[]
  cats: LicCat[] // the categories chosen in the export dialog
  branchLabel: string
}) {
  const { vehicles, docs, cats, branchLabel } = opts
  const today = new Date()
  const rows = buildLicensingRows(vehicles, docs, cats, today)
  const stamp = today.toISOString().slice(0, 10)

  // Header: two rows — category band, then the field names under each.
  const head1 = ['Fleet No', 'Reg Plate', 'Make / Model', ...cats.flatMap((c) => [c.label, '', ''])]
  const head2 = ['', '', '', ...cats.flatMap(() => ['Expiry date', 'Days left', 'Status'])]
  const body = rows.map((r) => [r.fleet, r.reg, r.make, ...r.cells.flatMap((c) => [c.expiry || '—', c.days ?? '—', c.status])])

  const aoa: (string | number)[][] = [
    [`Vehicle Licensing — ${branchLabel}`],
    [`Generated ${stamp} · ${rows.length} vehicles · categories: ${cats.map((c) => c.short).join(', ')}`],
    [],
    head1,
    head2,
    ...body,
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Merge the title lines and each category band across its 3 columns.
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 + cats.length * 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 + cats.length * 3 } },
    ...cats.map((_, i) => ({ s: { r: 3, c: 3 + i * 3 }, e: { r: 3, c: 5 + i * 3 } })),
  ]
  ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 18 }, ...cats.flatMap(() => [{ wch: 12 }, { wch: 9 }, { wch: 20 }])]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Licensing')
  XLSX.writeFile(wb, `Licensing Expiry - ${branchLabel} - ${stamp}.xlsx`)
}
