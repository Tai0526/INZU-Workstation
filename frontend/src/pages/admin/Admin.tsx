import { useMemo, useRef, useState } from 'react'
import {
  Users as UsersIcon, ShieldCheck, Activity, GitBranch, Database, Trash2, RotateCcw, AlertTriangle,
  ShieldAlert, Plus, Search, Pencil, ArrowUp, ArrowDown, X, CheckCircle2, Clock, MapPin, CalendarClock,
  DownloadCloud, UploadCloud, DatabaseZap, Loader2,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import {
  canEdit, MODULE_KEYS, MODULE_LABEL, roleDefault, rolePermsStore, useRolePerms,
  type ModuleKey, type Permission,
} from '@/lib/permissions'
import { ROLE_LIST, ROLES, BRANCHES, BRANCH_CODES, brandingStore, useBranches, type RoleKey, type BranchCode } from '@/lib/roles'
import { NAV } from '@/lib/nav'
import { useUsers, usersStore, useSessions, allowedBranches, type AppUser, type NewUser } from '@/lib/auth/users'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { supaUsersStore } from '@/lib/auth/profiles'
import { useApprovals, approvalsStore } from '@/lib/auth/approvals'
import { useScheduling, schedulingStore } from '@/lib/drivers/scheduling'
import { cycleKeyFor, sectionAnchorFor } from '@/lib/drivers/schedule'
import { SECTIONS } from '@/lib/org/sections'
import { employeesStore } from '@/lib/hr/store'
import { buildBackup, downloadBackup, parseBackup, restoreBackup, backupSummary, BACKUP_TABLES, type TableCount } from '@/lib/backup/backup'
import type { JobRole } from '@/lib/hr/types'
import { clearAllData, restoreDemoData } from '@/lib/demo/reset'
import { useVehicles } from '@/lib/fleet/store'
import { useDrivers } from '@/lib/drivers/store'
import { drivingUsersStore } from '@/lib/drivers/drivingUsers'
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
    bus_controller: 'Bus Controller', tracker: 'Tracker', fuel_controller: 'Fuel Attendant', fuel_supervisor: 'Fuel Attendant',
    hr_officer: 'HR Officer', payroll_officer: 'Payroll Officer',
  }
  return map[role] ?? 'Other'
}

