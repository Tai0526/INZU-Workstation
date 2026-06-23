import { useMemo, useState } from 'react'
import {
  Users as UsersIcon, ShieldCheck, Activity, GitBranch, Database, Trash2, RotateCcw, AlertTriangle,
  ShieldAlert, Plus, Search, Pencil, ArrowUp, ArrowDown, X, CheckCircle2, Clock, MapPin,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import {
  canEdit, MODULE_KEYS, MODULE_LABEL, roleDefault, rolePermsStore, useRolePerms,
  type ModuleKey, type Permission,
} from '@/lib/permissions'
import { ROLE_LIST, ROLES, BRANCHES, BRANCH_CODES, brandingStore, useBranches, type RoleKey, type BranchCode } from '@/lib/roles'
import { NAV } from '@/lib/nav'
import { useUsers, usersStore, useSessions, allowedBranches, type AppUser, type NewUser } from '@/lib/auth/users'
import { useApprovals, approvalsStore } from '@/lib/auth/approvals'
import { employeesStore } from '@/lib/hr/store'
import type { JobRole } from '@/lib/hr/types'
import { clearAllData, restoreDemoData } from '@/lib/demo/reset'
import { useVehicles } from '@/lib/fleet/store'
import { useDrivers } from '@/lib/drivers/store'
import { useEmployees } from '@/lib/hr/store'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const PERMS: Permission[] = ['none', 'view', 'edit']
const PERM_TONE: Record<Permission, string> = {
  none: 'bg-black/5 text-status-neutral', view: 'bg-status-warning/10 text-[#8a6d10]', edit: 'bg-status-good/10 text-status-good',
}
const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleString() : 'Never')
const ALL_PAGES = NAV.flatMap((n) => n.pages.filter((p) => p.path !== '/').map((p) => ({ ...p, node: n.label, module: n.module })))

function roleToJob(role: RoleKey): JobRole {
  const map: Partial<Record<RoleKey, JobRole>> = {
    safety_officer: 'Safety Officer', workshop_supervisor: 'Workshop Supervisor', route_supervisor: 'Route Supervisor',
    bus_controller: 'Bus Controller', tracker: 'Tracker', fuel_controller: 'Fuel Controller',
    hr_officer: 'HR Officer', payroll_officer: 'Payroll Officer',
  }
  return map[role] ?? 'Other'
}

export default function Admin() {
  const { user } = useAuth()
  const canManage = canEdit(user!.role, 'admin')
  const [tab, setTab] = useState<'users' | 'roles' | 'sessions' | 'approvals' | 'branches' | 'data'>('users')

  if (!canManage) {
    return <div className="page"><div className="card flex items-center gap-2 px-5 py-4 text-sm text-status-neutral"><ShieldAlert size={16} /> Administration is limited to administrators.</div></div>
  }

  const tabs = [
    { key: 'users', label: 'Users', icon: UsersIcon },
    { key: 'roles', label: 'Roles & Permissions', icon: ShieldCheck },
    { key: 'sessions', label: 'Sessions', icon: Activity },
    { key: 'approvals', label: 'Approval order', icon: GitBranch },
    { key: 'branches', label: 'Branches', icon: MapPin },
    { key: 'data', label: 'Data', icon: Database },
  ] as const

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap gap-1.5 border-b border-black/10">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? 'border-brand text-navy' : 'border-transparent text-status-neutral hover:text-navy'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && <UsersTab currentId={user!.id} />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'sessions' && <SessionsTab currentId={user!.id} />}
      {tab === 'approvals' && <ApprovalsTab />}
      {tab === 'branches' && <BranchesTab />}
      {tab === 'data' && <DataTab />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════ Users
function UsersTab({ currentId }: { currentId: string }) {
  const users = useUsers()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<AppUser | null>(null)
  const [adding, setAdding] = useState(false)

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return users.filter((u) => !term || [u.full_name, u.username, ROLES[u.role].label].some((f) => f.toLowerCase().includes(term)))
  }, [users, q])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, username, role…" className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <span className="text-sm text-status-neutral">{rows.length} user{rows.length === 1 ? '' : 's'}</span>
        <Button className="ml-auto" onClick={() => setAdding(true)}><Plus size={15} /> Add user</Button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Branch</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Last login</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => (
                <tr key={u.id} className={`cursor-pointer ${i % 2 ? 'bg-canvas/40' : ''} hover:bg-canvas`} onClick={() => setEditing(u)}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-navy">{u.full_name} {u.id === currentId && <span className="ml-1 rounded-full bg-brand-tint px-1.5 py-0.5 text-[10px] text-[#8a4513]">you</span>}</div>
                    <div className="text-xs text-status-neutral">@{u.username}{u.is_employee && ' · employee'}</div>
                  </td>
                  <td className="px-4 py-2.5 text-navy">{ROLES[u.role].label}</td>
                  <td className="px-4 py-2.5 text-status-neutral">{allowedBranches(u).map((b) => BRANCHES.find((x) => x.code === b)!.short).join(', ')}</td>
                  <td className="px-4 py-2.5">
                    {u.active ? <span className="inline-flex items-center gap-1 text-status-good"><CheckCircle2 size={13} /> Active</span> : <span className="text-status-critical">Deactivated</span>}
                  </td>
                  <td className="px-4 py-2.5 text-status-neutral">{u.last_login_at ? fmtDate(u.last_login_at) : 'Never'} <span className="text-[11px]">({u.login_count}×)</span></td>
                  <td className="px-4 py-2.5 text-right"><Pencil size={14} className="text-status-neutral" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(adding || editing) && <UserModal user={editing} currentId={currentId} onClose={() => { setAdding(false); setEditing(null) }} />}
    </div>
  )
}

