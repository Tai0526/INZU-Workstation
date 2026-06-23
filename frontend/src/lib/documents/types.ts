import type { BranchCode, RoleKey } from '@/lib/roles'
import type { StatusTone } from '@/components/ui/StatusBadge'

// ── Document categories ────────────────────────────────────────────────
// Vehicle licensing categories appear as columns on the Fleet → Licensing grid.
// Driver categories appear on the Driver profile. All flow into Documents.
export type DocCategory =
  | 'road_tax' | 'fitness' | 'insurance' | 'fqm_inspection' // vehicle licensing
  | 'driver_licence' | 'nrc' | 'medical' | 'silicosis' | 'defensive_driving' | 'training' // driver
  | 'other'

export type DocScope = 'vehicle' | 'driver' | 'general'

interface CategoryMeta {
  label: string
  short: string
  scope: DocScope
  licensing: boolean // vehicle licensing grid column
  expiry: boolean // carries an expiry date / drives reminders
  multi: boolean // a driver can hold many of these at once (e.g. training certs)
}

export const CATEGORY_META: Record<DocCategory, CategoryMeta> = {
  // Vehicle licensing
  road_tax: { label: 'Road Tax', short: 'Road Tax', scope: 'vehicle', licensing: true, expiry: true, multi: false },
  fitness: { label: 'Fitness Certificate', short: 'Fitness', scope: 'vehicle', licensing: true, expiry: true, multi: false },
  insurance: { label: 'Insurance', short: 'Insurance', scope: 'vehicle', licensing: true, expiry: true, multi: false },
  fqm_inspection: { label: 'FQM Inspection', short: 'FQM Insp.', scope: 'vehicle', licensing: true, expiry: true, multi: false },
  // Driver
  driver_licence: { label: 'Driving Licence', short: 'Licence', scope: 'driver', licensing: false, expiry: true, multi: false },
  nrc: { label: 'NRC', short: 'NRC', scope: 'driver', licensing: false, expiry: false, multi: false },
  medical: { label: 'Medical Certificate', short: 'Medical', scope: 'driver', licensing: false, expiry: true, multi: false },
  silicosis: { label: 'Silicosis Certificate', short: 'Silicosis', scope: 'driver', licensing: false, expiry: true, multi: false },
  defensive_driving: { label: 'Defensive Driving', short: 'Def. Driving', scope: 'driver', licensing: false, expiry: true, multi: false },
  training: { label: 'Training Certificate', short: 'Training', scope: 'driver', licensing: false, expiry: false, multi: true },
  // General
  other: { label: 'Other Document', short: 'Other', scope: 'general', licensing: false, expiry: false, multi: false },
}

export const LICENSING_CATEGORIES = (Object.keys(CATEGORY_META) as DocCategory[]).filter((c) => CATEGORY_META[c].licensing)
// Medical is managed in Safety → Driver Compliance, so it's excluded from the
// driver profile's document upload options.
export const DRIVER_DOC_CATEGORIES = (Object.keys(CATEGORY_META) as DocCategory[]).filter((c) => CATEGORY_META[c].scope === 'driver' && c !== 'medical')

export interface DocumentRecord {
  id: string
  category: DocCategory
  title?: string // optional name, e.g. a specific training course
  entity_type: 'vehicle' | 'driver' | 'general'
  entity_id: string // vehicle id, etc.
  entity_label: string // e.g. fleet number / driver name — denormalised for search
  branch: BranchCode
  issue_date: string // ISO yyyy-mm-dd
  expiry_date: string // ISO yyyy-mm-dd ('' if not applicable)
  reference_no: string
  issuer: string
  file_id: string // key into the IndexedDB file store ('' = sample/no file)
  file_name: string
  file_size: number
  mime_type: string
  version: number
  superseded: boolean // true = an older record replaced by a renewal
  notes: string
  uploaded_by: string // actor name, for audit
  uploaded_by_role: RoleKey | 'seed'
  uploaded_at: string // ISO

