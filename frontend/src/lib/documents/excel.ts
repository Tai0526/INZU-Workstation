import * as XLSX from 'xlsx'
import { BRANCHES } from '@/lib/roles'
import {
  type DocumentRecord, docStatus, DOC_STATUS_META, APPROVAL_STATUS_META,
  approvalOf, typeLabelOf, displayNameOf, departmentOf,
} from './types'

const today = () => new Date().toISOString().slice(0, 10)
const branchShort = (d: DocumentRecord) =>
  d.all_branches ? 'Company-wide' : (BRANCHES.find((b) => b.code === d.branch)?.short ?? d.branch)

/**
 * Export the document register to Excel — one row per record (history included
 * if passed in), with every metadata and audit column, for compliance review.
 */
export function exportDocumentRegister(rows: DocumentRecord[], label: string) {
  const data = rows.map((d) => {
    const last = (d.audit ?? [])[d.audit ? d.audit.length - 1 : 0]
    return {
      Document: displayNameOf(d),
      Kind: typeLabelOf(d),
      Department: departmentOf(d),
      Subject: d.entity_label,
      Owner: d.owner ?? '',
      Branch: branchShort(d),
      Issued: d.issue_date || '',
      Expires: d.expiry_date || '',
      'Review due': d.review_date || '',
      Validity: DOC_STATUS_META[docStatus(d)].label,
      Approval: APPROVAL_STATUS_META[approvalOf(d)].label,
      Version: d.version,
      Current: d.superseded ? 'No (history)' : 'Yes',
      Reference: d.reference_no || '',
      Issuer: d.issuer || '',
      Tags: (d.tags ?? []).join(', '),
      File: d.file_name || '',
      'Uploaded by': d.uploaded_by,
      'Uploaded at': d.uploaded_at?.slice(0, 10) ?? '',
      'Last action': last ? `${last.action} — ${last.by} (${last.at.slice(0, 10)})` : '',
      Notes: d.notes || '',
    }
  })
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Documents')
  XLSX.writeFile(wb, `INZU_Document_Register_${label}_${today()}.xlsx`)
}
