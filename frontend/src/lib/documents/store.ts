import { useSyncExternalStore } from 'react'
import type { BranchCode } from '@/lib/roles'
import { getActor } from '@/lib/audit/actor'
import {
  type DocumentRecord, type DocCategory, type DocType, type ApprovalStatus, type AuditEvent, type AuditAction,
  type DocVisibility, type ShareGrant,
} from './types'
import { registerCrossTabSync } from '@/lib/storage/sync'

/**
 * Mock document library — localStorage-backed metadata, reactive. The actual
 * file bytes live in IndexedDB (see lib/storage/fileStore). Both the Fleet →
 * Licensing grid and the Documents section read from here, so a licensing
 * upload is automatically searchable in Documents with no duplicate entry.
 */

const KEY = 'inzu_documents'
// One-time flag: existing demo installs predate the general-library examples, so
// we inject them once (see load()) without disturbing data the user has entered.
const GEN_SEED_FLAG = 'inzu_docs_general_seed_v1'

// Vehicle licensing (these also drive the Fleet → Licensing grid).
const VEHICLE_SEED: DocumentRecord[] = [
  seed('INZ 101', 'kansanshi', 'road_tax', '2025-10-01', '2026-09-30'),
  seed('INZ 101', 'kansanshi', 'fitness', '2025-07-06', '2026-07-05'), // expiring soon
  seed('INZ 101', 'kansanshi', 'insurance', '2025-12-02', '2026-12-01'),
  seed('INZ 101', 'kansanshi', 'fqm_inspection', '2025-05-21', '2026-05-20'), // expired
  seed('INZ 102', 'kansanshi', 'road_tax', '2025-08-01', '2026-07-31'),
  seed('INZ 121', 'trident', 'road_tax', '2025-08-16', '2026-08-15'),
  seed('INZ 121', 'trident', 'insurance', '2025-06-10', '2026-06-09'), // expired
]

// General library — policies, SOPs, risk assessments, permits, registers…
const GENERAL_SEED: DocumentRecord[] = [
  gseed('safety_policy', 'Transport & Road Safety Policy', 'policy', 'kansanshi', 'Safety', { all: true, owner: 'Safety Manager', review: '2026-07-15', tags: ['safety', 'transport', 'driving'] }),
  gseed('journey_sop', 'Journey Management Procedure (SOP)', 'procedure', 'kansanshi', 'Operations', { all: true, owner: 'Operations Manager', review: '2026-09-01', tags: ['journey', 'planning'] }),
  gseed('driver_handbook', 'Driver Handbook', 'manual', 'kansanshi', 'Drivers', { all: true, owner: 'Route Supervisor', tags: ['induction'] }),
  gseed('board_minutes_q1', 'Q1 2026 Management Review Minutes', 'minutes', 'kansanshi', 'Board', { all: true, owner: 'Managing Director', vis: 'private' }),
  gseed('fatigue_ra', 'Driver Fatigue Risk Assessment', 'risk_assessment', 'trident', 'Safety', { issue: '2025-07-12', expiry: '2026-07-12', owner: 'Safety Officer', tags: ['fatigue', 'risk'] }), // expiring
  gseed('site_permit', 'Mine Site Access Permit', 'permit', 'trident', 'Operations', { issue: '2025-07-09', expiry: '2026-07-09', owner: 'Operations Manager' }), // expiring
  gseed('da_policy_rev', 'Drug & Alcohol Policy (revised)', 'policy', 'kansanshi', 'Safety', { approval: 'pending', owner: 'Safety Officer', tags: ['policy'] }), // awaiting approval
  gseed('recovery_sop', 'Vehicle Recovery SOP', 'procedure', 'trident', 'Workshop', { approval: 'draft', owner: 'Workshop Supervisor' }), // draft
]

const SEED: DocumentRecord[] = [...VEHICLE_SEED, ...GENERAL_SEED]

