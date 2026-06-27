import { useSyncExternalStore } from 'react'
import { getActor } from '@/lib/audit/actor'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import { vehiclesStore } from '@/lib/fleet/store'
import { type JobCard, type JobCardInput, type MechShift, DEFAULT_MECH_SHIFT } from './types'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `jc_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}
const stampNow = () => new Date().toISOString()
const who = () => getActor().name

// Job cards live in app_config (a single jsonb list), NOT a dedicated table —
// the live DB has no workshop_jobcards table, and writing to a missing table
// would fail the upsert and silently revert. (See the sync-schema gotcha.)
const jcCfg = createSyncConfig<JobCard[]>({ key: 'workshop_jobcards', lsKey: 'inzu_workshop_jobcards', default: [] })

export const jobCardsStore = {
  list: () => jcCfg.get(),
  subscribe: jcCfg.subscribe,
  snapshot: () => jcCfg.get(),
  add(data: JobCardInput): JobCard {
    const now = stampNow()
    const jc: JobCard = { ...data, id: newId(), created_by: who(), created_at: now, updated_by: who(), updated_at: now }
    jcCfg.set([...jcCfg.get(), jc])
    return jc
  },
  update(id: string, patch: Partial<JobCard>) {
    jcCfg.set(jcCfg.get().map((x) => (x.id === id ? { ...x, ...patch, id: x.id, updated_by: who(), updated_at: stampNow() } : x)))
  },
  remove(id: string) { jcCfg.set(jcCfg.get().filter((x) => x.id !== id)) },
}
export const useJobCards = () => useSyncExternalStore(jcCfg.subscribe, jcCfg.get, jcCfg.get)

// Set a vehicle's status by fleet number within a branch. `vehicles.status` is a
// real column on the existing table, so this persists (and the notifications
// feed already alerts planners/everyone when a bus is under repair / grounded).
function setVehicleStatus(branch: string, fleet_no: string, status: 'active' | 'under_repair' | 'grounded') {
  const v = vehiclesStore.list().find((x) => x.branch === branch && x.fleet_no === fleet_no)
  if (v && v.status !== status) vehiclesStore.update(v.id, { status })
}

/** Raise a job card — the bus goes into the workshop (or grounded) immediately. */
export function raiseJobCard(input: JobCardInput): JobCard {
  const jc = jobCardsStore.add({ ...input, status: 'open', reported_by: who(), reported_at: stampNow() })
  setVehicleStatus(input.branch, input.fleet_no, input.vehicle_status)
  return jc
}

/** Supervisor marks the repair complete → awaits the Asst Ops Manager's sign-off. */
export function submitForSignoff(id: string, work_done: string) {
  jobCardsStore.update(id, { status: 'awaiting_approval', work_done: work_done.trim(), completed_by: who(), completed_at: stampNow() })
}

/** Asst Ops decision: approve → bus back in service & card closed; reject → back to the workshop. */
export function decideJob(id: string, approve: boolean, note = '') {
  const jc = jobCardsStore.list().find((x) => x.id === id)
  if (!jc) return
  if (approve) {
    jobCardsStore.update(id, { status: 'closed', approved_by: who(), approved_at: stampNow(), rejected_note: '' })
    setVehicleStatus(jc.branch, jc.fleet_no, 'active')
  } else {
    jobCardsStore.update(id, { status: 'open', rejected_note: note.trim(), approved_by: '', approved_at: '', completed_by: '', completed_at: '' })
  }
}

/** Reopen a closed card — the bus goes back into the workshop. */
export function reopenJob(id: string) {
  const jc = jobCardsStore.list().find((x) => x.id === id)
  if (!jc) return
  jobCardsStore.update(id, { status: 'open', completed_by: '', completed_at: '', approved_by: '', approved_at: '' })
  setVehicleStatus(jc.branch, jc.fleet_no, jc.vehicle_status)
}

/** Remove a card. If the bus is still in the workshop because of it, return it to service. */
export function removeJob(id: string) {
  const jc = jobCardsStore.list().find((x) => x.id === id)
  if (jc && jc.status !== 'closed') setVehicleStatus(jc.branch, jc.fleet_no, 'active')
  jobCardsStore.remove(id)
}

// ── Mechanics work / rest schedule (per employee id) ────────────────────
const mechCfg = createSyncConfig<Record<string, MechShift>>({ key: 'mechanic_schedules', lsKey: 'inzu_mechanic_schedules', default: {} })
export const mechScheduleStore = {
  get: () => mechCfg.get(),
  subscribe: mechCfg.subscribe,
  for: (empId: string): MechShift => mechCfg.get()[empId] ?? DEFAULT_MECH_SHIFT,
  set(empId: string, shift: MechShift) { mechCfg.set({ ...mechCfg.get(), [empId]: shift }) },
}
export const useMechSchedules = () => useSyncExternalStore(mechCfg.subscribe, mechCfg.get, mechCfg.get)

/** Is a mechanic working on a given date, per their weekly pattern? */
export function mechWorksOn(empId: string, date: Date): boolean {
  return mechScheduleStore.for(empId).workdays.includes(date.getDay())
}