export default function Admin() {
  const { user } = useAuth()
  const canManage = canEdit(user!.role, 'admin')
  const [tab, setTab] = useState<'users' | 'roles' | 'sessions' | 'approvals' | 'branches' | 'scheduling' | 'data'>('users')

  if (!canManage) {
    return <div className="page"><div className="card flex items-center gap-2 px-5 py-4 text-sm text-status-neutral"><ShieldAlert size={16} /> Administration is limited to administrators.</div></div>
  }

  const tabs = [
    { key: 'users', label: 'Users', icon: UsersIcon },
    { key: 'roles', label: 'Roles & Permissions', icon: ShieldCheck },
    { key: 'sessions', label: 'Sessions', icon: Activity },
    { key: 'approvals', label: 'Approval order', icon: GitBranch },
    { key: 'branches', label: 'Branches', icon: MapPin },
    { key: 'scheduling', label: 'Scheduling', icon: CalendarClock },
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
      {tab === 'scheduling' && <SchedulingTab />}
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
  const supa = isSupabaseConfigured
  const directory = useUsers()
  const [form, setForm] = useState<AppUser>(() =>
    user ?? ({
      id: '', username: '', password: '', full_name: '', email: '', role: 'viewer', branch: 'trident',
      extra_branches: [], perm_overrides: {}, hidden_pages: [], is_employee: false, employee_id: '',
      active: true, created_at: '', created_by: '', last_login_at: '', login_count: 0,
    } as AppUser),
  )
  const [initialPw, setInitialPw] = useState('')
  const [tempPw, setTempPw] = useState('') // shown after a create / reset
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [canDrive, setCanDrive] = useState(() => (user ? drivingUsersStore.has(user.id) : false)) // may be selected as a driver in Speed
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

  async function save() {
    setErr('')
    if (!form.full_name.trim()) return setErr('Full name is required.')
    if (supa) {
      if (isNew && !form.email.trim()) return setErr('Email is required — it is the login.')
    } else {
      if (!form.username.trim()) return setErr('Username is required.')
      if (isNew && !form.password.trim()) return setErr('Set an initial password.')
    }
    const uname = (form.username.trim() || (supa ? form.email.trim().split('@')[0] : ''))
    const clash = directory.find((u) => u.username.toLowerCase() === uname.toLowerCase() && u.id !== form.id)
    if (clash) return setErr('That username is already taken.')
    if (form.id === currentId && !form.active) return setErr("You can't deactivate the account you're signed in with.")
    if (form.id === currentId && (form.perm_overrides.admin === 'none' || form.perm_overrides.admin === 'view')) return setErr("You can't reduce your own admin access.")

    setBusy(true)
    const isEmp = form.role !== 'viewer' && form.is_employee // viewers are never part of the organisation
    try {
      if (supa) {
        const extra = form.extra_branches.filter((b) => b !== form.branch)
        if (isNew) {
          const res = await supaUsersStore.createUser({
            email: form.email.trim(), full_name: form.full_name.trim(), role: form.role, branch: form.branch,
            username: form.username.trim() || undefined, password: initialPw.trim() || undefined,
            extra_branches: extra, perm_overrides: form.perm_overrides, hidden_pages: form.hidden_pages,
            is_employee: isEmp, employee_id: form.employee_id,
          })
          setTempPw(res.temp_password) // keep modal open to reveal the one-time password
        } else {
          await supaUsersStore.updateProfile(form.id, {
            full_name: form.full_name.trim(), username: uname, role: form.role, branch: form.branch,
            extra_branches: extra, perm_overrides: form.perm_overrides, hidden_pages: form.hidden_pages,
            is_employee: isEmp, employee_id: form.employee_id,
          })
          if (user && user.active !== form.active) await supaUsersStore.setActive(form.id, form.active)
          drivingUsersStore.set(form.id, canDrive)
          onClose()
        }
        return
      }

      // ── Local fallback ──
      let employee_id = form.employee_id
      if (isEmp && !employee_id) {
        const emp = employeesStore.add({
          branch: form.branch, employee_no: `INZ-U${(employeesStore.list().length + 1).toString().padStart(3, '0')}`,
          full_name: form.full_name.trim(), job_role: roleToJob(form.role), status: 'active', phone: '', hod: ROLES[form.role].label,
        })
        employee_id = emp.id
      }
      const payload = { ...form, username: form.username.trim(), full_name: form.full_name.trim(), is_employee: isEmp, employee_id, extra_branches: form.extra_branches.filter((b) => b !== form.branch) }
      if (isNew) usersStore.add(payload as NewUser)
      else { usersStore.update(form.id, payload); drivingUsersStore.set(form.id, canDrive) }
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword() {
    if (!user) return
    setErr(''); setBusy(true)
    try { const res = await supaUsersStore.resetPassword(user.id); setTempPw(res.temp_password) }
    catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  async function remove() {
    if (form.id === currentId) { setErr("You can't delete the account you're signed in with."); return }
    if (!window.confirm(`Delete ${form.full_name}? They will no longer be able to sign in.`)) return
    setBusy(true)
    try {
      if (supa) await supaUsersStore.deleteUser(form.id)
      else usersStore.remove(form.id)
      onClose()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  // After a create/reset, reveal the one-time password instead of the form.
  if (tempPw) {
    return (
      <Modal open onClose={onClose} size="md" title="One-time password" subtitle="Share this with the user — they'll be asked to change it on first sign-in."
        footer={<Button onClick={onClose}>Done</Button>}>
        <div className="space-y-3">
          <div className="rounded-lg border border-black/10 bg-canvas px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-status-neutral">Temporary password</div>
            <div className="mt-1 select-all font-mono text-lg font-bold text-navy">{tempPw}</div>
          </div>
          <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(tempPw)}>Copy to clipboard</Button>
          <p className="text-xs text-status-neutral">For security this password is shown once. If it's lost, just reset it again.</p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} size="xl" title={isNew ? 'Add user' : `Edit ${form.full_name}`} subtitle="Accounts, access and per-user permissions"
      footer={
        <div className="flex w-full items-center justify-between">
          {!isNew ? <Button variant="danger" onClick={remove} disabled={busy}>Delete user</Button> : <span />}
          <div className="flex gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Working…' : isNew ? 'Create user' : 'Save'}</Button></div>
        </div>
      }>
      {err && <div className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{err}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Full name *</span><input className={inputCls} value={form.full_name} onChange={(e) => set('full_name', e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Email{supa ? ' *' : ''}{supa && !isNew ? ' (login — fixed)' : ''}</span><input className={inputCls} type="email" value={form.email} disabled={supa && !isNew} onChange={(e) => set('email', e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Username{supa ? ' (optional)' : ' *'}</span><input className={inputCls} value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" placeholder={supa ? 'defaults to the email name' : ''} /></label>
        {supa ? (
          isNew
            ? <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Initial password (optional)</span><input className={inputCls} value={initialPw} onChange={(e) => setInitialPw(e.target.value)} autoComplete="new-password" placeholder="leave blank to auto-generate" /></label>
            : <div className="block"><span className="mb-1 block text-xs font-medium text-navy">Password</span><Button variant="secondary" type="button" onClick={resetPassword} disabled={busy}>Reset password</Button></div>
        ) : (
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">{isNew ? 'Password *' : 'Reset password (leave to keep)'}</span><input className={inputCls} value={isNew ? form.password : ''} placeholder={isNew ? '' : '••••••••'} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></label>
        )}

        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Role</span>
          <select className={inputCls} value={form.role} onChange={(e) => { const r = e.target.value as RoleKey; set('role', r); set('is_employee', r !== 'viewer') }}>
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
          <label className={`inline-flex items-center gap-2 text-sm ${form.role === 'viewer' ? 'text-status-neutral/60' : 'text-navy'}`} title={form.role === 'viewer' ? 'Viewers are not part of the organisation, so they are never in HR.' : 'Staff appear in HR (Employees, Staff Schedule, Leave).'}><input type="checkbox" checked={form.role !== 'viewer' && form.is_employee} disabled={form.role === 'viewer'} onChange={(e) => set('is_employee', e.target.checked)} /> Is an employee (in HR)</label>
          {form.employee_id && <span className="text-xs text-status-good">Linked to HR profile.</span>}
          {!isNew && <label className="inline-flex items-center gap-2 text-sm text-navy" title="Their name will appear in the driver list when confirming a speeding event."><input type="checkbox" checked={canDrive} onChange={(e) => setCanDrive(e.target.checked)} /> Allowed to drive</label>}
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

// ════════════════════════════════════════════════════════════ Scheduling
function SchedulingTab() {
  const sched = useScheduling()
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm text-status-neutral">
          Define the <span className="font-medium text-navy">shifts</span>, <span className="font-medium text-navy">crews</span> and <span className="font-medium text-navy">work-day rotations</span> used across Drivers. A shift can be label-only or carry times; a crew can be A, B, C… and may be linked to a shift or left as a plain grouping.
        </p>
        <Button variant="secondary" onClick={() => { if (window.confirm('Reset shifts, crews and schedules to the built-in defaults?')) schedulingStore.reset() }}><RotateCcw size={14} /> Reset</Button>
      </div>

      <div className="card p-4">
        <div className="mb-2 flex items-center gap-2"><CalendarClock size={15} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Rotation start dates</h3></div>
        <p className="mb-3 text-[11px] text-status-neutral">Set when each section's rotation began. Crews rotate from there — at the start Crew A is on Day, B on Night, C resting (continuous); for 7/7, Crew A is on shift and Crew B off. They advance one block each cycle (14/7 → every 7 days · 10/5 → every 5 days · 7/7 → every 7 days).</p>
        <div className="space-y-3">
          {BRANCH_CODES.map((bc) => (
            <div key={bc} className="rounded-lg border border-black/10 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">{BRANCHES.find((b) => b.code === bc)?.short ?? bc}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SECTIONS[bc].map((s) => {
                  const key = cycleKeyFor(s)
                  const typeLabel = key === '14x7' ? '14/7' : key === '10x5' ? '10/5' : '7/7'
                  return (
                    <label key={s} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-2.5 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-navy">{s} <span className="text-status-neutral">· {typeLabel}</span></span>
                      <input type="date" className="rounded-lg border border-black/15 bg-white px-2 py-1 text-xs text-navy outline-none focus:border-brand" value={sectionAnchorFor(s)} onChange={(e) => schedulingStore.setSectionAnchor(s, e.target.value)} />
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Shifts */}
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2"><Clock size={15} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Shift patterns</h3><span className="ml-auto text-[11px] text-status-neutral">{sched.shifts.length}</span></div>
          <div className="space-y-2">
            {sched.shifts.map((s) => (
              <div key={s.id} className="rounded-lg border border-black/10 bg-white p-2.5">
                <div className="flex items-center gap-2">
                  <input className={`${inputCls} py-1.5`} value={s.label} onChange={(e) => schedulingStore.updateShift(s.id, { label: e.target.value })} placeholder="Shift name (e.g. Day)" />
                  <button onClick={() => schedulingStore.removeShift(s.id)} className="rounded p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical" title="Remove shift"><X size={15} /></button>
                </div>
                <div className="mt-2 flex items-end gap-2">
                  <label className="flex-1 text-[11px] text-status-neutral">Start<input type="time" className={`${inputCls} mt-0.5 py-1.5`} value={s.start ?? ''} onChange={(e) => schedulingStore.updateShift(s.id, { start: e.target.value })} /></label>
                  <label className="flex-1 text-[11px] text-status-neutral">End<input type="time" className={`${inputCls} mt-0.5 py-1.5`} value={s.end ?? ''} onChange={(e) => schedulingStore.updateShift(s.id, { end: e.target.value })} /></label>
                </div>
                <div className="mt-1.5 flex items-end gap-2">
                  <label className="flex-1 text-[11px] text-status-neutral">2nd block start<input type="time" className={`${inputCls} mt-0.5 py-1.5`} value={s.start2 ?? ''} onChange={(e) => schedulingStore.updateShift(s.id, { start2: e.target.value })} /></label>
                  <label className="flex-1 text-[11px] text-status-neutral">2nd block end<input type="time" className={`${inputCls} mt-0.5 py-1.5`} value={s.end2 ?? ''} onChange={(e) => schedulingStore.updateShift(s.id, { end2: e.target.value })} /></label>
                  <button onClick={() => schedulingStore.updateShift(s.id, { start2: '', end2: '' })} disabled={!s.start2 && !s.end2} className="mb-0.5 rounded p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical disabled:opacity-30" title="Clear second block"><X size={14} /></button>
                </div>
              </div>
            ))}
            {sched.shifts.length === 0 && <p className="rounded-lg border border-dashed border-black/15 px-3 py-4 text-center text-xs text-status-neutral">No shifts yet.</p>}
          </div>
          <button onClick={() => schedulingStore.addShift()} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Plus size={13} /> Add shift</button>
          <p className="mt-2 text-[11px] text-status-neutral">Fill the 2nd block for a split shift (e.g. morning + afternoon with a gap). Leave all times blank for a label-only shift.</p>
        </div>

        {/* Crews */}
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2"><UsersIcon size={15} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Crews</h3><span className="ml-auto text-[11px] text-status-neutral">{sched.crews.length}</span></div>
          <div className="space-y-2">
            {sched.crews.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white p-2.5">
                <input className={`${inputCls} w-16 py-1.5`} value={c.label} onChange={(e) => schedulingStore.updateCrew(c.id, { label: e.target.value })} placeholder="A" />
                <select className={`${inputCls} py-1.5`} value={c.shift_id ?? ''} onChange={(e) => schedulingStore.updateCrew(c.id, { shift_id: e.target.value || undefined })}>
                  <option value="">No shift (label only)</option>
                  {sched.shifts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <button onClick={() => schedulingStore.removeCrew(c.id)} disabled={sched.crews.length <= 1} className="rounded p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical disabled:opacity-30" title="Remove crew"><X size={15} /></button>
              </div>
            ))}
          </div>
          <button onClick={() => schedulingStore.addCrew()} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Plus size={13} /> Add crew</button>
          <p className="mt-2 text-[11px] text-status-neutral">Link a crew to a shift to give it times, or leave it as a plain grouping. Renaming a crew keeps drivers assigned to it.</p>
        </div>

        {/* Work schedules */}
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2"><CalendarClock size={15} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Work schedules</h3><span className="ml-auto text-[11px] text-status-neutral">{sched.schedules.length}</span></div>
          <div className="space-y-2">
            {sched.schedules.map((w) => (
              <div key={w.id} className="rounded-lg border border-black/10 bg-white p-2.5">
                <div className="flex items-center gap-2">
                  <input className={`${inputCls} py-1.5`} value={w.label} onChange={(e) => schedulingStore.updateSchedule(w.id, { label: e.target.value })} placeholder="7 on / 7 off" />
                  <button onClick={() => schedulingStore.removeSchedule(w.id)} className="rounded p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical" title="Remove schedule"><X size={15} /></button>
                </div>
                <div className="mt-2 flex items-end gap-2">
                  <label className="flex-1 text-[11px] text-status-neutral">Days on<input type="number" min={0} className={`${inputCls} mt-0.5 py-1.5`} value={w.on_days} onChange={(e) => schedulingStore.updateSchedule(w.id, { on_days: Math.max(0, Number(e.target.value) || 0) })} /></label>
                  <label className="flex-1 text-[11px] text-status-neutral">Days off<input type="number" min={0} className={`${inputCls} mt-0.5 py-1.5`} value={w.off_days} onChange={(e) => schedulingStore.updateSchedule(w.id, { off_days: Math.max(0, Number(e.target.value) || 0) })} /></label>
                </div>
                <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-navy"><input type="checkbox" checked={w.continuous} onChange={(e) => schedulingStore.updateSchedule(w.id, { continuous: e.target.checked })} /> Continuous (rotates day → night)</label>
              </div>
            ))}
            {sched.schedules.length === 0 && <p className="rounded-lg border border-dashed border-black/15 px-3 py-4 text-center text-xs text-status-neutral">No schedules yet.</p>}
          </div>
          <button onClick={() => schedulingStore.addSchedule()} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Plus size={13} /> Add schedule</button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════ Data
/**
 * Backup & restore. The records already live in Postgres and Supabase backs that
 * up itself — this is the copy INZU holds, independent of both Supabase and us.
 */
function BackupPanel() {
  const { user } = useAuth()
  const [busy, setBusy] = useState<'' | 'export' | 'restore'>('')
  const [prog, setProg] = useState({ done: 0, total: 0, table: '' })
  const [result, setResult] = useState<{ kind: 'export' | 'restore'; counts: TableCount[] } | null>(null)
  const [err, setErr] = useState('')
  const [pendingFile, setPendingFile] = useState<{ name: string; text: string } | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function doExport() {
    setBusy('export'); setErr(''); setResult(null)
    try {
      const { file, counts } = await buildBackup(user!.fullName, (done, total, table) => setProg({ done, total, table }))
      downloadBackup(file)
      setResult({ kind: 'export', counts })
    } catch (e) { setErr(e instanceof Error ? e.message : 'Backup failed') }
    setBusy('')
  }

  async function onPick(f: File) {
    setErr(''); setResult(null)
    try {
      const text = await f.text()
      parseBackup(text) // validate before we let anyone near the Restore button
      setPendingFile({ name: f.name, text })
      setConfirmText('')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not read that file') }
  }

  async function doRestore() {
    if (!pendingFile) return
    setBusy('restore'); setErr('')
    try {
      const counts = await restoreBackup(parseBackup(pendingFile.text), (done, total, table) => setProg({ done, total, table }))
      setResult({ kind: 'restore', counts })
      setPendingFile(null)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Restore failed') }
    setBusy('')
  }

  const preview = pendingFile ? backupSummary(parseBackup(pendingFile.text)) : []
  const previewRows = preview.reduce((s, c) => s + c.rows, 0)
  const failed = result?.counts.filter((c) => c.error) ?? []

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
        <DatabaseZap size={16} className="text-brand" />
        <h3 className="font-display text-sm font-bold text-navy">Backup &amp; restore</h3>
      </div>
      <div className="space-y-3 p-5">
        {!isSupabaseConfigured ? (
          <p className="flex items-start gap-2 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2.5 text-sm text-status-critical">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>This app isn't connected to the database, so there's nothing to back up — everything is in this browser only. Set the Supabase environment variables and redeploy.</span>
          </p>
        ) : (
          <p className="text-sm text-status-neutral">
            Downloads every record from all {BACKUP_TABLES.length} tables as one JSON file you keep — independent of Supabase and of this browser.
            Your data already lives in the database and Supabase backs that up itself; this is your own off-site copy. Take one before anything risky, and keep a monthly one.
          </p>
        )}

        {busy && (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} />
            </div>
            <p className="text-xs text-status-neutral">{busy === 'export' ? 'Reading' : 'Writing'} {prog.table}… ({prog.done}/{prog.total})</p>
          </div>
        )}

        {err && <p className="flex items-start gap-2 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{err}</p>}

        {result && (
          <div className="rounded-lg border border-black/10 bg-white">
            <div className={`flex items-center gap-1.5 border-b border-black/5 px-3 py-2 text-xs font-medium ${failed.length ? 'text-[#8a6d10]' : 'text-status-good'}`}>
              {failed.length ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              {result.kind === 'export' ? 'Backup downloaded' : 'Restore finished'} — {result.counts.reduce((s, c) => s + c.rows, 0).toLocaleString()} rows across {result.counts.filter((c) => c.rows > 0).length} tables
              {failed.length > 0 && ` · ${failed.length} table${failed.length === 1 ? '' : 's'} had a problem`}
            </div>
            <div className="max-h-44 overflow-y-auto p-1">
              {result.counts.filter((c) => c.rows > 0 || c.error).map((c) => (
                <div key={c.table} className="flex items-center gap-2 px-2 py-1 text-xs">
                  <span className="font-medium text-navy">{c.table}</span>
                  <span className="text-status-neutral">{c.rows.toLocaleString()} rows</span>
                  {c.error && <span className="ml-auto max-w-[55%] truncate text-right text-status-critical" title={c.error}>{c.error}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={doExport} disabled={!!busy || !isSupabaseConfigured}>
            {busy === 'export' ? <Loader2 size={15} className="animate-spin" /> : <DownloadCloud size={15} />} Download backup
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={!!busy || !isSupabaseConfigured}><UploadCloud size={15} /> Restore from file…</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPick(f); e.target.value = '' }} />
        </div>
      </div>

      {/* Restoring writes to the live database, so it needs deliberate confirmation. */}
      <Modal open={!!pendingFile} onClose={() => !busy && setPendingFile(null)} title="Restore from backup?"
        subtitle={pendingFile?.name}
        footer={<>
          <Button variant="secondary" onClick={() => setPendingFile(null)} disabled={!!busy}>Cancel</Button>
          <Button variant="danger" onClick={doRestore} disabled={!!busy || confirmText.trim().toUpperCase() !== 'RESTORE'}>
            {busy === 'restore' ? <><Loader2 size={15} className="animate-spin" /> Restoring…</> : <>Restore {previewRows.toLocaleString()} rows</>}
          </Button>
        </>}>
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg bg-canvas px-4 py-3 text-sm text-navy">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-status-warning" />
            <p>
              This writes the file's rows into the live database, <b>overwriting any record with the same id</b>.
              It never deletes: anything created since this backup was taken stays. User accounts and login history are skipped — those belong to Supabase Auth.
            </p>
          </div>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-black/10 bg-white p-1">
            {preview.map((c) => (
              <div key={c.table} className="flex items-center gap-2 px-2 py-1 text-xs">
                <span className="font-medium text-navy">{c.table}</span><span className="ml-auto text-status-neutral">{c.rows.toLocaleString()} rows</span>
              </div>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Type RESTORE to confirm</span>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE"
              className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand" />
          </label>
        </div>
      </Modal>
    </div>
  )
}

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

      <BackupPanel />

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
