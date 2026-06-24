import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useAuth } from '@/auth/AuthContext'
import { BRANCHES, type BranchCode } from '@/lib/roles'
import { SECTIONS } from '@/lib/org/sections'
import { driversStore } from '@/lib/drivers/store'
import { type Driver, type DriverInput, type Crew, type DriverStatus, patternFor, shiftWindow } from '@/lib/drivers/types'
import { schedulingStore, useScheduling, crewLabel, crewShiftLabel, crewShiftKind, shiftTime, shiftKindOf } from '@/lib/drivers/scheduling'
import { driverShiftsStore } from '@/lib/drivers/driverShifts'
import { isContinuousSection } from '@/lib/drivers/schedule'

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
  const selShift = sched.shifts.find((s) => s.id === shiftId)

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
    const blockShift = isContinuousSection(form.section) ? undefined : (shiftId || undefined)
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
      subtitle="Crew sets the shift pattern; section is the area this driver runs."
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

        <Field label="Crew" hint={`Crew ${crewLabel(sched, form.crew)} → ${crewShiftLabel(sched, form.crew) || 'no set shift'} · roster ${shiftWindow(patternFor(form.branch, form.section), crewShiftKind(sched, form.crew))}`}>
          <select className={inputCls} value={form.crew} onChange={(e) => set('crew', e.target.value as Crew)}>
            {sched.crews.map((c) => (
              <option key={c.id} value={c.id}>Crew {c.label}{crewShiftLabel(sched, c.id) ? ` · ${crewShiftLabel(sched, c.id)}` : ''}</option>
            ))}
          </select>
        </Field>
        {isContinuousSection(form.section) ? (
          <Field label="Shift / block" hint="Continuous section — day/night rotates by crew">
            <div className={`${inputCls} bg-canvas text-status-neutral`}>A Day · B Night · C Off (auto-rotates)</div>
          </Field>
        ) : (
          <Field label="Shift / block" hint={selShift ? `${shiftKindOf(selShift) === 'night' ? 'Counts as night' : 'Counts as day'}${shiftTime(selShift) ? ` · ${shiftTime(selShift)}` : ''}` : 'Follows the crew’s shift'}>
            <select className={inputCls} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              <option value="">Use crew default</option>
              {sched.shifts.map((s) => <option key={s.id} value={s.id}>{s.label}{shiftTime(s) ? ` · ${shiftTime(s)}` : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label="Section">
          <select className={inputCls} value={form.section} onChange={(e) => set('section', e.target.value)}>
            {SECTIONS[form.branch].map((s) => <option key={s} value={s}>{s}</option>)}
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