function UserModal({ user, currentId, onClose }: { user: AppUser | null; currentId: string; onClose: () => void }) {
  const isNew = !user
  const [form, setForm] = useState<AppUser>(() =>
    user ?? ({
      id: '', username: '', password: '', full_name: '', email: '', role: 'viewer', branch: 'trident',
      extra_branches: [], perm_overrides: {}, hidden_pages: [], is_employee: false, employee_id: '',
      active: true, created_at: '', created_by: '', last_login_at: '', login_count: 0,
    } as AppUser),
  )
  const [err, setErr] = useState('')
  const set = <K extends keyof AppUser>(k: K, v: AppUser[K]) => setForm((f) => ({ ...f, [k]: v }))

  function toggleBranch(b: BranchCode) {
    set('extra_branches', form.extra_branches.includes(b) ? form.extra_branches.filter((x) => x !== b) : [...form.extra_branches, b])
  }
  function setOverride(mod: ModuleKey, v: string) {
    const next = { ...form.perm_overrides }
    if (v === 'default') delete next[mod]; else next[mod] = v as Permission
    set('perm_overrides', next)
  }
  function toggleHidden(path: string) {
    set('hidden_pages', form.hidden_pages.includes(path) ? form.hidden_pages.filter((p) => p !== path) : [...form.hidden_pages, path])
  }

  function save() {
    if (!form.full_name.trim()) return setErr('Full name is required.')
    if (!form.username.trim()) return setErr('Username is required.')
    if (isNew && !form.password.trim()) return setErr('Set an initial password.')
    const clash = usersStore.list().find((u) => u.username.toLowerCase() === form.username.trim().toLowerCase() && u.id !== form.id)
    if (clash) return setErr('That username is already taken.')
    if (form.id === currentId && !form.active) return setErr("You can't deactivate the account you're signed in with.")
    if (form.id === currentId && (form.perm_overrides.admin === 'none' || form.perm_overrides.admin === 'view')) return setErr("You can't reduce your own admin access.")

    // Create / link an HR employee profile when flagged.
    let employee_id = form.employee_id
    if (form.is_employee && !employee_id) {
      const emp = employeesStore.add({
        branch: form.branch, employee_no: `INZ-U${(employeesStore.list().length + 1).toString().padStart(3, '0')}`,
        full_name: form.full_name.trim(), job_role: roleToJob(form.role), status: 'active', phone: '', hod: ROLES[form.role].label,
      })
      employee_id = emp.id
    }

    const payload = { ...form, username: form.username.trim(), full_name: form.full_name.trim(), employee_id, extra_branches: form.extra_branches.filter((b) => b !== form.branch) }
    if (isNew) usersStore.add(payload as NewUser)
    else usersStore.update(form.id, payload)
    onClose()
  }
  function remove() {
    if (form.id === currentId) { setErr("You can't delete the account you're signed in with."); return }
    if (window.confirm(`Delete ${form.full_name}? They will no longer be able to sign in.`)) { usersStore.remove(form.id); onClose() }
  }

  return (
    <Modal open onClose={onClose} size="xl" title={isNew ? 'Add user' : `Edit ${form.full_name}`} subtitle="Accounts, access and per-user permissions"
      footer={
        <div className="flex w-full items-center justify-between">
          {!isNew ? <Button variant="danger" onClick={remove}>Delete user</Button> : <span />}
          <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>{isNew ? 'Create user' : 'Save'}</Button></div>
        </div>
      }>
      {err && <div className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{err}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Full name *</span><input className={inputCls} value={form.full_name} onChange={(e) => set('full_name', e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Email</span><input className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Username *</span><input className={inputCls} value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">{isNew ? 'Password *' : 'Reset password (leave to keep)'}</span><input className={inputCls} value={isNew ? form.password : ''} placeholder={isNew ? '' : '••••••••'} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></label>

        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Role</span>
          <select className={inputCls} value={form.role} onChange={(e) => set('role', e.target.value as RoleKey)}>
            {ROLE_LIST.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Home branch</span>
          <select className={inputCls} value={form.branch} onChange={(e) => set('branch', e.target.value as BranchCode)}>
            {BRANCHES.map((b) => <option key={b.code} value={b.code}>{b.short}</option>)}
          </select>
        </label>

        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-navy">Also grant access to other branches</span>
          <div className="flex flex-wrap gap-3">
            {BRANCHES.filter((b) => b.code !== form.branch).map((b) => (
              <label key={b.code} className="inline-flex items-center gap-2 text-sm text-navy"><input type="checkbox" checked={form.extra_branches.includes(b.code)} onChange={() => toggleBranch(b.code)} /> {b.short}</label>
            ))}
            {ROLES[form.role].crossBranch && <span className="text-xs text-status-neutral">This role is cross-branch by default.</span>}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm text-navy"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Account active</label>
          <label className="inline-flex items-center gap-2 text-sm text-navy"><input type="checkbox" checked={form.is_employee} onChange={(e) => set('is_employee', e.target.checked)} /> Is an employee (create HR profile)</label>
          {form.employee_id && <span className="text-xs text-status-good">Linked to HR profile.</span>}
        </div>
      </div>

      {/* Permission overrides */}
      <div className="mt-6">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-status-neutral">Permissions</div>
        <p className="mb-2 text-xs text-status-neutral">Defaults come from the role (editable under Roles &amp; Permissions). Override per module here only when this person differs.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MODULE_KEYS.map((mod) => {
            const def = roleDefault(form.role, mod)
            const val = form.perm_overrides[mod] ?? 'default'
            return (
              <div key={mod} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-1.5">
                <span className="flex-1 text-sm text-navy">{MODULE_LABEL[mod]}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PERM_TONE[def]}`} title="Role default">def: {def}</span>
                <select className="rounded-lg border border-black/15 bg-white px-2 py-1 text-xs text-navy outline-none focus:border-brand" value={val} onChange={(e) => setOverride(mod, e.target.value)}>
                  <option value="default">Use default</option>
                  {PERMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )
          })}
        </div>
      </div>

      {/* Hidden subpages */}
      <div className="mt-6">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-status-neutral">Hide specific sub-pages</div>
        <p className="mb-2 text-xs text-status-neutral">Ticked pages are hidden from this user's sidebar and blocked if visited directly.</p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {ALL_PAGES.map((p) => (
            <label key={p.path} className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm text-navy">
              <input type="checkbox" checked={form.hidden_pages.includes(p.path)} onChange={() => toggleHidden(p.path)} />
              <span className="text-status-neutral">{p.node} ·</span> {p.label}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════ Roles & Permissions
function RolesTab() {
  const { user } = useAuth()
  useRolePerms() // re-render on edits
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm text-status-neutral">Default permissions per role. Changes apply immediately to everyone with that role (unless they have a per-user override). The <span className="font-medium text-navy">Administrator</span> always has full access and can't be restricted.</p>
        <Button variant="secondary" onClick={() => { if (window.confirm('Reset every role to the built-in defaults?')) rolePermsStore.resetAll() }}><RotateCcw size={14} /> Reset all</Button>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-canvas/60 text-[11px] uppercase tracking-wide text-status-neutral">
                <th className="sticky left-0 z-10 bg-canvas/60 px-4 py-3 font-medium">Role</th>
                {MODULE_KEYS.map((mod) => <th key={mod} className="px-2 py-3 text-center font-medium">{MODULE_LABEL[mod]}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-black/5 bg-canvas/40">
                <td className="sticky left-0 z-10 bg-canvas/40 px-4 py-2 font-medium text-navy">Administrator</td>
                <td colSpan={MODULE_KEYS.length} className="px-4 py-2 text-xs text-status-neutral">Full access to everything — fixed.</td>
              </tr>
              {ROLE_LIST.filter((r) => r.key !== 'administrator').map((r) => (
                <tr key={r.key} className="border-b border-black/5 hover:bg-canvas/40">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-2 font-medium text-navy">{r.label}</td>
                  {MODULE_KEYS.map((mod) => {
                    const p = roleDefault(r.key, mod)
                    return (
                      <td key={mod} className="px-2 py-2 text-center">
                        <select value={p} onChange={(e) => {
                          const v = e.target.value as Permission
                          if (mod === 'admin' && r.key === user!.role && v !== 'edit') { window.alert("You can't remove your own admin access."); return }
                          rolePermsStore.setPerm(r.key, mod, v)
                        }}
                          className={`rounded px-1.5 py-1 text-xs font-medium outline-none ${PERM_TONE[p]}`}>
                          {PERMS.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════ Sessions
function SessionsTab({ currentId }: { currentId: string }) {
  const users = useUsers()
  const sessions = useSessions()
  const sorted = [...users].sort((a, b) => (b.last_login_at || '').localeCompare(a.last_login_at || ''))
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><Activity size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Accounts &amp; last login</h3></div>
        <div className="divide-y divide-black/5">
          {sorted.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-5 py-2.5">
              <div className="flex-1">
                <div className="text-sm font-medium text-navy">{u.full_name} {u.id === currentId && <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-status-good/10 px-1.5 py-0.5 text-[10px] font-medium text-status-good"><span className="h-1.5 w-1.5 rounded-full bg-status-good" /> online</span>}</div>
                <div className="text-xs text-status-neutral">{ROLES[u.role].label} · {u.login_count} login{u.login_count === 1 ? '' : 's'}</div>
              </div>
              <div className="text-right text-xs text-status-neutral"><Clock size={12} className="inline" /> {fmtDate(u.last_login_at)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><Activity size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Recent login activity</h3></div>
        {sessions.length === 0 ? <p className="px-5 py-8 text-center text-sm text-status-neutral">No logins recorded yet.</p> : (
          <div className="max-h-[420px] divide-y divide-black/5 overflow-y-auto">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-2">
                <span className="flex-1 text-sm text-navy">{s.full_name} <span className="text-xs text-status-neutral">({ROLES[s.role].label})</span></span>
                <span className="text-xs text-status-neutral">{fmtDate(s.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════ Approvals
function ApprovalsTab() {
  const chains = useApprovals()
  const [addingTo, setAddingTo] = useState<string | null>(null)
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm text-status-neutral">The order each workflow is approved in. Re-sequence or change who approves without touching code.</p>
        <Button variant="secondary" onClick={() => { if (window.confirm('Reset all approval chains to defaults?')) approvalsStore.resetAll() }}><RotateCcw size={14} /> Reset</Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {chains.map((c) => (
          <div key={c.key} className="card p-4">
            <div className="mb-2 font-display text-sm font-bold text-navy">{c.label}</div>
            <ol className="space-y-1.5">
              {c.steps.map((step, i) => (
                <li key={`${step}-${i}`} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-navy/5 text-[11px] font-bold text-navy">{i + 1}</span>
                  <span className="flex-1 text-sm text-navy">{ROLES[step]?.label ?? step}</span>
                  <button disabled={i === 0} onClick={() => approvalsStore.move(c.key, i, -1)} className="rounded p-1 text-status-neutral hover:bg-canvas disabled:opacity-30"><ArrowUp size={14} /></button>
                  <button disabled={i === c.steps.length - 1} onClick={() => approvalsStore.move(c.key, i, 1)} className="rounded p-1 text-status-neutral hover:bg-canvas disabled:opacity-30"><ArrowDown size={14} /></button>
                  <button onClick={() => approvalsStore.setSteps(c.key, c.steps.filter((_, j) => j !== i))} className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><X size={14} /></button>
                </li>
              ))}
            </ol>
            {addingTo === c.key ? (
              <select autoFocus className={`${inputCls} mt-2`} onChange={(e) => { if (e.target.value) approvalsStore.setSteps(c.key, [...c.steps, e.target.value as RoleKey]); setAddingTo(null) }} defaultValue="">
                <option value="" disabled>Add an approver…</option>
                {ROLE_LIST.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            ) : (
              <button onClick={() => setAddingTo(c.key)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Plus size={13} /> Add approver</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════ Branches
function BranchesTab() {
  useBranches() // re-render on rename
  const brand = brandingStore.get()
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm text-status-neutral">The client / site names shown across the app. The two branch codes are fixed; only their display names change here.</p>
        <Button variant="secondary" onClick={() => { if (window.confirm('Reset branch names to defaults?')) brandingStore.reset() }}><RotateCcw size={14} /> Reset</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {BRANCH_CODES.map((code) => (
          <div key={code} className="card p-5">
            <div className="mb-3 flex items-center gap-2"><MapPin size={15} className="text-brand" /><span className="font-display text-sm font-bold text-navy capitalize">{code}</span></div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Display name (client)</span>
              <input className={inputCls} value={brand[code].label} onChange={(e) => brandingStore.set(code, { ...brand[code], label: e.target.value })} />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-medium text-navy">Short name</span>
              <input className={inputCls} value={brand[code].short} onChange={(e) => brandingStore.set(code, { ...brand[code], short: e.target.value })} />
            </label>
            <p className="mt-2 text-[11px] text-status-neutral">Used in headers, exports and the branch switcher.</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════ Data
function DataTab() {
  const counts = [
    ['Users', useUsers().length],
    ['Vehicles', useVehicles().length],
    ['Drivers', useDrivers().length],
    ['Employees (HR)', useEmployees().length],
  ] as [string, number][]
  const [confirm, setConfirm] = useState<null | 'clear' | 'restore'>(null)
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    if (confirm === 'clear') await clearAllData()
    else if (confirm === 'restore') await restoreDemoData()
  }
  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><Database size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Database</h3></div>
        <div className="grid grid-cols-2 gap-px bg-black/5 sm:grid-cols-4">
          {counts.map(([label, n]) => (
            <div key={label} className="bg-surface px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-status-neutral">{label}</div><div className="mt-0.5 text-2xl font-bold text-navy">{n.toLocaleString()}</div></div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card flex flex-col gap-3 border border-status-critical/20 p-5">
          <div className="flex items-center gap-2"><Trash2 size={16} className="text-status-critical" /><h3 className="font-display text-sm font-bold text-navy">Clear all data</h3></div>
          <p className="text-sm text-status-neutral">Wipes operational records, leaving an empty database. User accounts, role permissions and approval order reset to the built-in defaults (so you can still sign in as admin).</p>
          <div><Button variant="danger" onClick={() => setConfirm('clear')}><Trash2 size={15} /> Clear all data</Button></div>
        </div>
        <div className="card flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2"><RotateCcw size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Restore demo data</h3></div>
          <p className="text-sm text-status-neutral">Re-loads the built-in sample fleet, a month of mileage and fuel, and demo accounts — handy for demos or training.</p>
          <div><Button variant="secondary" onClick={() => setConfirm('restore')}><RotateCcw size={15} /> Restore demo data</Button></div>
        </div>
      </div>
      <Modal open={confirm !== null} onClose={() => !busy && setConfirm(null)}
        title={confirm === 'clear' ? 'Clear all data?' : 'Restore demo data?'}
        subtitle={confirm === 'clear' ? 'This cannot be undone.' : 'Replaces current data with the built-in sample.'}
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button variant={confirm === 'clear' ? 'danger' : 'primary'} onClick={run} disabled={busy}>{busy ? 'Working…' : confirm === 'clear' ? 'Yes, clear everything' : 'Yes, restore demo'}</Button></>}>
        <div className="flex items-start gap-3 rounded-lg bg-canvas px-4 py-3 text-sm text-navy">
          <AlertTriangle size={18} className={confirm === 'clear' ? 'text-status-critical' : 'text-status-warning'} />
          <p>{confirm === 'clear' ? 'Operational records and uploaded files will be permanently deleted. Accounts and settings reset to defaults.' : 'Your current records will be overwritten with the demo fleet and sample month of data.'}</p>
        </div>
      </Modal>
    </div>
  )
}