function seed(fleet: string, branch: BranchCode, category: DocCategory, issue: string, expiry: string): DocumentRecord {
  return {
    id: `seed_${fleet}_${category}`.replace(/\s/g, ''),
    category, entity_type: 'vehicle', entity_id: fleet, entity_label: fleet, branch,
    issue_date: issue, expiry_date: expiry, reference_no: '', issuer: '',
    file_id: '', file_name: '(sample — no file in demo)', file_size: 0, mime_type: '',
    version: 1, superseded: false, notes: '', uploaded_by: 'System (seed)', uploaded_by_role: 'seed',
    uploaded_at: '2026-01-01T00:00:00.000Z',
  }
}

/** Seed a general/library document (policies, SOPs, permits, minutes…). */
function gseed(
  idn: string, title: string, doc_type: DocType, branch: BranchCode, dept: string,
  o: { issue?: string; expiry?: string; review?: string; approval?: ApprovalStatus; all?: boolean; owner?: string; tags?: string[]; vis?: DocVisibility } = {},
): DocumentRecord {
  const at = '2026-01-01T00:00:00.000Z'
  const approval = o.approval ?? 'approved'
  const audit: AuditEvent[] = [{ action: 'uploaded', by: 'System (seed)', role: 'seed', at }]
  if (approval === 'pending') audit.push({ action: 'submitted', by: 'System (seed)', role: 'seed', at })
  if (approval === 'approved') { audit.push({ action: 'submitted', by: 'System (seed)', role: 'seed', at }); audit.push({ action: 'approved', by: 'System (seed)', role: 'seed', at }) }
  const id = `seed_doc_${idn}`
  return {
    id, category: 'other', title, doc_type,
    entity_type: 'general', entity_id: id, entity_label: o.all ? 'Company-wide' : dept,
    branch, issue_date: o.issue ?? '', expiry_date: o.expiry ?? '', reference_no: '', issuer: '',
    file_id: '', file_name: '(sample — no file in demo)', file_size: 0, mime_type: '',
    version: 1, superseded: false, notes: '', uploaded_by: 'System (seed)', uploaded_by_role: 'seed', uploaded_at: at,
    department: dept, owner: o.owner ?? '', tags: o.tags ?? [], review_date: o.review ?? '',
    all_branches: o.all ?? false, approval_status: approval, audit,
    visibility: o.vis ?? 'public', owner_id: 'U-ADMIN', shared_with: [],
  }
}

let cache: DocumentRecord[] | null = null
const listeners = new Set<() => void>()

/**
 * Back-fill records saved before the library workflow existed: every document
 * gets an approval status (legacy rows are treated as already approved) and an
 * audit trail seeded from its original upload, so nothing is left untracked.
 */
function coerce(d: DocumentRecord): DocumentRecord {
  const needs = d.approval_status === undefined || d.audit === undefined || d.tags === undefined
    || (d.entity_type === 'general' && d.doc_type === undefined)
  if (!needs) return d
  const approval_status: ApprovalStatus = d.approval_status ?? 'approved'
  const audit: AuditEvent[] = d.audit ?? [{ action: 'uploaded', by: d.uploaded_by, role: d.uploaded_by_role, at: d.uploaded_at }]
  const doc_type: DocType | undefined = d.entity_type === 'general' ? (d.doc_type ?? 'other') : d.doc_type
  return { ...d, approval_status, audit, doc_type, tags: d.tags ?? [] }
}

