import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import { vehiclesStore } from '@/lib/fleet/store'
import {
  type JobCard, type JobCardInput, type JobFile, type JobSeverity, type JobCategory, SEVERITY_META,
  type Checklist, type TyreRecord, type Spare, type Rca,
  type PmConfig, DEFAULT_PM, type MechCrew, type MechShiftKind, DEFAULT_MECH_CREWS, crewOnDate,
  type MonthlyInspection, type MonthlyInspectionInput,
} from './types'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `wk_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}
const stampNow = () => new Date().toISOString()
const who = () => getActor().name

// All workshop records live in app_config (single jsonb lists / maps), NOT
// dedicated tables — the live DB has none, and writing to a missing table would
// fail the upsert and silently revert. (See the sync-schema gotcha.)
type WithAudit = { id: string; created_by: string; created_at: string; updated_by: string; updated_at: string }
function makeConfigList<T extends WithAudit>(key: string, lsKey: string) {
  const cfg = createSyncConfig<T[]>({ key, lsKey, default: [] })
  return {
    get: cfg.get,
    subscribe: cfg.subscribe,
    list: () => cfg.get(),
    add(data: Omit<T, keyof WithAudit>): T {
      const now = stampNow()
      const item = { ...(data as object), id: newId(), created_by: who(), created_at: now, updated_by: who(), updated_at: now } as T
      cfg.set([...cfg.get(), item]); return item
    },
    update(id: string, patch: Partial<T>) {
      cfg.set(cfg.get().map((x) => (x.id === id ? { ...x, ...patch, id: x.id, updated_by: who(), updated_at: stampNow() } : x)))
    },
    remove(id: string) { cfg.set(cfg.get().filter((x) => x.id !== id)) },
  }
}

// ── Job cards ───────────────────────────────────────────────────────────
export const jobCardsStore = makeConfigList<JobCard>('workshop_jobcards', 'inzu_workshop_jobcards')
export const useJobCards = () => useSyncExternalStore(jobCardsStore.subscribe, jobCardsStore.get, jobCardsStore.get)

/** Append an audit-trail entry to a job card (stamped with actor + time). */
export function logJob(id: string, action: string, detail?: string) {
  const jc = jobCardsStore.list().find((x) => x.id === id)
  jobCardsStore.update(id, { trail: [...(jc?.trail ?? []), { at: stampNow(), by: who(), action, detail }] })
}
/** Attach a scanned/photographed physical job card (proof of the work). */
export function addJobFile(id: string, file: { id: string; name: string }) {
  const jc = jobCardsStore.list().find((x) => x.id === id)
  const rec: JobFile = { id: file.id, name: file.name, at: stampNow(), by: who() }
  jobCardsStore.update(id, { card_files: [...(jc?.card_files ?? []), rec] })
  logJob(id, 'Job-card copy attached', file.name)
}
export function removeJobFile(id: string, fileId: string) {
  const jc = jobCardsStore.list().find((x) => x.id === id)
  const f = (jc?.card_files ?? []).find((x) => x.id === fileId)
  jobCardsStore.update(id, { card_files: (jc?.card_files ?? []).filter((x) => x.id !== fileId) })
  if (f) logJob(id, 'Job-card copy removed', f.name)
}

// Set a vehicle's status by fleet number within a branch. `vehicles.status` is a
// real column on the existing table, so this persists (and the notifications feed
// alerts planners/everyone when a bus is under repair / grounded).
function setVehicleStatus(branch: string, fleet_no: string, status: 'active' | 'under_repair' | 'grounded') {
  const v = vehiclesStore.list().find((x) => x.branch === branch && x.fleet_no === fleet_no)
  if (v && v.status !== status) vehiclesStore.update(v.id, { status })
}

/** Raise a job card — the bus goes into the workshop (or grounded) immediately. */
export function raiseJobCard(input: JobCardInput): JobCard {
  const jc = jobCardsStore.add({
    ...input, status: 'open', reported_by: who(), reported_at: stampNow(), card_files: [],
    trail: [{ at: stampNow(), by: who(), action: 'Job card raised', detail: `${SEVERITY_META[input.severity].label.replace(' — grounds the bus', '')} · ${input.fault}`.slice(0, 110) }],
  })
  setVehicleStatus(input.branch, input.fleet_no, input.vehicle_status)
  return jc
}

/** Raise a job card straight from a driver's checklist faults; links the two. */
export function raiseJobFromChecklist(c: Checklist, opts: { severity?: JobSeverity; mechanics?: string[] } = {}): JobCard {
  const faults = c.items.filter((i) => !i.ok)
  const tyre = faults.some((i) => i.tyre)
  const faultText = faults.map((i) => (i.note ? `${i.label}: ${i.note}` : i.label)).join('; ') || 'Checklist faults'
  const severity = opts.severity ?? 'major'
  const jc = raiseJobCard({
    branch: c.branch, fleet_no: c.fleet_no, reg_no: c.reg_no, driver_name: c.driver_name,
    fault: faultText, severity, category: tyre ? 'tyre' : 'mechanical',
    vehicle_status: SEVERITY_META[severity].grounds ? 'grounded' : 'under_repair',
    mechanics: opts.mechanics ?? [], status: 'open', work_done: '', reported_by: '', reported_at: '',
    completed_by: '', completed_at: '', approved_by: '', approved_at: '', rejected_note: '', notes: '', checklist_id: c.id,
  })
  checklistsStore.update(c.id, { job_ids: [...c.job_ids, jc.id] })
  return jc
}

/** Supervisor marks the repair complete → awaits the Asst Ops Manager's sign-off. */
export function submitForSignoff(id: string, work_done: string) {
  jobCardsStore.update(id, { status: 'awaiting_approval', work_done: work_done.trim(), completed_by: who(), completed_at: stampNow() })
  logJob(id, 'Marked repaired — submitted for sign-off', work_done.trim().slice(0, 110))
}

/** Asst Ops decision: approve → bus back in service & card closed; reject → back to the workshop. */
export function decideJob(id: string, approve: boolean, note = '') {
  const jc = jobCardsStore.list().find((x) => x.id === id)
  if (!jc) return
  if (approve) {
    jobCardsStore.update(id, { status: 'closed', approved_by: who(), approved_at: stampNow(), rejected_note: '' })
    setVehicleStatus(jc.branch, jc.fleet_no, 'active')
    logJob(id, 'Approved — signed back into service')
  } else {
    jobCardsStore.update(id, { status: 'open', rejected_note: note.trim(), approved_by: '', approved_at: '', completed_by: '', completed_at: '' })
    logJob(id, 'Sent back for more work', note.trim())
  }
}

/** Reopen a closed card — the bus goes back into the workshop. */
export function reopenJob(id: string) {
  const jc = jobCardsStore.list().find((x) => x.id === id)
  if (!jc) return
  jobCardsStore.update(id, { status: 'open', completed_by: '', completed_at: '', approved_by: '', approved_at: '' })
  setVehicleStatus(jc.branch, jc.fleet_no, jc.vehicle_status)
  logJob(id, 'Reopened — back into the workshop')
}

/** Remove a card. If the bus is still in the workshop because of it, return it to service. */
export function removeJob(id: string) {
  const jc = jobCardsStore.list().find((x) => x.id === id)
  if (jc && jc.status !== 'closed') setVehicleStatus(jc.branch, jc.fleet_no, 'active')
  jobCardsStore.remove(id)
}

// ── Daily checklists ────────────────────────────────────────────────────
export const checklistsStore = makeConfigList<Checklist>('workshop_checklists', 'inzu_workshop_checklists')
export const useChecklists = () => useSyncExternalStore(checklistsStore.subscribe, checklistsStore.get, checklistsStore.get)

// ── Tyre management ─────────────────────────────────────────────────────
export const tyresStore = makeConfigList<TyreRecord>('workshop_tyres', 'inzu_workshop_tyres')
export const useTyres = () => useSyncExternalStore(tyresStore.subscribe, tyresStore.get, tyresStore.get)

// ── Critical spares ─────────────────────────────────────────────────────
export const sparesStore = makeConfigList<Spare>('workshop_spares', 'inzu_workshop_spares')
export const useSpares = () => useSyncExternalStore(sparesStore.subscribe, sparesStore.get, sparesStore.get)

// ── Failure / RCA log ───────────────────────────────────────────────────
export const rcaStore = makeConfigList<Rca>('workshop_rca', 'inzu_workshop_rca')
export const useRca = () => useSyncExternalStore(rcaStore.subscribe, rcaStore.get, rcaStore.get)

// ── Monthly vehicle inspections (thorough, once per calendar month) ─────
export const inspectionsStore = makeConfigList<MonthlyInspection>('workshop_inspections', 'inzu_workshop_inspections')
export const useInspections = () => useSyncExternalStore(inspectionsStore.subscribe, inspectionsStore.get, inspectionsStore.get)

/** Append an audit-trail entry to a monthly inspection (stamped with actor + time). */
export function logInspection(id: string, action: string, detail?: string) {
  const it = inspectionsStore.list().find((x) => x.id === id)
  inspectionsStore.update(id, { trail: [...(it?.trail ?? []), { at: stampNow(), by: who(), action, detail }] })
}
/** Schedule a vehicle's monthly inspection — assign a mechanic on a date. */
export function scheduleInspection(input: MonthlyInspectionInput): MonthlyInspection {
  return inspectionsStore.add({
    ...input, status: 'scheduled',
    trail: [{ at: stampNow(), by: who(), action: 'Inspection scheduled', detail: `${input.mechanic || 'Unassigned'} · ${input.scheduled_date}` }],
  })
}
/** Reassign / reschedule an existing inspection (keeps the trail). */
export function rescheduleInspection(id: string, mechanic: string, scheduled_date: string) {
  inspectionsStore.update(id, { mechanic, scheduled_date })
  logInspection(id, 'Rescheduled', `${mechanic || 'Unassigned'} · ${scheduled_date}`)
}
/** Record the completed inspection (findings, result, odometer). */
export function completeInspection(id: string, patch: Partial<MonthlyInspection>) {
  inspectionsStore.update(id, { ...patch, status: 'done', done_date: patch.done_date || stampNow().slice(0, 10) })
  logInspection(id, 'Inspection completed', patch.result ?? '')
}
/** Raise a job card from an inspection finding; links it back to the inspection. */
export function raiseJobFromInspection(insp: MonthlyInspection, opts: { fault: string; severity?: JobSeverity; category?: JobCategory; mechanics?: string[] }): JobCard {
  const severity = opts.severity ?? 'major'
  const jc = raiseJobCard({
    branch: insp.branch, fleet_no: insp.fleet_no, reg_no: insp.reg_no, driver_name: '',
    fault: opts.fault, severity, category: opts.category ?? 'mechanical',
    vehicle_status: SEVERITY_META[severity].grounds ? 'grounded' : 'under_repair',
    mechanics: opts.mechanics ?? (insp.mechanic ? [insp.mechanic] : []), status: 'open', work_done: '',
    reported_by: '', reported_at: '', completed_by: '', completed_at: '', approved_by: '', approved_at: '',
    rejected_note: '', notes: `From ${insp.month} monthly inspection`, checklist_id: '',
  })
  const it = inspectionsStore.list().find((x) => x.id === insp.id)
  inspectionsStore.update(insp.id, { job_ids: [...(it?.job_ids ?? []), jc.id] })
  logInspection(insp.id, 'Job card raised from inspection', opts.fault.slice(0, 110))
  return jc
}

// ── PM / service schedules (per vehicle fleet_no) ───────────────────────
const pmCfg = createSyncConfig<Record<string, PmConfig>>({ key: 'workshop_pm', lsKey: 'inzu_workshop_pm', default: {} })
export const pmStore = {
  get: () => pmCfg.get(),
  subscribe: pmCfg.subscribe,
  for: (fleet_no: string): PmConfig => pmCfg.get()[fleet_no] ?? DEFAULT_PM,
  set(fleet_no: string, cfg: PmConfig) { pmCfg.set({ ...pmCfg.get(), [fleet_no]: cfg }) },
}
export const usePm = () => useSyncExternalStore(pmCfg.subscribe, pmCfg.get, pmCfg.get)
/** Record that a service was done (resets the clock). */
export function logService(fleet_no: string, date: string, odo: number, intervalDays?: number, notes = '') {
  const cur = pmStore.for(fleet_no)
  pmStore.set(fleet_no, { ...cur, interval_days: intervalDays || cur.interval_days, last_service_date: date, last_service_odo: odo, notes })
}

// ── Mechanics crews & roster (crew-based work/rest, like the drivers) ────
interface MechRoster { crews: MechCrew[]; assign: Record<string, string> } // employee id → crew id
const mechCfg = createSyncConfig<MechRoster>({
  key: 'mech_roster', lsKey: 'inzu_mech_roster', default: { crews: DEFAULT_MECH_CREWS, assign: {} },
  merge: (s) => ({ crews: s && Array.isArray(s.crews) && s.crews.length ? s.crews : DEFAULT_MECH_CREWS, assign: (s && s.assign) || {} }),
})
export const mechRosterStore = {
  get: () => mechCfg.get(),
  subscribe: mechCfg.subscribe,
  crews: () => mechCfg.get().crews,
  crewOf(empId: string): MechCrew | undefined { const r = mechCfg.get(); return r.crews.find((c) => c.id === r.assign[empId]) },
  assign(empId: string, crewId: string) {
    const r = mechCfg.get(); const assign = { ...r.assign }
    if (crewId) assign[empId] = crewId; else delete assign[empId]
    mechCfg.set({ ...r, assign })
  },
  addCrew(name: string, shift: MechShiftKind, start: string, onDays: number, offDays: number) { const r = mechCfg.get(); mechCfg.set({ ...r, crews: [...r.crews, { id: newId(), name, shift, start, onDays, offDays }] }) },
  updateCrew(id: string, patch: Partial<MechCrew>) { const r = mechCfg.get(); mechCfg.set({ ...r, crews: r.crews.map((c) => (c.id === id ? { ...c, ...patch } : c)) }) },
  removeCrew(id: string) { const r = mechCfg.get(); const assign = { ...r.assign }; for (const k of Object.keys(assign)) if (assign[k] === id) delete assign[k]; mechCfg.set({ crews: r.crews.filter((c) => c.id !== id), assign }) },
}
export const useMechRoster = () => useSyncExternalStore(mechCfg.subscribe, mechCfg.get, mechCfg.get)
/** The shift a mechanic works on a date (per their crew rotation), or null for rest / unassigned. */
export function mechShiftOnDate(empId: string, dateISO: string): MechShiftKind | null {
  const c = mechRosterStore.crewOf(empId)
  return c && crewOnDate(c, dateISO) ? c.shift : null
}
