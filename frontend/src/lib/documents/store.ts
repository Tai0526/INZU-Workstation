import { useSyncExternalStore } from 'react'
import type { BranchCode } from '@/lib/roles'
import { getActor } from '@/lib/audit/actor'
import { type DocumentRecord, type DocCategory } from './types'
import { registerCrossTabSync } from '@/lib/storage/sync'

/**
 * Mock document library — localStorage-backed metadata, reactive. The actual
 * file bytes live in IndexedDB (see lib/storage/fileStore). Both the Fleet →
 * Licensing grid and the Documents section read from here, so a licensing
 * upload is automatically searchable in Documents with no duplicate entry.
 */

const KEY = 'inzu_documents'

const SEED: DocumentRecord[] = [
  seed('INZ 101', 'kansanshi', 'road_tax', '2025-10-01', '2026-09-30'),
  seed('INZ 101', 'kansanshi', 'fitness', '2025-07-06', '2026-07-05'), // expiring soon
  seed('INZ 101', 'kansanshi', 'insurance', '2025-12-02', '2026-12-01'),
  seed('INZ 101', 'kansanshi', 'fqm_inspection', '2025-05-21', '2026-05-20'), // expired
  seed('INZ 102', 'kansanshi', 'road_tax', '2025-08-01', '2026-07-31'),
  seed('INZ 121', 'trident', 'road_tax', '2025-08-16', '2026-08-15'),
  seed('INZ 121', 'trident', 'insurance', '2025-06-10', '2026-06-09'), // expired
]

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

let cache: DocumentRecord[] | null = null
const listeners = new Set<() => void>()

function load(): DocumentRecord[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? (JSON.parse(raw) as DocumentRecord[]) : SEED
  } catch {
    cache = SEED
  }
  if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(cache))
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

    const rec: DocumentRecord = {
      ...input,
      id: newId(),
      version: nextVersion,
      superseded: false,
      uploaded_by: getActor().name,
      uploaded_at: new Date().toISOString(),
    }
    const updated = list.map((d) => (priors.includes(d) ? { ...d, superseded: true } : d))
    commit([...updated, rec])
    return rec
  },

  /** Add a standalone document without superseding (for multi categories, e.g. training). */
  add(input: NewDocInput): DocumentRecord {
    const rec: DocumentRecord = {
      ...input,
      id: newId(),
      version: 1,
      superseded: false,
      uploaded_by: getActor().name,
      uploaded_at: new Date().toISOString(),
    }
    commit([...load(), rec])
    return rec
  },

  remove(id: string) {
    commit(load().filter((d) => d.id !== id))
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
