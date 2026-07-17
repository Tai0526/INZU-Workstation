import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { UserCog, Plus, Pencil, Trash2, Search, Users, ArrowRight, CalendarOff, FolderOpen } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import { employeesStore } from '@/lib/hr/store'
import { JOB_ROLES, type JobRole, type Employee, type EmployeeInput } from '@/lib/hr/types'
import { useHrPeople, type HrPerson } from '@/lib/hr/directory'
import { useDriverLeave, isOnLeave } from '@/lib/drivers/leave'
import { useEmployeeLeave, empOnLeave } from '@/lib/hr/leave'
import { useLeaveLedger } from '@/lib/hr/leaveLedger'
import { useCases } from '@/lib/safety/cases'
import { useDeductions } from '@/lib/payroll/deductions'
import { useSpeedEvents } from '@/lib/speed/store'
import { countsAgainstDriver } from '@/lib/speed/types'
import { assessRisk, RISK_META } from '@/lib/hr/analytics'
import { canViewEmployeeFile } from '@/lib/hr/employeeFile'
import EmployeeFileDrawer from '@/components/hr/EmployeeFileDrawer'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const SOURCE_META: Record<HrPerson['source'], { label: string; cls: string }> = {
  hr: { label: 'Employee', cls: 'bg-navy/5 text-navy' },
  driver: { label: 'Driver', cls: 'bg-brand-tint text-[#8a4513]' },
  account: { label: 'System account', cls: 'bg-status-good/10 text-status-good' },
}