  // ── Library / general-document metadata (optional; older records omit these,
  //    and the store back-fills sensible defaults on load — see coerce()) ──
  doc_type?: DocType // richer classification for general/organisational docs
  department?: string // owning function (Operations, Safety, HR…)
  owner?: string // responsible person/role — may differ from the uploader
  tags?: string[] // free-form tags for search
  review_date?: string // periodic-review due date (policies/SOPs) — ISO yyyy-mm-dd or ''
  all_branches?: boolean // company-wide document, visible to both branches
  approval_status?: ApprovalStatus // workflow state (defaults to 'approved' for legacy rows)
  audit?: AuditEvent[] // lifecycle trail: upload → submit → approve / reject …

  // ── Access control ──
  visibility?: DocVisibility // public (default) or private to chosen people
  owner_id?: string // creator's user id — may manage access and the document
  shared_with?: ShareGrant[] // who a private document is shared with, and at what level
}

// ── Access control ─────────────────────────────────────────────────────
export type DocVisibility = 'public' | 'private'
export interface ShareGrant {
  user_id: string
  access: 'view' | 'edit'
}

export interface AccessCtx { userId: string; role: RoleKey; branch: BranchCode; canToggle: boolean }

/** Effective visibility (legacy rows with none are public). */
export function visibilityOf(d: DocumentRecord): DocVisibility {
  return d.visibility ?? 'public'
}

/** Can this user see the document at all? Private docs are limited to the owner
 *  and the people it's shared with; public docs follow normal branch scoping. */
export function canAccessDoc(d: DocumentRecord, c: AccessCtx): boolean {
  if (c.role === 'administrator') return true
  if (d.owner_id && d.owner_id === c.userId) return true
  if (visibilityOf(d) === 'private') return (d.shared_with ?? []).some((g) => g.user_id === c.userId)
  return c.canToggle || d.branch === c.branch || !!d.all_branches
}

/** Can this user manage the document (share, version, submit, delete)? Owner,
 *  administrator, or someone granted edit access. */
export function canManageDoc(d: DocumentRecord, c: AccessCtx): boolean {
  if (c.role === 'administrator') return true
  if (d.owner_id && d.owner_id === c.userId) return true
  return (d.shared_with ?? []).some((g) => g.user_id === c.userId && g.access === 'edit')
}

// ── Library document classification (general / organisational documents) ───
// The vehicle/driver licensing taxonomy lives in DocCategory above; this richer
// set classifies everything else the library now holds — policies, SOPs, risk
// assessments, permits, IDs, contracts, registers, reports…
export type DocType =
  | 'policy' | 'procedure' | 'risk_assessment' | 'form' | 'register'
  | 'report' | 'license' | 'permit' | 'certificate' | 'contract'
  | 'manual' | 'minutes' | 'correspondence' | 'statutory' | 'identity' | 'other'

export const DOC_TYPE_META: Record<DocType, { label: string; expiry: boolean }> = {
  policy: { label: 'Policy', expiry: false },
  procedure: { label: 'Procedure / SOP', expiry: false },
  risk_assessment: { label: 'Risk Assessment', expiry: true },
  form: { label: 'Form / Template', expiry: false },
  register: { label: 'Register / Log', expiry: false },
  report: { label: 'Report', expiry: false },
  license: { label: 'Licence', expiry: true },
  permit: { label: 'Permit', expiry: true },
  certificate: { label: 'Certificate', expiry: true },
  contract: { label: 'Contract / Agreement', expiry: true },
  manual: { label: 'Manual / Guideline', expiry: false },
  minutes: { label: 'Meeting Minutes', expiry: false },
  correspondence: { label: 'Correspondence', expiry: false },
  statutory: { label: 'Statutory Return', expiry: true },
  identity: { label: 'Identity Document (NRC, passport)', expiry: true },
  other: { label: 'Other', expiry: false },
}
export const DOC_TYPE_KEYS = Object.keys(DOC_TYPE_META) as DocType[]

