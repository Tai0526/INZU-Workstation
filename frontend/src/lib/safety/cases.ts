import { useSyncExternalStore } from 'react'
import type { BranchCode } from '@/lib/roles'
import { getActor } from '@/lib/audit/actor'
import type { StatusTone } from '@/components/ui/StatusBadge'
import { deductionsStore } from '@/lib/payroll/deductions'
import { speedStore } from '@/lib/speed/store'
import { createSyncTable } from '@/lib/supabase/syncTable'

/**
 * Safety incidents. Two sources feed the same workflow:
 *   • speed  — a tracker confirms a speeding event and escalates it with a
 *              recommended charge.
 *   • manual — Safety registers an incident directly (near miss, accident,
 *              injury, environmental, misconduct, …).
 *
 * Flow: Safety investigates (speaks to the driver, writes a report, attaches the
 * charge statement / exculpatory / memo) and PROPOSES a verdict → the Operations
 * Manager APPROVES or REJECTS it. On approval, if a fine is included the Ops
 * Manager sets the amount, attaches the fine documentation, and (optionally)
 * pushes it to payroll as a deduction.
 */

export type CaseStage = 'safety_review' | 'ops_review' | 'closed'

export const CASE_STAGE_META: Record<CaseStage, { label: string; tone: StatusTone }> = {
  safety_review: { label: 'With Safety', tone: 'warning' },
  ops_review: { label: 'Awaiting Ops decision', tone: 'warning' },
  closed: { label: 'Closed', tone: 'good' },
}

/**
 * The incident moves through a fixed sequence of process steps. The current
 * stage maps onto a step so the UI can show "which part of the process it's at".
 */
export const CASE_STEPS = ['Reported', 'Safety review', 'Ops decision', 'Closed'] as const
export type CaseStep = (typeof CASE_STEPS)[number]

/** Index of the step the case is currently *working on* (0-based). */
export function currentStepIndex(stage: CaseStage): number {
  return stage === 'safety_review' ? 1 : stage === 'ops_review' ? 2 : 3
}

// ── Incident sources & types ───────────────────────────────────────────
export type IncidentSource = 'speed' | 'manual'
export type IncidentType =
  | 'speeding' | 'near_miss' | 'accident' | 'injury' | 'property_damage'
  | 'environmental' | 'misconduct' | 'fatigue' | 'other'

export const INCIDENT_TYPE_META: Record<IncidentType, { label: string; tone: StatusTone }> = {
  speeding: { label: 'Speeding', tone: 'critical' },
  near_miss: { label: 'Near miss', tone: 'warning' },
  accident: { label: 'Accident / collision', tone: 'critical' },
  injury: { label: 'Injury', tone: 'critical' },
  property_damage: { label: 'Property damage', tone: 'warning' },
  environmental: { label: 'Environmental', tone: 'warning' },
  misconduct: { label: 'Misconduct', tone: 'critical' },
  fatigue: { label: 'Fatigue', tone: 'warning' },
  other: { label: 'Other', tone: 'neutral' },
}
/** Manual incident types Safety can register (everything except auto-raised speeding). */
export const MANUAL_INCIDENT_TYPES = (Object.keys(INCIDENT_TYPE_META) as IncidentType[]).filter((t) => t !== 'speeding')

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical'
export const SEVERITY_META: Record<IncidentSeverity, { label: string; tone: StatusTone }> = {
  low: { label: 'Low', tone: 'good' },
  medium: { label: 'Medium', tone: 'warning' },
  high: { label: 'High', tone: 'critical' },
  critical: { label: 'Critical', tone: 'critical' },
}

// Verdict options the Ops Manager can approve (multi-select).
export type Decision = 'counselling' | 'verbal_warning' | 'written_warning' | 'final_written_warning' | 'fine' | 'dismissal' | 'cleared'
export const DECISION_LABEL: Record<Decision, string> = {
  counselling: 'Counselling memo',
  verbal_warning: 'Verbal warning',
  written_warning: 'Written warning',
  final_written_warning: 'Final written warning',
  fine: 'Fine',
  dismissal: 'Dismissal',
  cleared: 'Cleared — no action',
}

export interface CaseFile { file_id: string; file_name: string }

/** Safety's proposed outcome, sent to Ops for a decision. */
export interface Proposal {
  decisions: Decision[]
  fine_amount: number
  proposed_by: string
  proposed_at: string
}

