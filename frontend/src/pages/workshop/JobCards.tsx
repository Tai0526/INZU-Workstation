import { useMemo, useState } from 'react'
import {
  Plus, Wrench, Check, X, Bus, Clock, Trash2, CheckCircle2, RotateCcw, ShieldCheck, AlertTriangle, UserRound,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import SearchableSelect, { SearchableMultiSelect } from '@/components/ui/SearchableSelect'
import { useVehicles } from '@/lib/fleet/store'
import { STATUS_META, type VehicleStatus } from '@/lib/fleet/types'
import { useDrivers } from '@/lib/drivers/store'
import { useEmployees } from '@/lib/hr/store'
import {
  useJobCards, raiseJobCard, submitForSignoff, decideJob, reopenJob, removeJob, tyresStore,
} from '@/lib/workshop/store'
import {
  type JobCard, type JobCardInput, type JobSeverity, type JobCategory,
  JOB_STATUS_META, SEVERITY_META, JOB_CATEGORY_LABEL, TYRE_POSITIONS,
} from '@/lib/workshop/types'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const fmt = (iso: string) => { try { return new Date(iso).toLocaleDateString('en', { day: '2-digit', month: 'short' }) } catch { return '—' } }
const STATUS_RANK: Record<JobCard['status'], number> = { awaiting_approval: 0, open: 1, closed: 2 }

export default function JobCards() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'workshop') // Workshop Supervisor / Admin
  // The Asst Operations Manager is the department's approver (Ops Manager & Admin too).
  const canApprove = role === 'asst_operations_manager' || role === 'operations_manager' || role === 'administrator'

  const vehicles = useVehicles().filter((v) => v.branch === branch)
  const drivers = useDrivers().filter((d) => d.branch === branch && d.status === 'active')
  const mechanics = useEmployees().filter((e) => e.branch === branch && e.status === 'active' && e.job_role === 'Mechanic')
  const jobs = useJobCards().filter((j) => j.branch === branch)

  const [filter, setFilter] = useState<'all' | JobCard['status']>('all')
  const [raiseOpen, setRaiseOpen] = useState(false)
  const [signoff, setSignoff] = useState<JobCard | null>(null)
  const [reject, setReject] = useState<JobCard | null>(null)

  const rows = useMemo(
    () => jobs
      .filter((j) => filter === 'all' || j.status === filter)
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.reported_at.localeCompare(a.reported_at)),
    [jobs, filter],
  )
  const counts = {
    open: jobs.filter((j) => j.status === 'open').length,
    awaiting: jobs.filter((j) => j.status === 'awaiting_approval').length,
    closed: jobs.filter((j) => j.status === 'closed').length,
  }

  const stat = (label: string, value: number, tone: 'neutral' | 'warning' | 'good' = 'neutral') => (
    <div className={`rounded-xl border px-3 py-2 ${tone === 'warning' ? 'border-status-warning/40 bg-status-warning/10' : tone === 'good' ? 'border-status-good/30 bg-status-good/5' : 'border-black/10 bg-white'}`}>
      <div className={`text-lg font-bold leading-none ${tone === 'warning' ? 'text-[#8a6d10]' : tone === 'good' ? 'text-status-good' : 'text-navy'}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-status-neutral">{label}</div>
    </div>
  )

  return (
    <div className="page space-y-4">
      <p className="max-w-2xl text-sm text-status-neutral">
        Raise a job card when a bus has a fault — it goes <span className="font-medium text-navy">into the workshop</span> straight away.
        When it's fixed, submit it for the <span className="font-medium text-navy">Asst Operations Manager</span> to sign back into service.
      </p>

      <div className="grid grid-cols-3 gap-2 sm:max-w-md">
        {stat('In workshop', counts.open, counts.open ? 'warning' : 'neutral')}
        {stat('Awaiting sign-off', counts.awaiting, counts.awaiting ? 'warning' : 'neutral')}
        {stat('Closed', counts.closed, 'good')}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
          {(['all', 'open', 'awaiting_approval', 'closed'] as const).map((k) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-3 py-1.5 text-sm font-medium ${filter === k ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas'}`}>
              {k === 'all' ? 'All' : JOB_STATUS_META[k].label}
            </button>
          ))}
        </div>
        {canManage && <Button className="ml-auto" onClick={() => setRaiseOpen(true)}><Plus size={15} /> Raise job card</Button>}
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white">
              <tr>
                <th className="px-3 py-2.5 font-medium">Bus</th><th className="px-3 py-2.5 font-medium">Fault</th>
                <th className="px-3 py-2.5 font-medium">Severity</th><th className="px-3 py-2.5 font-medium">Mechanics</th>
                <th className="px-3 py-2.5 font-medium">Reported</th><th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((j, i) => (
                <tr key={j.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-3 py-2 align-top">
                    <div className="inline-flex items-center gap-1 font-medium text-navy"><Bus size={13} className="text-status-neutral" /> {j.fleet_no}</div>
                    <div className="text-[11px] text-status-neutral">{j.reg_no}</div>
                  </td>
                  <td className="px-3 py-2 align-top text-navy">
                    <div className="max-w-[20rem]">{j.fault}</div>
                    {((j.category && j.category !== 'mechanical') || j.checklist_id) && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
                        {j.category && j.category !== 'mechanical' && <span className="rounded bg-navy/5 px-1.5 py-0.5 font-medium text-navy">{JOB_CATEGORY_LABEL[j.category]}</span>}
                        {j.checklist_id && <span className="rounded bg-brand-tint px-1.5 py-0.5 font-medium text-[#8a4513]">from checklist</span>}
                      </div>
                    )}
                    {j.driver_name && <div className="text-[11px] text-status-neutral">reported by {j.driver_name}</div>}
                    {j.rejected_note && <div className="mt-0.5 text-[11px] text-status-critical">Sent back: {j.rejected_note}</div>}
                    {j.status === 'closed' && j.work_done && <div className="mt-0.5 text-[11px] text-status-good">Done: {j.work_done}</div>}
                  </td>
                  <td className="px-3 py-2 align-top"><StatusBadge tone={SEVERITY_META[j.severity].tone}>{SEVERITY_META[j.severity].label.replace(' — grounds the bus', '')}</StatusBadge></td>
                  <td className="px-3 py-2 align-top text-status-neutral">{j.mechanics.length ? j.mechanics.join(', ') : '—'}</td>
                  <td className="px-3 py-2 align-top text-status-neutral"><span className="inline-flex items-center gap-1"><Clock size={11} /> {fmt(j.reported_at)}</span></td>
                  <td className="px-3 py-2 align-top"><StatusBadge tone={JOB_STATUS_META[j.status].tone}>{JOB_STATUS_META[j.status].label}</StatusBadge></td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex justify-end gap-1">
                      {canManage && j.status === 'open' && (
                        <button onClick={() => setSignoff(j)} className="inline-flex items-center gap-1 rounded-md bg-navy px-2 py-1 text-xs font-medium text-white hover:bg-navy-secondary" title="Mark repaired"><CheckCircle2 size={13} /> Repaired</button>
                      )}
                      {canApprove && j.status === 'awaiting_approval' && (
                        <>
                          <button onClick={() => decideJob(j.id, true)} className="rounded-md p-1.5 text-status-good hover:bg-status-good/10" title="Approve — back in service"><Check size={15} /></button>
                          <button onClick={() => setReject(j)} className="rounded-md p-1.5 text-status-critical hover:bg-status-critical/10" title="Reject — needs more work"><X size={15} /></button>
                        </>
                      )}
                      {canManage && j.status === 'awaiting_approval' && !canApprove && <span className="text-[11px] text-status-neutral">with Asst Ops</span>}
                      {canManage && j.status === 'closed' && (
                        <button onClick={() => reopenJob(j.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Reopen"><RotateCcw size={14} /></button>
                      )}
                      {canManage && (
                        <button onClick={() => confirm('Remove this job card?') && removeJob(j.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical" title="Remove"><Trash2 size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-status-neutral">
                  <Wrench size={22} className="mx-auto mb-2 text-status-neutral/60" />
                  No job cards{filter !== 'all' ? ' in this state' : ''}. {canManage && filter === 'all' && 'Raise one when a bus has a fault.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canApprove && counts.awaiting > 0 && (
        <p className="inline-flex items-center gap-1.5 text-xs text-[#8a6d10]"><ShieldCheck size={13} /> {counts.awaiting} job{counts.awaiting === 1 ? '' : 's'} waiting for your sign-off to return to service.</p>
      )}
      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <RaiseModal open={raiseOpen} onClose={() => setRaiseOpen(false)} branch={branch} vehicles={vehicles} drivers={drivers} mechanics={mechanics} />
      <SignoffModal job={signoff} onClose={() => setSignoff(null)} />
      <RejectModal job={reject} onClose={() => setReject(null)} />
    </div>
  )
}

function RaiseModal({ open, onClose, branch, vehicles, drivers, mechanics }: { open: boolean; onClose: () => void; branch: BranchCode; vehicles: any[]; drivers: any[]; mechanics: any[] }) {
  const blank = (): JobCardInput => ({
    branch, fleet_no: '', reg_no: '', driver_name: '', fault: '', severity: 'major', category: 'mechanical', vehicle_status: 'under_repair',
    mechanics: [], status: 'open', work_done: '', reported_by: '', reported_at: '', completed_by: '', completed_at: '',
    approved_by: '', approved_at: '', rejected_note: '', notes: '', checklist_id: '',
  })
  const [f, setF] = useState<JobCardInput>(blank)
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setF(blank()) }
  if (!open && wasOpen) setWasOpen(false)

  function set<K extends keyof JobCardInput>(k: K, v: JobCardInput[K]) { setF((p) => ({ ...p, [k]: v })) }
  function onVehicle(fleet: string) { const v = vehicles.find((x) => x.fleet_no === fleet); setF((p) => ({ ...p, fleet_no: fleet, reg_no: v ? v.reg_plate : '' })) }
  function onSeverity(sev: JobSeverity) { setF((p) => ({ ...p, severity: sev, vehicle_status: SEVERITY_META[sev].grounds ? 'grounded' : 'under_repair' })) }
  const ready = !!f.fleet_no.trim() && !!f.fault.trim()
  function save() { if (!ready) return; raiseJobCard(f); onClose() }

  const grounds = SEVERITY_META[f.severity].grounds
  return (
    <Modal open={open} onClose={onClose} title="Raise job card" subtitle="Log a bus fault. The bus is taken into the workshop right away and planners are alerted."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}><Wrench size={15} /> Raise &amp; pull from service</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Bus</span>
          <SearchableSelect className={inputCls} value={f.fleet_no} onChange={onVehicle} placeholder="Search bus…" advanceOnSelect
            options={vehicles.map((v) => ({ value: v.fleet_no, label: v.fleet_no, sub: `${v.reg_plate} · ${STATUS_META[v.status as VehicleStatus].label}` }))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reg No</span><div className="flex h-[38px] items-center rounded-lg border border-black/10 bg-canvas px-3 text-sm text-navy">{f.reg_no || '—'}</div></label>

        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Fault</span>
          <textarea className={inputCls} rows={2} placeholder="e.g. Brakes spongy / warning light on" value={f.fault} onChange={(e) => set('fault', e.target.value)} /></label>

        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Severity</span>
          <select className={inputCls} value={f.severity} onChange={(e) => onSeverity(e.target.value as JobSeverity)}>
            {(['minor', 'major', 'critical'] as JobSeverity[]).map((s) => <option key={s} value={s}>{SEVERITY_META[s].label}</option>)}
          </select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Category</span>
          <select className={inputCls} value={f.category} onChange={(e) => set('category', e.target.value as JobCategory)}>
            {(Object.keys(JOB_CATEGORY_LABEL) as JobCategory[]).map((c) => <option key={c} value={c}>{JOB_CATEGORY_LABEL[c]}</option>)}
          </select></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Driver (reported by)</span>
          <SearchableSelect className={inputCls} value={f.driver_name} onChange={(v) => set('driver_name', v)} placeholder="Search driver…"
            options={drivers.map((d) => ({ value: d.full_name, label: d.full_name, sub: d.section }))} /></label>

        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Assign mechanic(s)</span>
          <SearchableMultiSelect className={inputCls} placeholder="Search mechanic(s)…"
            values={f.mechanics} onChange={(arr) => set('mechanics', arr)}
            options={mechanics.map((m) => ({ value: m.full_name, label: m.full_name }))}
            emptyText="No mechanics in HR for this branch — add them in HR → Employees" /></label>

        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Notes (optional)</span>
          <input className={inputCls} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      </div>
      <p className={`mt-3 rounded-lg px-3 py-2 text-[11px] ${grounds ? 'bg-status-critical/5 text-status-critical' : 'bg-status-warning/10 text-[#8a6d10]'}`}>
        {grounds
          ? <>Critical fault — <b>{f.fleet_no || 'the bus'}</b> will be <b>grounded</b> (fully out of service) and everyone is notified.</>
          : <><b>{f.fleet_no || 'The bus'}</b> will be moved to <b>In Workshop</b> — excluded from fuel, allocation &amp; planning until signed back in.</>}
      </p>
    </Modal>
  )
}

const emptyTyre = () => ({ position: TYRE_POSITIONS[0], brand: '', serial: '', odometer: '', cost: '' })
function SignoffModal({ job, onClose }: { job: JobCard | null; onClose: () => void }) {
  const [work, setWork] = useState('')
  const [tyre, setTyre] = useState(emptyTyre())
  const [key, setKey] = useState('')
  if (job && key !== job.id) { setKey(job.id); setWork(job.work_done || ''); setTyre(emptyTyre()) }
  if (!job) return null
  const isTyre = job.category === 'tyre'
  function save() {
    submitForSignoff(job!.id, work)
    if (isTyre && tyre.brand.trim()) {
      tyresStore.add({
        branch: job!.branch, fleet_no: job!.fleet_no, reg_no: job!.reg_no, position: tyre.position,
        brand: tyre.brand.trim(), serial: tyre.serial.trim(), fitted_date: new Date().toISOString().slice(0, 10),
        odometer: Number(tyre.odometer) || 0, cost_usd: tyre.cost ? Number(tyre.cost) : null,
        reason: 'Replaced via job card', job_id: job!.id, notes: '',
      })
    }
    onClose()
  }
  const setT = (patch: Partial<ReturnType<typeof emptyTyre>>) => setTyre((p) => ({ ...p, ...patch }))
  return (
    <Modal open={!!job} onClose={onClose} title={`Mark repaired — ${job.fleet_no}`} subtitle="Describe the work done. This sends the bus to the Asst Operations Manager to sign back into service."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!work.trim()}><CheckCircle2 size={15} /> Submit for sign-off</Button></>}>
      <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Work done</span>
        <textarea className={inputCls} rows={3} placeholder="e.g. Replaced front brake pads, bled the system, road-tested" value={work} onChange={(e) => setWork(e.target.value)} autoFocus /></label>

      {isTyre && (
        <div className="mt-3 rounded-lg border border-black/10 p-3">
          <div className="mb-2 text-xs font-semibold text-navy">Log tyre change <span className="font-normal text-status-neutral">(optional — writes to Tyre Management)</span></div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Position</span>
              <select className={inputCls} value={tyre.position} onChange={(e) => setT({ position: e.target.value })}>{TYRE_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Brand</span><input className={inputCls} placeholder="e.g. Bridgestone" value={tyre.brand} onChange={(e) => setT({ brand: e.target.value })} /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Serial / DOT</span><input className={inputCls} value={tyre.serial} onChange={(e) => setT({ serial: e.target.value })} /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Odometer</span><input type="number" className={inputCls} value={tyre.odometer} onChange={(e) => setT({ odometer: e.target.value })} /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Cost (USD)</span><input type="number" step="0.01" className={inputCls} value={tyre.cost} onChange={(e) => setT({ cost: e.target.value })} /></label>
          </div>
          <p className="mt-1.5 text-[11px] text-status-neutral">Fill the brand to record a tyre fitting. Add the other tyres in Tyre Management.</p>
        </div>
      )}

      <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-status-neutral"><AlertTriangle size={12} /> The bus stays in the workshop until the Asst Ops Manager approves.</p>
    </Modal>
  )
}

function RejectModal({ job, onClose }: { job: JobCard | null; onClose: () => void }) {
  const [note, setNote] = useState('')
  const [key, setKey] = useState('')
  if (job && key !== job.id) { setKey(job.id); setNote('') }
  if (!job) return null
  function save() { decideJob(job!.id, false, note); onClose() }
  return (
    <Modal open={!!job} onClose={onClose} title={`Send back — ${job.fleet_no}`} subtitle="The job returns to the workshop for more work. Say what still needs doing."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}><X size={15} /> Send back</Button></>}>
      <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reason</span>
        <textarea className={inputCls} rows={2} placeholder="e.g. Still pulling to one side — recheck calipers" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></label>
      <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-status-neutral"><UserRound size={12} /> {job.completed_by ? `Marked repaired by ${job.completed_by}.` : ''}</p>
    </Modal>
  )
}