export default function Employees() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'hr')

  const people = useHrPeople(branch)
  useDriverLeave(); useEmployeeLeave() // reactivity for the on-leave badge
  const ledger = useLeaveLedger()
  const cases = useCases()
  const deductions = useDeductions()
  const speed = useSpeedEvents().filter((e) => e.branch === branch)
  const canFile = canViewEmployeeFile(role)
  const year = new Date().getFullYear()
  const today = new Date().toISOString().slice(0, 10)
  const onLeaveNow = (p: HrPerson) => (p.source === 'driver' ? isOnLeave(p.id, today) : empOnLeave(p.id, today))
  const riskById = useMemo(() => new Map(people.map((p) => {
    const se = speed.filter((e) => (e.driver_id ? e.driver_id === p.id : e.driver_name === p.full_name) && countsAgainstDriver(e)).length
    return [p.id, assessRisk({ personId: p.id, personName: p.full_name, ledger, cases, deductions, year, speedEvents: se })]
  })), [people, ledger, cases, deductions, year, speed])

  const [q, setQ] = useState('')
  const [dept, setDept] = useState('all')
  const [risk, setRisk] = useState<'all' | 'attention' | 'high' | 'watch' | 'low'>('all')
  const [src, setSrc] = useState<'all' | HrPerson['source']>('all')
  const [form, setForm] = useState<{ open: boolean; editing: Employee | null }>({ open: false, editing: null })
  const [fileFor, setFileFor] = useState<HrPerson | null>(null)

  const departments = useMemo(() => ['all', ...[...new Set(people.map((p) => p.department))].sort()], [people])
  const filtered = q.trim() !== '' || dept !== 'all' || risk !== 'all' || src !== 'all'
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return people.filter((p) => {
      const tier = riskById.get(p.id)?.tier ?? 'low'
      return (dept === 'all' || p.department === dept) &&
        (src === 'all' || p.source === src) &&
        (risk === 'all' || (risk === 'attention' ? tier !== 'low' : tier === risk)) &&
        (!term || p.full_name.toLowerCase().includes(term) || p.employee_no.toLowerCase().includes(term) || p.role.toLowerCase().includes(term))
    })
  }, [people, q, dept, risk, src, riskById])

  const counts = {
    total: people.length,
    drivers: people.filter((p) => p.source === 'driver').length,
    employees: people.filter((p) => p.source !== 'driver').length,
    onLeave: people.filter(onLeaveNow).length,
    atRisk: [...riskById.values()].filter((r) => r.tier !== 'low').length,
  }

  function openEdit(p: HrPerson) {
    if (p.source !== 'hr') return
    const emp = employeesStore.list().find((e) => e.id === p.id) || null
    setForm({ open: true, editing: emp })
  }

  return (
    <div className="page space-y-4">
      <p className="max-w-2xl text-sm text-status-neutral">
        Everyone on the books in <span className="font-medium text-navy">{branchLabel}</span> — HR employees, drivers and system accounts marked “is an employee”, in one directory.
        Other modules (Fuel attendants, Workshop mechanics) pull their people from here.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:max-w-2xl sm:grid-cols-5">
        <StatCard label="Headcount" value={counts.total} onClick={() => { setSrc('all'); setRisk('all'); setDept('all') }} />
        <StatCard label="Drivers" value={counts.drivers} onClick={() => setSrc(src === 'driver' ? 'all' : 'driver')} active={src === 'driver'} />
        <StatCard label="Staff" value={counts.employees} onClick={() => setSrc(src === 'hr' ? 'all' : 'hr')} active={src === 'hr'} />
        <StatCard label="On leave" value={counts.onLeave} tone={counts.onLeave ? 'warning' : undefined} />
        <StatCard label="At risk" value={counts.atRisk} tone={counts.atRisk ? 'critical' : undefined} onClick={() => setRisk(risk === 'attention' ? 'all' : 'attention')} active={risk === 'attention'} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number or role…" className="w-60 rounded-lg border border-black/15 bg-white py-2 pl-8 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          {departments.map((d) => <option key={d} value={d}>{d === 'all' ? 'All departments' : d}</option>)}
        </select>
        <select value={src} onChange={(e) => setSrc(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All types</option><option value="hr">Employees</option><option value="driver">Drivers</option><option value="account">System accounts</option>
        </select>
        <select value={risk} onChange={(e) => setRisk(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All standing</option><option value="attention">Needs attention</option><option value="high">At risk</option><option value="watch">Monitor</option><option value="low">Good standing</option>
        </select>
        {filtered && <button onClick={() => { setQ(''); setDept('all'); setRisk('all'); setSrc('all') }} className="rounded-lg border border-black/15 px-3 py-2 text-xs text-status-neutral hover:text-navy">Clear</button>}
        <span className="text-[11px] text-status-neutral">{rows.length} shown</span>
        {canManage && <Button className="ml-auto" onClick={() => setForm({ open: true, editing: null })}><Plus size={15} /> Add employee</Button>}
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th><th className="px-4 py-2.5 font-medium">No.</th>
                <th className="px-4 py-2.5 font-medium">Role</th><th className="px-4 py-2.5 font-medium">Department</th>
                <th className="px-4 py-2.5 font-medium">Type</th><th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.key} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-4 py-2 font-medium text-navy">
                    {p.full_name}
                    {onLeaveNow(p) && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-status-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-[#8a6d10]"><CalendarOff size={10} /> On leave</span>}
                    {(() => { const r = riskById.get(p.id); return r && r.tier !== 'low' ? <span title={r.reasons.join(' · ')} className={`ml-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${r.tier === 'high' ? 'bg-status-critical/10 text-status-critical' : 'bg-status-warning/15 text-[#8a6d10]'}`}>{RISK_META[r.tier].label}</span> : null })()}
                  </td>
                  <td className="px-4 py-2 text-status-neutral">{p.employee_no || '—'}</td>
                  <td className="px-4 py-2 text-navy">{p.role}</td>
                  <td className="px-4 py-2 text-status-neutral">{p.department}</td>
                  <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SOURCE_META[p.source].cls}`}>{SOURCE_META[p.source].label}</span></td>
                  <td className="px-4 py-2"><StatusBadge tone={p.status === 'active' ? 'good' : 'neutral'}>{p.status === 'active' ? 'Active' : 'Inactive'}</StatusBadge></td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {canFile && <button onClick={() => setFileFor(p)} className="inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-xs font-medium text-navy hover:bg-canvas" title="Open employee file"><FolderOpen size={12} /> File</button>}
                      {p.source === 'hr' && canManage && (
                        <>
                          <button onClick={() => openEdit(p)} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => confirm(`Remove ${p.full_name}?`) && employeesStore.remove(p.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical" title="Remove"><Trash2 size={14} /></button>
                        </>
                      )}
                      {p.source !== 'hr' && p.link && (
                        <Link to={p.link} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">{p.source === 'driver' ? 'Profile' : 'Account'} <ArrowRight size={12} /></Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-status-neutral">
                  <Users size={22} className="mx-auto mb-2 text-status-neutral/60" />
                  No people match. {canManage && 'Add an employee, or register a driver in Drivers → Profiles.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="inline-flex flex-wrap items-center gap-1.5 text-xs text-status-neutral">
        <UserCog size={13} /> Drivers are managed in <Link to="/drivers/profiles" className="font-medium text-brand hover:underline">Drivers → Profiles</Link>; system accounts in <Link to="/admin" className="font-medium text-brand hover:underline">Admin</Link>. Both appear here automatically.
      </p>
      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <EmployeeModal state={form} onClose={() => setForm({ open: false, editing: null })} branch={branch} />
      {fileFor && <EmployeeFileDrawer person={fileFor} canManage={canManage} onClose={() => setFileFor(null)} />}
    </div>
  )
}

function StatCard({ label, value, tone, onClick, active }: { label: string; value: number; tone?: 'warning' | 'critical'; onClick?: () => void; active?: boolean }) {
  const border = active ? 'border-brand bg-brand-tint/40' : tone === 'critical' ? 'border-status-critical/40 bg-status-critical/5' : tone === 'warning' ? 'border-status-warning/40 bg-status-warning/10' : 'border-black/10 bg-white'
  const text = tone === 'critical' ? 'text-status-critical' : tone === 'warning' ? 'text-[#8a6d10]' : 'text-navy'
  const cls = `rounded-xl border px-3 py-2 text-left ${border} ${onClick ? 'cursor-pointer hover:border-brand' : ''}`
  const inner = <><div className={`text-lg font-bold leading-none ${text}`}>{value}</div><div className="mt-0.5 text-[11px] text-status-neutral">{label}</div></>
  return onClick ? <button onClick={onClick} className={cls}>{inner}</button> : <div className={cls}>{inner}</div>
}

function EmployeeModal({ state, onClose, branch }: { state: { open: boolean; editing: Employee | null }; onClose: () => void; branch: BranchCode }) {
  const e = state.editing
  const blank = (): EmployeeInput => ({ branch, employee_no: '', full_name: '', job_role: 'General Worker', status: 'active', phone: '', hod: '' })
  const [f, setF] = useState<EmployeeInput>(blank)
  const [key, setKey] = useState('')
  const k = (e?.id ?? 'new') + String(state.open)
  if (state.open && k !== key) {
    setKey(k)
    setF(e ? { branch: e.branch, employee_no: e.employee_no, full_name: e.full_name, job_role: e.job_role, status: e.status, phone: e.phone, hod: e.hod } : blank())
  }
  function set<K extends keyof EmployeeInput>(kk: K, v: EmployeeInput[K]) { setF((p) => ({ ...p, [kk]: v })) }
  const ready = !!f.full_name.trim()
  function save() {
    if (!ready) return
    const data = { ...f, full_name: f.full_name.trim(), employee_no: f.employee_no.trim(), phone: f.phone.trim(), hod: f.hod.trim() }
    if (e) employeesStore.update(e.id, data); else employeesStore.add(data)
    onClose()
  }
  return (
    <Modal open={state.open} onClose={onClose} title={e ? 'Edit employee' : 'Register employee'} subtitle="A staff record (mechanic, fuel attendant, general worker, etc.). Drivers are registered in Drivers → Profiles."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}>{e ? 'Save' : 'Register'}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Full name</span><input className={inputCls} value={f.full_name} onChange={(ev) => set('full_name', ev.target.value)} autoFocus /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Employee no.</span><input className={inputCls} placeholder="INZ-E…" value={f.employee_no} onChange={(ev) => set('employee_no', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Job role</span>
          <select className={inputCls} value={f.job_role} onChange={(ev) => set('job_role', ev.target.value as JobRole)}>
            {JOB_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Phone</span><input className={inputCls} value={f.phone} onChange={(ev) => set('phone', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Head of department / supervisor</span><input className={inputCls} placeholder="e.g. Workshop Supervisor" value={f.hod} onChange={(ev) => set('hod', ev.target.value)} /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Status</span>
          <select className={inputCls} value={f.status} onChange={(ev) => set('status', ev.target.value as Employee['status'])}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      </div>
    </Modal>
  )
}