/** The Ops Manager's final decision on Safety's proposal. */
export interface Verdict {
  outcome: 'approved' | 'rejected'
  decisions: Decision[]
  fine_amount: number
  fine_file: CaseFile | null // fine documentation
  to_payroll: boolean // fine pushed to payroll as a deduction
  notes: string
  decided_by: string
  decided_at: string
}

/** A single entry in the case's audit trail. */
export interface CaseEvent {
  at: string
  by: string
  action: string
  detail?: string
}

export interface DisciplinaryCase {
  id: string
  branch: BranchCode
  source: IncidentSource
  incident_type: IncidentType
  event_id: string // '' for manual incidents
  // who/what/where
  driver_id: string
  driver_name: string
  vehicle_label: string
  route: string // location / route / area
  event_datetime: string
  // descriptive (manual incidents)
  title: string
  description: string
  severity: IncidentSeverity | ''
  // speed-specific recommendation snapshot (optional)
  over_by?: number
  recorded_speed?: number
  speed_limit?: number
  rec_band?: string
  rec_action?: string
  rec_fine?: number
  rec_offence?: number
  repeat_total?: number
  // safety investigation
  charge_statement: CaseFile | null
  exculpatory: CaseFile | null
  memo: CaseFile | null
  incident_report: CaseFile | null // report for near-miss / accident / etc.
  safety_report: string // findings after speaking with the driver
  safety_notes: string
  proposal: Proposal | null
  // ops decision
  verdict: Verdict | null
  stage: CaseStage
  // chronological audit trail — every action taken on the case
  trail: CaseEvent[]
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

const KEY = 'inzu_disciplinary_cases'

const { load, commit, subscribe } = createSyncTable<DisciplinaryCase>({ table: 'disciplinary_cases', lsKey: KEY, seed: [] })
function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `c_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}
const stamp = () => new Date().toISOString()

const baseDefaults = () => ({
  title: '', description: '', severity: '' as const,
  charge_statement: null, exculpatory: null, memo: null, incident_report: null,
  safety_report: '', safety_notes: '', proposal: null, verdict: null,
  stage: 'safety_review' as CaseStage,
})

// Speeding escalation (from the tracker, with a recommended charge).
export interface NewCaseInput {
  branch: BranchCode
  event_id: string
  driver_id: string
  driver_name: string
  vehicle_label: string
  route: string
  event_datetime: string
  over_by: number
  recorded_speed: number
  speed_limit: number
  rec_band: string
  rec_action: string
  rec_fine: number
  rec_offence: number
  repeat_total: number
}

// Safety-registered incident (near miss, accident, …).
export interface ManualIncidentInput {
  branch: BranchCode
  incident_type: IncidentType
  title: string
  description: string
  route: string // location
  event_datetime: string
  driver_id: string
  driver_name: string
  vehicle_label: string
  severity: IncidentSeverity | ''
  incident_report?: CaseFile | null
}

export const casesStore = {
  list: (): DisciplinaryCase[] => load(),

  forEvent(eventId: string): DisciplinaryCase | undefined {
    return load().find((c) => c.event_id === eventId)
  },

  /** Past closed cases for a driver — precedent for the next verdict. */
  historyForDriver(driverId: string, driverName: string, exceptId?: string): DisciplinaryCase[] {
    return load()
      .filter((c) => c.id !== exceptId && c.stage === 'closed' && (driverId ? c.driver_id === driverId : c.driver_name === driverName))
      .sort((a, b) => b.event_datetime.localeCompare(a.event_datetime))
  },

  /** Raise a disciplinary case from a confirmed speed event. */
  create(input: NewCaseInput): DisciplinaryCase {
    const now = stamp()
    const who = getActor().name
    const c: DisciplinaryCase = {
      ...baseDefaults(), ...input, id: newId(), source: 'speed', incident_type: 'speeding',
      title: `Speeding — ${input.driver_name}`,
      trail: [{
        at: now, by: who, action: 'Escalated from speed event',
        detail: `Confirmed ${input.over_by} km/h over → recommended ${input.rec_action}${input.rec_fine ? ` · K${input.rec_fine.toLocaleString()}` : ''}. Routed to Safety.`,
      }],
      created_by: who, created_at: now, updated_by: who, updated_at: now,
    }
    commit([...load(), c])
    return c
  },

  /** Register an incident directly in Safety (not from a speed event). */
  createManual(input: ManualIncidentInput): DisciplinaryCase {
    const now = stamp()
    const who = getActor().name
    const c: DisciplinaryCase = {
      ...baseDefaults(), id: newId(), source: 'manual', event_id: '',
      branch: input.branch, incident_type: input.incident_type,
      title: input.title, description: input.description, severity: input.severity,
      driver_id: input.driver_id, driver_name: input.driver_name, vehicle_label: input.vehicle_label,
      route: input.route, event_datetime: input.event_datetime, incident_report: input.incident_report ?? null,
      trail: [{
        at: now, by: who, action: 'Incident registered',
        detail: `${INCIDENT_TYPE_META[input.incident_type].label}${input.driver_name ? ` · ${input.driver_name}` : ''}. Logged by Safety for investigation.`,
      }],
      created_by: who, created_at: now, updated_by: who, updated_at: now,
    }
    commit([...load(), c])
    return c
  },

  update(id: string, patch: Partial<DisciplinaryCase>) {
    const who = getActor().name
    commit(load().map((c) => (c.id === id ? { ...c, ...patch, id: c.id, updated_by: who, updated_at: stamp() } : c)))
  },

  /** Append an audit-trail entry (stamped with the current actor + time). */
  log(id: string, action: string, detail?: string) {
    const who = getActor().name
    commit(load().map((c) => (c.id === id
      ? { ...c, trail: [...(c.trail ?? []), { at: stamp(), by: who, action, detail }], updated_by: who, updated_at: stamp() }
      : c)))
  },

  /** Safety forwards the case to Ops with a proposed verdict. */
  sendToOps(id: string, proposal: Omit<Proposal, 'proposed_by' | 'proposed_at'>) {
    const who = getActor().name
    const labels = proposal.decisions.map((d) => DECISION_LABEL[d]).join(', ') || 'no action'
    casesStore.update(id, {
      stage: 'ops_review',
      proposal: { ...proposal, proposed_by: who, proposed_at: stamp() },
    })
    casesStore.log(id, 'Proposed verdict sent to Ops', `${labels}${proposal.fine_amount ? ` · proposed fine K${proposal.fine_amount.toLocaleString()}` : ''}`)
  },

  /** Ops approves Safety's proposal (optionally adjusting the fine + attaching docs). */
  approve(id: string, v: Omit<Verdict, 'outcome' | 'decided_by' | 'decided_at'>) {
    const who = getActor().name
    const c = load().find((x) => x.id === id)
    const labels = v.decisions.map((d) => DECISION_LABEL[d]).join(', ')
    casesStore.update(id, { verdict: { ...v, outcome: 'approved', decided_by: who, decided_at: stamp() }, stage: 'closed' })
    casesStore.log(id, 'Verdict approved — case closed', `${labels}${v.fine_amount ? ` · fine K${v.fine_amount.toLocaleString()}` : ''}${v.to_payroll && v.fine_amount ? ' · sent to payroll' : ''}`)
    if (c?.source === 'speed' && c.event_id) speedStore.setStatus(c.event_id, 'closed') // resolve the originating speed event
    // Push the fine to payroll as a pending deduction.
    if (v.fine_amount > 0 && v.to_payroll && c) {
      deductionsStore.add({
        branch: c.branch, driver_id: c.driver_id, driver_name: c.driver_name,
        amount: v.fine_amount, reason: `${INCIDENT_TYPE_META[c.incident_type].label} fine`,
        incident_id: c.id, date: stamp().slice(0, 10), status: 'pending',
      })
      casesStore.log(id, 'Fine queued for payroll', `K${v.fine_amount.toLocaleString()} to be deducted from ${c.driver_name || 'the driver'}.`)
    }
  },

  /** Ops rejects Safety's proposal. */
  reject(id: string, reason: string) {
    const who = getActor().name
    const c = load().find((x) => x.id === id)
    casesStore.update(id, {
      verdict: { outcome: 'rejected', decisions: [], fine_amount: 0, fine_file: null, to_payroll: false, notes: reason, decided_by: who, decided_at: stamp() },
      stage: 'closed',
    })
    casesStore.log(id, 'Verdict rejected — case closed', reason || 'Ops rejected the proposed verdict.')
    if (c?.source === 'speed' && c.event_id) speedStore.setStatus(c.event_id, 'closed') // resolve the originating speed event
  },

  remove(id: string) {
    commit(load().filter((c) => c.id !== id))
  },
}

export function useCases(): DisciplinaryCase[] {
  return useSyncExternalStore(subscribe, load, load)
}
