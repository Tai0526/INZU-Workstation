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
}

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
