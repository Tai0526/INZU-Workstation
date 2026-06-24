import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import { daysUntil } from '@/lib/documents/types'
import type { BranchCode } from '@/lib/roles'
import type { StatusTone } from '@/components/ui/StatusBadge'
import { createSyncTable } from '@/lib/supabase/syncTable'

/**
 * Safety registers — the data behind every Safety sub-page except Incidents
 * (which lives in cases.ts). One generic localStorage-backed store per register,
 * all sharing the same audit-stamped CRUD factory used elsewhere in the app.
 */

export interface Audited {
  id: string
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}
export interface SafetyFile { file_id: string; file_name: string }

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `s_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}
const stampNow = () => new Date().toISOString()
const who = () => getActor().name
type Input<T extends Audited> = Omit<T, keyof Audited> & Partial<Pick<T, 'id'>>

function makeStore<T extends Audited>(key: string, seed: T[]) {
  const { load, commit, subscribe } = createSyncTable<T>({ table: key.replace(/^inzu_/, ''), lsKey: key, seed })
  return {
    list: () => load(),
    add(data: Input<T>): T {
      const now = stampNow()
      const item = { ...(data as object), id: data.id ?? newId(), created_by: who(), created_at: now, updated_by: who(), updated_at: now } as T
      commit([...load(), item])
      return item
    },
    update(id: string, patch: Partial<T>) {
      commit(load().map((x) => (x.id === id ? { ...x, ...patch, id: x.id, updated_by: who(), updated_at: stampNow() } : x)))
    },
    remove(id: string) {
      commit(load().filter((x) => x.id !== id))
    },
    subscribe,
    snapshot: () => load(),
  }
}

const A = '2026-01-01T00:00:00.000Z'
const audit = { created_by: 'System (seed)', created_at: A, updated_by: 'System (seed)', updated_at: A }

// ════════════════════════════════════════════════════════════════════════
// Credentials — shared shape for Driver Compliance + Training Records
// ════════════════════════════════════════════════════════════════════════
export interface Credential extends Audited {
  branch: BranchCode
  driver_id: string
  driver_name: string
  category: string // one of the page's category keys
  issued: string // ISO date the class was done
  expiry: string // ISO date ('' = no expiry)
  location?: string // where it was done (training provider / clinic)
  cert_file: SafetyFile | null
  notes: string
}

/**
 * The FQM mine-access classes a driver must hold to be compliant. Two are
 * PREREQUISITES (medical + silicosis) — the rest stay LOCKED until both are
 * current, because FQM won't admit a driver to a class without them. Each class
 * may carry an expiry and/or require a proof attachment.
 */
export interface ComplianceClass {
  key: string
  label: string
  short: string // column header
  prerequisite: boolean
  has_expiry: boolean
  requires_attachment: boolean
}
// The starting class list — Safety can add/remove from here at runtime.
export const DEFAULT_COMPLIANCE_CLASSES: ComplianceClass[] = [
  { key: 'medical', label: 'Medical', short: 'Medical', prerequisite: true, has_expiry: true, requires_attachment: true },
  { key: 'silicosis', label: 'Silicosis', short: 'Silicosis', prerequisite: true, has_expiry: true, requires_attachment: true },
  { key: 'gen_induction', label: 'General Induction', short: 'Gen Ind', prerequisite: false, has_expiry: true, requires_attachment: false },
  { key: 'hand_protection', label: 'Hand Protection', short: 'Hand Prot', prerequisite: false, has_expiry: false, requires_attachment: false },
  { key: 'lightning', label: 'Lightning Awareness', short: 'Lightning', prerequisite: false, has_expiry: false, requires_attachment: false },
  { key: 'site_induction', label: 'Site Induction', short: 'Site Ind', prerequisite: false, has_expiry: true, requires_attachment: false },
  { key: 'think_l1', label: 'Think Level 1', short: 'Think L1', prerequisite: false, has_expiry: false, requires_attachment: false },
  { key: 'first_aid', label: 'First Aid', short: 'First Aid', prerequisite: false, has_expiry: true, requires_attachment: false },
  { key: 'pit_induction', label: 'Pit Induction', short: 'Pit Ind', prerequisite: false, has_expiry: true, requires_attachment: false },
  { key: 'fibrous', label: 'Fibrous Handling Materials', short: 'Fibrous', prerequisite: false, has_expiry: false, requires_attachment: false },
]

// ── Editable class catalog (persisted) ─────────────────────────────────
const CLASSES_KEY = 'inzu_safety_classes'
let classesCache: ComplianceClass[] | null = null
const classesListeners = new Set<() => void>()
function loadClasses(): ComplianceClass[] {
  if (classesCache) return classesCache
  try {
    const raw = localStorage.getItem(CLASSES_KEY)
    classesCache = raw ? (JSON.parse(raw) as ComplianceClass[]) : DEFAULT_COMPLIANCE_CLASSES
  } catch {
    classesCache = DEFAULT_COMPLIANCE_CLASSES
  }
  if (!localStorage.getItem(CLASSES_KEY)) localStorage.setItem(CLASSES_KEY, JSON.stringify(classesCache))
  return classesCache!
}
function commitClasses(next: ComplianceClass[]) {
  classesCache = next
  localStorage.setItem(CLASSES_KEY, JSON.stringify(next))
  classesListeners.forEach((l) => l())
}
function slug(label: string, taken: string[]): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'class'
  let key = base, i = 2
  while (taken.includes(key)) key = `${base}_${i++}`
  return key
}
export const classesStore = {
  list: (): ComplianceClass[] => loadClasses(),
  add(input: Omit<ComplianceClass, 'key'>): ComplianceClass {
    const cls: ComplianceClass = { ...input, short: input.short || input.label, key: slug(input.label, loadClasses().map((c) => c.key)) }
    commitClasses([...loadClasses(), cls])
    return cls
  },
  update(key: string, patch: Partial<ComplianceClass>) {
    commitClasses(loadClasses().map((c) => (c.key === key ? { ...c, ...patch, key: c.key } : c)))
  },
  remove(key: string) {
    commitClasses(loadClasses().filter((c) => c.key !== key))
  },
  subscribe(cb: () => void) { classesListeners.add(cb); return () => classesListeners.delete(cb) },
  snapshot: () => loadClasses(),
}
export const useComplianceClasses = () => useSyncExternalStore(classesStore.subscribe, classesStore.snapshot, classesStore.snapshot)
/** key → class lookup for a given class list. */
export const classMap = (classes: ComplianceClass[]): Record<string, ComplianceClass> => Object.fromEntries(classes.map((c) => [c.key, c]))

// ── Matrix cell state ──────────────────────────────────────────────────
export type CellState = 'current' | 'expiring' | 'expired' | 'not_done' | 'locked'

/** Are the prerequisite classes (e.g. medical + silicosis) done & not expired? */
export function prereqsMet(driverCreds: Credential[], prereqKeys: string[]): boolean {
  return prereqKeys.every((key) => {
    const cr = driverCreds.find((c) => c.category === key)
    return !!cr && credStatus(cr.expiry) !== 'expired'
  })
}

/** Resolve a single matrix cell's state for a driver × class. */
export function cellState(cred: Credential | undefined, isPrereq: boolean, prereqMet: boolean): CellState {
  if (cred) {
    const st = credStatus(cred.expiry)
    if (st === 'expired') return 'expired'
    if (st === 'expiring') return 'expiring'
    return 'current' // valid, or done with no expiry recorded
  }
  if (!isPrereq && !prereqMet) return 'locked'
  return 'not_done'
}
/** A class counts toward the compliance score when it's done and not expired. */
export const isCompliantCell = (s: CellState) => s === 'current' || s === 'expiring'

export const TRAINING_META: Record<string, string> = {
  defensive: 'Defensive Driving',
  tata_oem: 'TATA OEM Training',
  first_aid: 'First Aid',
  fire: 'Fire Awareness',
  fatigue: 'Fatigue Management',
}

export type CredStatus = 'valid' | 'expiring' | 'expired' | 'missing'
export function credStatus(expiry: string): CredStatus {
  if (!expiry) return 'missing'
  const d = daysUntil(expiry)
  if (d === null) return 'missing'
  if (d < 0) return 'expired'
  if (d <= 30) return 'expiring'
  return 'valid'
}
export const CRED_STATUS_META: Record<CredStatus, { label: string; tone: StatusTone }> = {
  valid: { label: 'Valid', tone: 'good' },
  expiring: { label: 'Expiring', tone: 'warning' },
  expired: { label: 'Expired', tone: 'critical' },
  missing: { label: 'No certificate', tone: 'neutral' },
}

const cred = (
  id: string, branch: BranchCode, did: string, name: string, category: string, issued: string, expiry: string, hasFile = true, location = '',
): Credential => ({
  id, branch, driver_id: did, driver_name: name, category, issued, expiry, location,
  cert_file: hasFile ? { file_id: `seed_${id}`, file_name: `${category}-${did}.pdf` } : null, notes: '', ...audit,
})

// One driver = several rows (one per class they've completed). The matrix pivots these.
const COMPLIANCE_SEED: Credential[] = [
  // Joseph Sakala — fully inducted
  cred('CMP1', 'trident', 'INZ-D201', 'Joseph Sakala', 'medical', '2025-07-01', '2027-07-01', true, 'Mary Begg Kalumbila'),
  cred('CMP2', 'trident', 'INZ-D201', 'Joseph Sakala', 'silicosis', '2025-07-01', '2027-07-01', true, 'FQM Trident'),
  cred('CMP3', 'trident', 'INZ-D201', 'Joseph Sakala', 'gen_induction', '2025-07-05', '2027-07-05', false, 'FQM Trident'),
  cred('CMP4', 'trident', 'INZ-D201', 'Joseph Sakala', 'hand_protection', '2025-07-05', '', false, 'FQM Trident'),
  cred('CMP5', 'trident', 'INZ-D201', 'Joseph Sakala', 'lightning', '2025-07-06', '', false, 'FQM Trident'),
  cred('CMP6', 'trident', 'INZ-D201', 'Joseph Sakala', 'site_induction', '2025-07-06', '2027-07-06', false, 'FQM Trident'),
  cred('CMP7', 'trident', 'INZ-D201', 'Joseph Sakala', 'think_l1', '2025-07-07', '', false, 'FQM Trident'),
  cred('CMP8', 'trident', 'INZ-D201', 'Joseph Sakala', 'first_aid', '2025-07-08', '2026-07-08', false, 'St John Ambulance'),
  // Grace Mwila — prereqs done, partway through trainings, one expiring
  cred('CMP9', 'trident', 'INZ-D202', 'Grace Mwila', 'medical', '2025-06-25', '2026-07-05', true, 'Mary Begg Kalumbila'),
  cred('CMP10', 'trident', 'INZ-D202', 'Grace Mwila', 'silicosis', '2025-06-25', '2027-06-25', true, 'FQM Trident'),
  cred('CMP11', 'trident', 'INZ-D202', 'Grace Mwila', 'gen_induction', '2025-07-01', '2027-07-01', false, 'FQM Trident'),
  cred('CMP12', 'trident', 'INZ-D202', 'Grace Mwila', 'site_induction', '2025-07-01', '2027-07-01', false, 'FQM Trident'),
  // Emmanuel Lungu — medical expired (prereqs not met → trainings lock)
  cred('CMP13', 'trident', 'INZ-D203', 'Emmanuel Lungu', 'medical', '2024-05-20', '2026-05-20', true, 'Mary Begg Kalumbila'),
  cred('CMP14', 'trident', 'INZ-D203', 'Emmanuel Lungu', 'silicosis', '2024-05-20', '2026-05-20', true, 'FQM Trident'),
  // Kelvin Mumba (Kansanshi)
  cred('CMP15', 'kansanshi', 'INZ-D101', 'Kelvin Mumba', 'medical', '2025-07-02', '2027-07-02', true, 'Kansanshi Clinic'),
  cred('CMP16', 'kansanshi', 'INZ-D101', 'Kelvin Mumba', 'silicosis', '2025-07-02', '2027-07-02', true, 'FQM Kansanshi'),
  cred('CMP17', 'kansanshi', 'INZ-D101', 'Kelvin Mumba', 'gen_induction', '2025-07-05', '2027-07-05', false, 'FQM Kansanshi'),
]

const TRAINING_SEED: Credential[] = [
  cred('TRN1', 'trident', 'INZ-D201', 'Joseph Sakala', 'defensive', '2025-02-01', '2027-02-01'),
  cred('TRN2', 'trident', 'INZ-D201', 'Joseph Sakala', 'first_aid', '2024-06-15', '2026-06-15'),
  cred('TRN3', 'trident', 'INZ-D202', 'Grace Mwila', 'tata_oem', '2025-04-10', '2027-04-10'),
  cred('TRN4', 'trident', 'INZ-D203', 'Emmanuel Lungu', 'fatigue', '2025-05-20', '2026-05-20'),
  cred('TRN5', 'trident', 'INZ-D204', 'Ruth Kabwe', 'defensive', '', '', false),
  cred('TRN6', 'trident', 'INZ-D205', 'Davies Ngosa', 'fire', '2025-01-05', '2027-01-05'),
  cred('TRN7', 'kansanshi', 'INZ-D101', 'Kelvin Mumba', 'defensive', '2025-03-01', '2026-07-05'),
  cred('TRN8', 'kansanshi', 'INZ-D103', 'Mercy Chanda', 'first_aid', '2024-04-30', '2026-04-30'),
  cred('TRN9', 'kansanshi', 'INZ-D106', 'Felix Daka', 'tata_oem', '2025-02-12', '2027-02-12'),
]

// ════════════════════════════════════════════════════════════════════════
// Hazard register
// ════════════════════════════════════════════════════════════════════════
export const HAZARD_TYPE_META: Record<string, string> = {
  near_miss: 'Near miss',
  unsafe_act: 'Unsafe act',
  unsafe_condition: 'Unsafe condition',
  environmental: 'Environmental',
}
export type HazardStatus = 'open' | 'in_progress' | 'closed'
export const HAZARD_STATUS_META: Record<HazardStatus, { label: string; tone: StatusTone }> = {
  open: { label: 'Open', tone: 'critical' },
  in_progress: { label: 'In progress', tone: 'warning' },
  closed: { label: 'Closed', tone: 'good' },
}

export interface Hazard extends Audited {
  branch: BranchCode
  date_identified: string
  location: string
  type: string
  description: string
  severity: number // 1–5
  likelihood: number // 1–5
  controls: string
  owner: string
  target_date: string
  status: HazardStatus
  notes: string
}
export const riskScore = (h: Pick<Hazard, 'severity' | 'likelihood'>) => h.severity * h.likelihood
export function riskBand(score: number): { label: string; tone: StatusTone } {
  if (score >= 15) return { label: 'Extreme', tone: 'critical' }
  if (score >= 10) return { label: 'High', tone: 'critical' }
  if (score >= 5) return { label: 'Medium', tone: 'warning' }
  return { label: 'Low', tone: 'good' }
}

const HAZARD_SEED: Hazard[] = [
  { id: 'HZ1', branch: 'trident', date_identified: '2026-06-10', location: 'Sentinel pickup point', type: 'near_miss', description: 'Bus reversed near workers queueing in the dark — no marshal present.', severity: 4, likelihood: 4, controls: 'Marshal assigned to all pre-dawn pickups; reflective cones deployed.', owner: 'Safety Officer', target_date: '2026-06-30', status: 'in_progress', notes: '', ...audit },
  { id: 'HZ2', branch: 'trident', date_identified: '2026-06-15', location: 'Workshop yard', type: 'unsafe_condition', description: 'Oil spill on the wash bay floor — slip risk.', severity: 3, likelihood: 3, controls: 'Spill kit applied; absorbent mats ordered.', owner: 'Workshop Supervisor', target_date: '2026-06-25', status: 'open', notes: '', ...audit },
  { id: 'HZ3', branch: 'trident', date_identified: '2026-05-28', location: 'Lumwana road', type: 'unsafe_act', description: 'Driver overtaking on a blind rise reported by escort.', severity: 5, likelihood: 2, controls: 'Driver counselled; route briefing reissued.', owner: 'Route Supervisor', target_date: '2026-06-05', status: 'closed', notes: '', ...audit },
  { id: 'HZ4', branch: 'kansanshi', date_identified: '2026-06-12', location: 'Outside the mine gate', type: 'near_miss', description: 'Pedestrian crossed in front of a moving bus at the gate.', severity: 4, likelihood: 3, controls: 'Speed humps requested; gate marshal briefed.', owner: 'Safety Officer', target_date: '2026-07-01', status: 'open', notes: '', ...audit },
  { id: 'HZ5', branch: 'kansanshi', date_identified: '2026-06-01', location: 'Fuel bay', type: 'environmental', description: 'Diesel drips around the dispensing nozzle.', severity: 2, likelihood: 4, controls: 'Drip tray installed; nozzle seal replaced.', owner: 'Fuel Controller', target_date: '2026-06-20', status: 'in_progress', notes: '', ...audit },
]

// ════════════════════════════════════════════════════════════════════════
// CAP Tracker — FQM Trident OHS audit corrective actions
// ════════════════════════════════════════════════════════════════════════
export interface CapAction { id: string; text: string; done: boolean }
export type CapStatus = 'open' | 'in_progress' | 'compliant'
export const CAP_STATUS_META: Record<CapStatus, { label: string; tone: StatusTone }> = {
  open: { label: 'Open', tone: 'critical' },
  in_progress: { label: 'In progress', tone: 'warning' },
  compliant: { label: 'Compliant', tone: 'good' },
}

export interface CapFinding extends Audited {
  branch: BranchCode
  ref: string
  title: string
  description: string
  owner: string
  target_date: string
  status: CapStatus
  actions: CapAction[]
  evidence: SafetyFile | null
  notes: string
}
/** Share of sub-actions completed (0–1). */
export const capProgress = (f: CapFinding) => (f.actions.length ? f.actions.filter((a) => a.done).length / f.actions.length : 0)

const acts = (...texts: string[]): CapAction[] => texts.map((t, i) => ({ id: `a${i}`, text: t, done: false }))
const cap = (
  id: string, ref: string, title: string, description: string, owner: string, target: string, status: CapStatus, actions: CapAction[],
): CapFinding => ({ id, branch: 'trident', ref, title, description, owner, target_date: target, status, actions, evidence: null, notes: '', ...audit })

const CAP_SEED: CapFinding[] = [
  cap('CAP1', 'CAP-01', 'Driver fatigue management', 'No documented fatigue management plan for split-shift crews.', 'Safety Officer', '2026-07-15', 'in_progress', [{ id: 'a0', text: 'Draft fatigue policy', done: true }, { id: 'a1', text: 'Brief all crews', done: false }, { id: 'a2', text: 'Log rest breaks', done: false }]),
  cap('CAP2', 'CAP-02', 'Pre-start vehicle checklists', 'Daily checklists not consistently completed before dispatch.', 'Route Supervisor', '2026-07-10', 'in_progress', acts('Roll out checklist book', 'Audit completion weekly')),
  cap('CAP3', 'CAP-03', 'First-aid kit provisioning', 'Several buses found without a sealed first-aid kit.', 'Safety Officer', '2026-06-30', 'open', acts('Inventory all kits', 'Restock missing items', 'Monthly seal check')),
  cap('CAP4', 'CAP-04', 'Speed governor verification', 'Governor calibration certificates not on file for 6 units.', 'Workshop Supervisor', '2026-07-20', 'open', acts('Schedule calibration', 'File certificates')),
  cap('CAP5', 'CAP-05', 'Emergency contact signage', 'In-cab emergency contact decals missing or faded.', 'Safety Officer', '2026-07-05', 'compliant', [{ id: 'a0', text: 'Print decals', done: true }, { id: 'a1', text: 'Fit to all buses', done: true }]),
  cap('CAP6', 'CAP-06', 'Spill response training', 'Fuel-bay staff not trained on spill response.', 'Fuel Controller', '2026-07-25', 'open', acts('Source trainer', 'Run session', 'Issue certificates')),
  cap('CAP7', 'CAP-07', 'PPE compliance', 'Reflective vests not worn at pre-dawn pickups.', 'Route Supervisor', '2026-06-28', 'in_progress', acts('Issue vests', 'Spot-check at pickups')),
  cap('CAP8', 'CAP-08', 'Incident reporting flow', 'No clear escalation path for near misses.', 'Safety Officer', '2026-07-12', 'in_progress', acts('Publish reporting SOP', 'Train supervisors')),
  cap('CAP9', 'CAP-09', 'Fire extinguisher servicing', 'Extinguishers overdue for annual service.', 'Workshop Supervisor', '2026-07-18', 'open', acts('Book service contractor', 'Tag serviced units')),
  cap('CAP10', 'CAP-10', 'Defensive driving refresher', 'Refresher cycle lapsed for long-serving drivers.', 'Safety Officer', '2026-08-01', 'open', acts('Identify due drivers', 'Schedule refreshers')),
  cap('CAP11', 'CAP-11', 'Seatbelt enforcement', 'Passenger seatbelt use not monitored.', 'Route Supervisor', '2026-07-08', 'in_progress', acts('Brief drivers', 'Add to checklist')),
  cap('CAP12', 'CAP-12', 'Audit close-out evidence', 'Prior CAP items closed without retained evidence.', 'Operations Manager', '2026-07-30', 'open', acts('Define evidence standard', 'Backfill records')),
]

// ════════════════════════════════════════════════════════════════════════
// LOTO register
// ════════════════════════════════════════════════════════════════════════
export const ENERGY_META: Record<string, string> = {
  electrical: 'Electrical',
  mechanical: 'Mechanical',
  hydraulic: 'Hydraulic',
  pneumatic: 'Pneumatic',
  stored: 'Stored energy',
}
export type LotoStatus = 'compliant' | 'due' | 'overdue'
export const LOTO_STATUS_META: Record<LotoStatus, { label: string; tone: StatusTone }> = {
  compliant: { label: 'Compliant', tone: 'good' },
  due: { label: 'Audit due', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'critical' },
}
export interface LotoPoint extends Audited {
  branch: BranchCode
  asset: string
  label_code: string
  isolation_point: string
  energy_type: string
  procedure_ref: string
  labelled: boolean
  last_audit: string
  next_audit: string
  notes: string
}
export function lotoStatus(p: Pick<LotoPoint, 'next_audit' | 'labelled'>): LotoStatus {
  if (!p.labelled) return 'overdue'
  if (!p.next_audit) return 'due'
  const d = daysUntil(p.next_audit)
  if (d === null) return 'due'
  if (d < 0) return 'overdue'
  if (d <= 30) return 'due'
  return 'compliant'
}
const loto = (
  id: string, branch: BranchCode, asset: string, code: string, point: string, energy: string, ref: string, labelled: boolean, last: string, next: string,
): LotoPoint => ({ id, branch, asset, label_code: code, isolation_point: point, energy_type: energy, procedure_ref: ref, labelled, last_audit: last, next_audit: next, notes: '', ...audit })

const LOTO_SEED: LotoPoint[] = [
  loto('LO1', 'trident', 'Workshop hoist #1', 'LOTO-T-001', 'Main electrical isolator', 'electrical', 'SOP-LOTO-01', true, '2026-05-01', '2026-08-01'),
  loto('LO2', 'trident', 'Workshop hoist #2', 'LOTO-T-002', 'Hydraulic ram lock', 'hydraulic', 'SOP-LOTO-02', true, '2026-03-15', '2026-06-15'),
  loto('LO3', 'trident', 'Air compressor', 'LOTO-T-003', 'Pneumatic line valve', 'pneumatic', 'SOP-LOTO-03', false, '2026-02-01', '2026-05-01'),
  loto('LO4', 'trident', 'Fuel transfer pump', 'LOTO-T-004', 'Pump breaker', 'electrical', 'SOP-LOTO-04', true, '2026-06-01', '2026-09-01'),
  loto('LO5', 'kansanshi', 'Tyre bay press', 'LOTO-K-001', 'Stored-energy spring lock', 'stored', 'SOP-LOTO-05', true, '2026-04-20', '2026-07-20'),
  loto('LO6', 'kansanshi', 'Wash bay pump', 'LOTO-K-002', 'Electrical isolator', 'electrical', 'SOP-LOTO-06', true, '2026-03-01', '2026-06-01'),
]

// ════════════════════════════════════════════════════════════════════════
// Tool inspections
// ════════════════════════════════════════════════════════════════════════
export type ToolCondition = 'good' | 'fair' | 'defective'
export const TOOL_CONDITION_META: Record<ToolCondition, { label: string; tone: StatusTone }> = {
  good: { label: 'Good', tone: 'good' },
  fair: { label: 'Fair', tone: 'warning' },
  defective: { label: 'Defective', tone: 'critical' },
}
export interface ToolInspection extends Audited {
  branch: BranchCode
  asset_tag: string
  tool_name: string
  category: string
  condition: ToolCondition
  safe_to_use: boolean
  last_inspection: string
  next_inspection: string
  inspector: string
  notes: string
}
/** A tool inspection is "due" when next_inspection is within 30 days / past. */
export function inspectionDue(t: Pick<ToolInspection, 'next_inspection'>): boolean {
  if (!t.next_inspection) return true
  const d = daysUntil(t.next_inspection)
  return d === null || d <= 30
}
const tool = (
  id: string, branch: BranchCode, tag: string, name: string, category: string, condition: ToolCondition, safe: boolean, last: string, next: string, inspector: string,
): ToolInspection => ({ id, branch, asset_tag: tag, tool_name: name, category, condition, safe_to_use: safe, last_inspection: last, next_inspection: next, inspector, notes: '', ...audit })

const TOOL_SEED: ToolInspection[] = [
  tool('TL1', 'trident', 'TT-001', 'Trolley jack (3T)', 'Lifting', 'good', true, '2026-06-01', '2026-09-01', 'Workshop Supervisor'),
  tool('TL2', 'trident', 'TT-002', 'Impact wrench', 'Power tool', 'fair', true, '2026-05-10', '2026-06-25', 'Workshop Supervisor'),
  tool('TL3', 'trident', 'TT-003', 'Angle grinder', 'Power tool', 'defective', false, '2026-05-20', '2026-05-20', 'Workshop Supervisor'),
  tool('TL4', 'trident', 'TT-004', 'Hydraulic press', 'Lifting', 'good', true, '2026-04-15', '2026-07-15', 'Workshop Supervisor'),
  tool('TL5', 'kansanshi', 'KT-001', 'Trolley jack (5T)', 'Lifting', 'good', true, '2026-06-05', '2026-09-05', 'Workshop Supervisor'),
  tool('TL6', 'kansanshi', 'KT-002', 'Torque wrench', 'Hand tool', 'fair', true, '2026-03-01', '2026-06-15', 'Workshop Supervisor'),
]

// ── Stores + hooks ──────────────────────────────────────────────────────
export const complianceStore = makeStore<Credential>('inzu_safety_compliance', COMPLIANCE_SEED)
export const trainingStore = makeStore<Credential>('inzu_safety_training', TRAINING_SEED)
export const hazardsStore = makeStore<Hazard>('inzu_safety_hazards', HAZARD_SEED)
export const capStore = makeStore<CapFinding>('inzu_safety_cap', CAP_SEED)
export const lotoStore = makeStore<LotoPoint>('inzu_safety_loto', LOTO_SEED)
export const toolsStore = makeStore<ToolInspection>('inzu_safety_tools', TOOL_SEED)

export const useCompliance = () => useSyncExternalStore(complianceStore.subscribe, complianceStore.snapshot, complianceStore.snapshot)
export const useTraining = () => useSyncExternalStore(trainingStore.subscribe, trainingStore.snapshot, trainingStore.snapshot)
export const useHazards = () => useSyncExternalStore(hazardsStore.subscribe, hazardsStore.snapshot, hazardsStore.snapshot)
export const useCap = () => useSyncExternalStore(capStore.subscribe, capStore.snapshot, capStore.snapshot)
export const useLoto = () => useSyncExternalStore(lotoStore.subscribe, lotoStore.snapshot, lotoStore.snapshot)
export const useTools = () => useSyncExternalStore(toolsStore.subscribe, toolsStore.snapshot, toolsStore.snapshot)
