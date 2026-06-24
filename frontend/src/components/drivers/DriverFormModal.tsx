import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useAuth } from '@/auth/AuthContext'
import { BRANCHES, type BranchCode } from '@/lib/roles'
import { SECTIONS } from '@/lib/org/sections'
import { driversStore } from '@/lib/drivers/store'
import { type Driver, type DriverInput, type DriverStatus } from '@/lib/drivers/types'
import { schedulingStore, useScheduling } from '@/lib/drivers/scheduling'
import { driverShiftsStore } from '@/lib/drivers/driverShifts'
import { isContinuousSection, crewPhaseIndex } from '@/lib/drivers/schedule'

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-navy">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-status-neutral">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

const STATUS_LABEL: Record<DriverStatus, string> = { active: 'Active', on_leave: 'On leave', suspended: 'Suspended' }

const empty = (branch: BranchCode): DriverInput => ({
  employee_no: '', full_name: '', branch, phone: '', licence_no: '', licence_class: 'C1',
  licence_expiry: '', psv_expiry: '', date_hired: '',
  crew: schedulingStore.get().crews[0]?.id ?? 'A', section: SECTIONS[branch][0], status: 'active', overtime: false, photo_file_id: '', notes: '',
})

export default function DriverFormModal({
  open, onClose, editing, lockedBranch, activeBranch,
}: {
  open: boolean
  onClose: () => void
  editing: Driver | null
  lockedBranch: BranchCode | null
  activeBranch: BranchCode
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'administrator'
  const sched = useScheduling()
  const [form, setForm] = useState<DriverInput | Driver>(() => (editing ? { ...editing } : empty(lockedBranch ?? activeBranch)))
  const [error, setError] = useState('')
  const [shiftId, setShiftId] = useState<string>(() => (editing ? driverShiftsStore.shiftFor(editing.id) : ''))

  const key = (editing?.id ?? 'new') + String(open)
  const [lastKey, setLastKey] = useState('')
  if (open && key !== lastKey) {
    setForm(editing ? { ...editing } : empty(lockedBranch ?? activeBranch))
    setShiftId(editing ? driverShiftsStore.shiftFor(editing.id) : '')
    setError('')
    setLastKey(key)
  }
  // Section-driven crew options: continuous shows each crew's live Day/Night/Off;
  // 7/7 shows each crew × Day/Afternoon with the live (on)/(off). Value encodes both.
  const todayISO = new Date().toISOString().slice(0, 10)
  const cont = isContinuousSection(form.section)
  const PHASE = ['Day', 'Night', 'Off']
  const crewOpts = cont
    ? sched.crews.map((c) => ({ value: c.id, label: `Crew ${c.label} · ${PHASE[crewPhaseIndex(form.section, c.id, todayISO)]}` }))
    : sched.crews.slice(0, 2).flatMap((c) => {
        const on = crewPhaseIndex(form.section, c.id, todayISO) === 0 ? 'on' : 'off'
        return [
          { value: `${c.id}__day`, label: `Crew ${c.label} · Day (${on})` },
          { value: `${c.id}__afternoon`, label: `Crew ${c.label} · Afternoon (${on})` },
        ]
      })
  const crewVal = cont ? form.crew : `${form.crew}__${shiftId === 'afternoon' ? 'afternoon' : 'day'}`
  function onCrewChange(v: string) {
    if (cont) { set('crew', v); setShiftId('') }
    else { const [cid, blk] = v.split('__'); set('crew', cid); setShiftId(blk === 'afternoon' ? 'afternoon' : 'day') }
  }
  function onSectionChange(v: string) {
    setForm((f) => {
      let crew = f.crew
      if (!isContinuousSection(v) && !sched.crews.slice(0, 2).some((c) => c.id === crew)) crew = sched.crews[0]?.id ?? 'A'
      return { ...f, section: v, crew }
    })
    setShiftId((prev) => (isContinuousSection(v) ? '' : (prev === 'afternoon' ? 'afternoon' : 'day')))
  }

  function set<K extends keyof Driver>(k: K, v: Driver[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v }
      // keep section valid when branch changes
      if (k === 'branch' && !SECTIONS[v as BranchCode].includes(next.section)) next.section = SECTIONS[v as BranchCode][0]
      return next
    })
  }

  function save() {
    const full_name = form.full_name.trim()
    const employee_no = form.employee_no.trim()
    if (!full_name) return setError('Driver name is required.')
    if (!employee_no) return setError('Employee number is required.')
    if (driversStore.conflict(employee_no, editing?.id)) return setError(`Employee number "${employee_no}" already exists.`)

    const payload = { ...form, full_name, employee_no }
    // Morning/Afternoon only applies to 7/7 split sections; continuous rotates by crew.
    const blockShift = isContinuousSection(form.section) ? undefined : (shiftId || 'day')
    if (editing) { driversStore.update(editing.id, payload); driverShiftsStore.set(editing.id, blockShift) }
    else { const created = driversStore.add(payload); driverShiftsStore.set(created.id, blockShift) }
    onClose()
  }

  // Deleting a driver record is restricted to the administrator.
  function removeDriver() {
    if (!editing) return
    if (!window.confirm(`Delete ${editing.full_name}? This permanently removes the driver record and cannot be undone.`)) return
    driversStore.remove(editing.id)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${editing.full_name}` : 'Add driver'}
      subtitle="Section sets the rotation; pick the crew (with Day/Afternoon for 7-on/7-off)."
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {editing && isAdmin
            ? <Button variant="danger" onClick={removeDriver}>Delete driver</Button>
            : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={save}>{editing ? 'Save changes' : 'Add driver'}</Button>
          </div>
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name *">
          <input className={inputCls} value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
        </Field>
        <Field label="Employee no. *">
          <input className={inputCls} placeholder="INZ-D101" value={form.employee_no} onChange={(e) => set('employee_no', e.target.value)} />
        </Field>

        <Field label="Branch">
          <select className={inputCls} value={form.branch} disabled={!!lockedBranch} onChange={(e) => set('branch', e.target.value as BranchCode)}>
            {BRANCHES.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
          </select>
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>

        <Field label="Section">
          <select className={inputCls} value={form.section} onChange={(e) => onSectionChange(e.target.value)}>
            {SECTIONS[form.branch].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Crew" hint={cont ? 'Rotates Day → Night → Off automatically' : 'Crews A & B alternate weekly; Day = morning block, Afternoon runs to ~02:00'}>
          <select className={inputCls} value={crewVal} onChange={(e) => onCrewChange(e.target.value)}>
            {crewOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>

        <Field label="Status">
          <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value as DriverStatus)}>
            {(Object.keys(STATUS_LABEL) as DriverStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Date hired">
          <input type="date" className={inputCls} value={form.date_hired} onChange={(e) => set('date_hired', e.target.value)} />
        </Field>

        <Field label="Licence no.">
          <input className={inputCls} value={form.licence_no} onChange={(e) => set('licence_no', e.target.value)} />
        </Field>
        <Field label="Licence class">
          <input className={inputCls} value={form.licence_class} onChange={(e) => set('licence_class', e.target.value)} />
        </Field>

        <Field label="Licence expiry">
          <input type="date" className={inputCls} value={form.licence_expiry} onChange={(e) => set('licence_expiry', e.target.value)} />
        </Field>
        <Field label="PSV permit expiry">
          <input type="date" className={inputCls} value={form.psv_expiry} onChange={(e) => set('psv_expiry', e.target.value)} />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Notes">
            <textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </div>

      {editing && (
        <div className="mt-4 rounded-lg bg-canvas px-3 py-2 text-[11px] text-status-neutral">
          Added by <span className="font-medium text-navy">{editing.created_by}</span> on {new Date(editing.created_at).toLocaleDateString()} · Last updated by{' '}
          <span className="font-medium text-navy">{editing.updated_by}</span> on {new Date(editing.updated_at).toLocaleString()}
        </div>
      )}
    </Modal>
  )
}
