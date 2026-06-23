import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { BRANCHES, type BranchCode } from '@/lib/roles'
import { vehiclesStore } from '@/lib/fleet/store'
import { type Vehicle, type VehicleInput, type VehicleStatus, type VehicleType, STATUS_META, TYPE_LABELS } from '@/lib/fleet/types'

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-navy">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-status-neutral">{hint}</span>}
    </label>
  )
}

const inputCls =
  'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

const empty = (branch: BranchCode): VehicleInput => ({
  fleet_no: '', reg_plate: '', make: 'Tata', model: '', year: null, type: 'bus',
  branch, status: 'active', capacity: null, colour: 'White', chassis_no: '', engine_no: '',
  in_service_date: '', notes: '',
})

export default function VehicleFormModal({
  open,
  onClose,
  editing,
  lockedBranch,
  activeBranch,
}: {
  open: boolean
  onClose: () => void
  editing: Vehicle | null
  lockedBranch: BranchCode | null // non-null = role can't change branch
  activeBranch: BranchCode
}) {
  const [form, setForm] = useState(() => (editing ? { ...editing } : empty(lockedBranch ?? activeBranch)))
  const [error, setError] = useState('')

  // Re-seed the form whenever the modal is (re)opened for a different record.
  const [lastKey, setLastKey] = useState('')
  const key = (editing?.id ?? 'new') + String(open)
  if (open && key !== lastKey) {
    setForm(editing ? { ...editing } : empty(lockedBranch ?? activeBranch))
    setError('')
    setLastKey(key)
  }

  function set<K extends keyof Vehicle>(k: K, v: Vehicle[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function save() {
    const fleet_no = form.fleet_no.trim()
    const reg_plate = form.reg_plate.trim()
    if (!fleet_no) return setError('Fleet Number is required — it is the vehicle’s identity.')
    if (!reg_plate) return setError('Registration Plate is required.')
    const clash = vehiclesStore.conflict(fleet_no, reg_plate, editing?.id)
    if (clash === 'fleet_no') return setError(`Fleet Number "${fleet_no}" already exists.`)
    if (clash === 'reg_plate') return setError(`Registration Plate "${reg_plate}" already exists.`)

    const payload = { ...form, fleet_no, reg_plate }
    if (editing) vehiclesStore.update(editing.id, payload)
    else vehiclesStore.add(payload)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${editing.fleet_no}` : 'Add vehicle'}
      subtitle="The Fleet Number is the vehicle’s identity across every module."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>{editing ? 'Save changes' : 'Add vehicle'}</Button>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Fleet Number *" hint="Primary identity, e.g. INZ 120">
          <input className={inputCls} placeholder="INZ 120" value={form.fleet_no} onChange={(e) => set('fleet_no', e.target.value)} />
        </Field>
        <Field label="Registration Plate *">
          <input className={inputCls} placeholder="BCG 4270 ZM" value={form.reg_plate} onChange={(e) => set('reg_plate', e.target.value)} />
        </Field>

        <Field label="Make">
          <input className={inputCls} value={form.make} onChange={(e) => set('make', e.target.value)} />
        </Field>
        <Field label="Model">
          <input className={inputCls} value={form.model} onChange={(e) => set('model', e.target.value)} />
        </Field>

        <Field label="Type">
          <select className={inputCls} value={form.type} onChange={(e) => set('type', e.target.value as VehicleType)}>
            {Object.entries(TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Year">
          <input type="number" className={inputCls} value={form.year ?? ''} onChange={(e) => set('year', e.target.value ? Number(e.target.value) : null)} />
        </Field>

        <Field label="Branch">
          <select
            className={inputCls}
            value={form.branch}
            disabled={!!lockedBranch}
            onChange={(e) => set('branch', e.target.value as BranchCode)}
          >
            {BRANCHES.map((b) => (
              <option key={b.code} value={b.code}>{b.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Status" hint={STATUS_META[form.status].hint}>
          <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value as VehicleStatus)}>
            {Object.entries(STATUS_META).map(([v, m]) => (
              <option key={v} value={v}>{m.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Capacity (seats)">
          <input type="number" className={inputCls} value={form.capacity ?? ''} onChange={(e) => set('capacity', e.target.value ? Number(e.target.value) : null)} />
        </Field>
        <Field label="Colour">
          <input className={inputCls} value={form.colour} onChange={(e) => set('colour', e.target.value)} />
        </Field>
        <Field label="In Service Date">
          <input type="date" className={inputCls} value={form.in_service_date} onChange={(e) => set('in_service_date', e.target.value)} />
        </Field>

        <Field label="Chassis No">
          <input className={inputCls} value={form.chassis_no} onChange={(e) => set('chassis_no', e.target.value)} />
        </Field>
        <Field label="Engine No">
          <input className={inputCls} value={form.engine_no} onChange={(e) => set('engine_no', e.target.value)} />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Notes">
            <textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </div>

      {editing && (
        <div className="mt-4 rounded-lg bg-canvas px-3 py-2 text-[11px] text-status-neutral">
          Added by <span className="font-medium text-navy">{editing.created_by}</span> on{' '}
          {new Date(editing.created_at).toLocaleDateString()} · Last updated by{' '}
          <span className="font-medium text-navy">{editing.updated_by}</span> on{' '}
          {new Date(editing.updated_at).toLocaleString()}
        </div>
      )}
    </Modal>
  )
}