function load(): DocumentRecord[] {
  if (cache) return cache
  let parsed: DocumentRecord[] | null = null
  try {
    const raw = localStorage.getItem(KEY)
    parsed = raw ? (JSON.parse(raw) as DocumentRecord[]) : null
  } catch {
    parsed = null
  }
  let next = (parsed ?? SEED).map(coerce)

  // One-time: bring the general-library examples to existing demo installs that
  // predate them. Only do so while the data still looks like the seeded demo
  // (original vehicle seeds present, no general seeds yet) so we never inject
  // sample documents into a database the user has populated with real data.
  if (parsed && localStorage.getItem(GEN_SEED_FLAG) !== '1') {
    const hasGeneralSeed = next.some((d) => d.id.startsWith('seed_doc_'))
    const stillDemo = next.some((d) => d.id.startsWith('seed_INZ'))
    if (!hasGeneralSeed && stillDemo) next = [...next, ...GENERAL_SEED]
    localStorage.setItem(GEN_SEED_FLAG, '1')
  }

  cache = next
  // Persist on first run (key absent) or when migration changed something.
  if (!parsed || JSON.stringify(next) !== JSON.stringify(parsed)) localStorage.setItem(KEY, JSON.stringify(next))
  return cache!
}

function commit(next: DocumentRecord[]) {
  cache = next
  localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
}
registerCrossTabSync(KEY, () => { cache = null; load(); listeners.forEach((l) => l()) })

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `d_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}

/** Apply a patch to one document and append an audit event attributed to the current actor. */
function pushEvent(id: string, action: AuditAction, patch: Partial<DocumentRecord>, note?: string) {
  const a = getActor()
  const ev: AuditEvent = { action, by: a.name, role: a.role, at: new Date().toISOString(), note: note?.trim() || undefined }
  commit(load().map((d) => (d.id === id ? { ...d, ...patch, audit: [...(d.audit ?? []), ev] } : d)))
}

export interface NewDocInput {
  category: DocCategory
  title?: string
  entity_type: DocumentRecord['entity_type']
  entity_id: string
  entity_label: string
  branch: BranchCode
  issue_date: string
  expiry_date: string
  reference_no: string
  issuer: string
  file_id: string
  file_name: string
  file_size: number
  mime_type: string
  notes: string
  uploaded_by_role: DocumentRecord['uploaded_by_role']
  // Optional library metadata (omitted by the licensing modals — they default sensibly).
  doc_type?: DocType
  department?: string
  owner?: string
  tags?: string[]
  review_date?: string
  all_branches?: boolean
  approval_status?: ApprovalStatus // defaults to 'approved' when not supplied
  visibility?: DocVisibility // defaults to 'public'
  owner_id?: string // creating user's id
  shared_with?: ShareGrant[] // private-document recipients
}

/** Build the opening audit trail for a freshly created/renewed document. */
function openingAudit(role: DocumentRecord['uploaded_by_role'], at: string, first: 'uploaded' | 'new_version', approval: ApprovalStatus): AuditEvent[] {
  const by = getActor().name
  const trail: AuditEvent[] = [{ action: first, by, role, at }]
  if (approval === 'pending') trail.push({ action: 'submitted', by, role, at })
  return trail
}

export const documentsStore = {
  list: (): DocumentRecord[] => load(),

  /**
   * Add a new document. For an entity+category that already has a current
   * record (e.g. a renewed road tax), the previous current is marked superseded
   * and kept as history; the new one becomes version N+1.
   */
  addVersion(input: NewDocInput): DocumentRecord {
    const list = load()
    const priors = list.filter(
      (d) => d.entity_id === input.entity_id && d.category === input.category && !d.superseded,
    )
    const nextVersion = list
      .filter((d) => d.entity_id === input.entity_id && d.category === input.category)
      .reduce((m, d) => Math.max(m, d.version), 0) + 1

    const now = new Date().toISOString()
    const approval_status = input.approval_status ?? 'approved'
    const rec: DocumentRecord = {
      ...input,
      id: newId(),
      version: nextVersion,
      superseded: false,
      uploaded_by: getActor().name,
      uploaded_at: now,
      tags: input.tags ?? [],
      approval_status,
      audit: openingAudit(input.uploaded_by_role, now, nextVersion > 1 ? 'new_version' : 'uploaded', approval_status),
      visibility: input.visibility ?? 'public',
      owner_id: input.owner_id ?? '',
      shared_with: input.shared_with ?? [],
    }
    const updated = list.map((d) => (priors.includes(d) ? { ...d, superseded: true } : d))
    commit([...updated, rec])
    return rec
  },

  /** Add a standalone document without superseding (for multi categories, e.g. training). */
  add(input: NewDocInput): DocumentRecord {
    const now = new Date().toISOString()
    const approval_status = input.approval_status ?? 'approved'
    const rec: DocumentRecord = {
      ...input,
      id: newId(),
      version: 1,
      superseded: false,
      uploaded_by: getActor().name,
      uploaded_at: now,
      tags: input.tags ?? [],
      approval_status,
      audit: openingAudit(input.uploaded_by_role, now, 'uploaded', approval_status),
      visibility: input.visibility ?? 'public',
      owner_id: input.owner_id ?? '',
      shared_with: input.shared_with ?? [],
    }
    commit([...load(), rec])
    return rec
  },

  remove(id: string) {
    commit(load().filter((d) => d.id !== id))
  },

  /** Remove every version of a document family (used for an explicit delete). */
  removeFamily(entityId: string, category: DocCategory) {
    commit(load().filter((d) => !(d.entity_id === entityId && d.category === category)))
  },

  // ── Approval workflow + edits (each appends to the audit trail) ─────────
  submit(id: string, note?: string) { pushEvent(id, 'submitted', { approval_status: 'pending' }, note) },
  approve(id: string, note?: string) { pushEvent(id, 'approved', { approval_status: 'approved' }, note) },
  reject(id: string, note?: string) { pushEvent(id, 'rejected', { approval_status: 'rejected' }, note) },
  /** Edit metadata on a document; records an "updated" audit entry. */
  update(id: string, patch: Partial<DocumentRecord>, note?: string) { pushEvent(id, 'updated', patch, note) },
  /** Set who can see/manage a document (public, or private to chosen people). */
  setAccess(id: string, visibility: DocVisibility, shared_with: ShareGrant[], note?: string) {
    pushEvent(id, 'shared', { visibility, shared_with: visibility === 'private' ? shared_with : [] }, note)
  },

  /** Move all of a vehicle's documents to a branch (used when a vehicle is transferred). */
  setBranchForEntity(entityId: string, branch: BranchCode) {
    let changed = false
    const next = load().map((d) => {
      if (d.entity_type === 'vehicle' && d.entity_id === entityId && d.branch !== branch) { changed = true; return { ...d, branch } }
      return d
    })
    if (changed) commit(next)
  },

  /** One-pass reconcile: align every vehicle document's branch with its vehicle's current branch. */
  syncVehicleBranches(branchByVehicle: Record<string, BranchCode>) {
    let changed = false
    const next = load().map((d) => {
      if (d.entity_type === 'vehicle') {
        const b = branchByVehicle[d.entity_id]
        if (b && d.branch !== b) { changed = true; return { ...d, branch: b } }
      }
      return d
    })
    if (changed) commit(next)
  },

  /** All current (non-superseded) docs for an entity, newest first. */
  forEntity(entityId: string): DocumentRecord[] {
    return load()
      .filter((d) => d.entity_id === entityId && !d.superseded)
      .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
  },

  /** Current (non-superseded) record for a vehicle + category, if any. */
  currentFor(entityId: string, category: DocCategory): DocumentRecord | undefined {
    return load().find((d) => d.entity_id === entityId && d.category === category && !d.superseded)
  },

  /** All versions (current + history) for a vehicle + category, newest first. */
  historyFor(entityId: string, category: DocCategory): DocumentRecord[] {
    return load()
      .filter((d) => d.entity_id === entityId && d.category === category)
      .sort((a, b) => b.version - a.version)
  },
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useDocuments(): DocumentRecord[] {
  return useSyncExternalStore(subscribe, load, load)
}