// Owning function/department — used for filing and search.
export const DEPARTMENTS = [
  'Operations', 'Safety', 'Workshop', 'Fleet', 'Drivers', 'HR',
  'Payroll', 'Finance', 'Administration', 'Board', 'Company-wide',
] as const

// ── Approval workflow ──────────────────────────────────────────────────
export type ApprovalStatus = 'draft' | 'pending' | 'approved' | 'rejected'

export const APPROVAL_STATUS_META: Record<ApprovalStatus, { label: string; tone: StatusTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending: { label: 'Pending approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'critical' },
}
export const APPROVAL_STATUS_KEYS = Object.keys(APPROVAL_STATUS_META) as ApprovalStatus[]

// ── Audit trail ────────────────────────────────────────────────────────
export type AuditAction = 'uploaded' | 'submitted' | 'approved' | 'rejected' | 'new_version' | 'updated' | 'restored' | 'shared'
export interface AuditEvent {
  action: AuditAction
  by: string
  role: RoleKey | 'seed' | 'system'
  at: string // ISO
  note?: string
}
export const AUDIT_LABEL: Record<AuditAction, string> = {
  uploaded: 'Uploaded',
  submitted: 'Submitted for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  new_version: 'New version uploaded',
  updated: 'Details updated',
  restored: 'Re-opened',
  shared: 'Access changed',
}

export const REVIEW_WARNING_DAYS = 30

// ── Status derived from expiry + supersession ──────────────────────────
export type DocStatus = 'current' | 'expiring' | 'expired' | 'superseded' | 'none'

export const DOC_STATUS_META: Record<DocStatus, { label: string; tone: StatusTone }> = {
  current: { label: 'Current', tone: 'good' },
  expiring: { label: 'Expiring soon', tone: 'warning' },
  expired: { label: 'Expired', tone: 'critical' },
  superseded: { label: 'Superseded', tone: 'neutral' },
  none: { label: 'No expiry', tone: 'neutral' },
}

export const EXPIRY_WARNING_DAYS = 30

export function daysUntil(iso: string, today = new Date()): number | null {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - new Date(today.toDateString()).getTime()) / 86_400_000)
}

export function docStatus(rec: DocumentRecord, today = new Date()): DocStatus {
  if (rec.superseded) return 'superseded'
  const days = daysUntil(rec.expiry_date, today)
  if (days === null) return 'none'
  if (days < 0) return 'expired'
  if (days <= EXPIRY_WARNING_DAYS) return 'expiring'
  return 'current'
}

// ── Display + classification helpers (work for both licensing and library docs) ──

/** Effective approval status (legacy rows with no workflow are treated as approved). */
export function approvalOf(d: DocumentRecord): ApprovalStatus {
  return d.approval_status ?? 'approved'
}

/** Human label for a document's kind — doc_type for library docs, category otherwise. */
export function typeLabelOf(d: DocumentRecord): string {
  if (d.entity_type === 'general') return DOC_TYPE_META[d.doc_type ?? 'other'].label
  return CATEGORY_META[d.category]?.label ?? 'Document'
}

/** The name to show for a document — its title if it has one, else its kind. */
export function displayNameOf(d: DocumentRecord): string {
  return (d.title && d.title.trim()) || typeLabelOf(d)
}

/** Owning department — explicit field, or derived from the linked entity. */
export function departmentOf(d: DocumentRecord): string {
  if (d.department) return d.department
  if (d.entity_type === 'vehicle') return 'Fleet'
  if (d.entity_type === 'driver') return 'Drivers'
  return 'General'
}

/** Periodic-review state for policies/SOPs that carry a review date. */
export function reviewStatus(d: DocumentRecord, today = new Date()): 'due' | 'soon' | 'ok' | null {
  const days = daysUntil(d.review_date ?? '', today)
  if (days === null) return null
  if (days < 0) return 'due'
  if (days <= REVIEW_WARNING_DAYS) return 'soon'
  return 'ok'
}
