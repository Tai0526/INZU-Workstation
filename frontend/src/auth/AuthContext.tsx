import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { BranchCode } from '@/lib/roles'
import { setActor } from '@/lib/audit/actor'
import { setActivePermissions, rolePermsStore, roleDefault } from '@/lib/permissions'
import { brandingStore } from '@/lib/roles'
import { usersStore, allowedBranches, type AppUser } from '@/lib/auth/users'

/**
 * Authentication for the shell phase. Every user must log in with credentials
 * created by an admin (no self sign-up). The identity "backend" is usersStore.
 * The exposed `user` reflects the live record (so admin edits to role / branch /
 * permissions take effect immediately) plus the session's active view-branch.
 */

export type SessionUser = AppUser & { fullName: string }

interface AuthValue {
  user: SessionUser | null
  login: (username: string, password: string) => { ok: boolean; reason?: string; landing?: string }
  logout: () => void
  setBranch: (branch: BranchCode) => void
  branches: BranchCode[] // branches the current user may view
  hiddenPages: Set<string>
}

// The session lives in sessionStorage (per tab/window), NOT localStorage — so the
// SAME browser can have several windows open, each signed in as a different user,
// while all the data stores stay shared in localStorage. This is what makes
// simultaneous multi-user testing possible on one machine. (sessionStorage
// survives a refresh of the same tab and clears when that tab closes.)
const LS_KEY = 'inzu_session'
const AuthContext = createContext<AuthValue | null>(null)

interface Session { userId: string; viewBranch: BranchCode }
function loadSession(): Session | null {
  try { const raw = sessionStorage.getItem(LS_KEY); return raw ? (JSON.parse(raw) as Session) : null } catch { return null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [, bump] = useState(0)

  // Re-render when the identity or role-permission stores change (admin edits).
  useEffect(() => {
    const onChange = () => bump((n) => n + 1)
    const u = usersStore.subscribe(onChange)
    const p = rolePermsStore.subscribe(onChange)
    const b = brandingStore.subscribe(onChange)
    return () => { u(); p(); b() }
  }, [])

  // Resolve the live user record; drop the session if the account is gone/disabled.
  const record = session ? usersStore.byId(session.userId) : undefined
  const valid = record && record.active ? record : undefined
  const allowed = valid ? allowedBranches(valid) : []
  const viewBranch = valid ? (allowed.includes(session!.viewBranch) ? session!.viewBranch : valid.branch) : 'kansanshi'
  const user: SessionUser | null = valid ? { ...valid, branch: viewBranch, fullName: valid.full_name } : null

  // Keep audit actor + active permission overrides in sync with the current user.
  // Done during render (not in an effect) so canView/canEdit see the right
  // overrides on the very first render after login or an admin edit.
  if (user) {
    setActor({ name: user.fullName, role: user.role })
    setActivePermissions(user.role, user.perm_overrides)
  } else {
    setActor({ name: 'System', role: 'system' })
    setActivePermissions(null, {})
  }

  // Persist / clear the session (per tab — see note on LS_KEY above).
  useEffect(() => {
    if (session && valid) sessionStorage.setItem(LS_KEY, JSON.stringify({ userId: session.userId, viewBranch }))
    else if (!valid) sessionStorage.removeItem(LS_KEY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId, viewBranch, !!valid])

  const login: AuthValue['login'] = (username, password) => {
    const res = usersStore.authenticate(username, password)
    if (!res.ok) return { ok: false, reason: res.reason }
    usersStore.recordLogin(res.user.id)
    setSession({ userId: res.user.id, viewBranch: res.user.branch })
    // Admins land on the Admin page; everyone else on the Dashboard.
    const adminPerm = res.user.perm_overrides.admin ?? roleDefault(res.user.role, 'admin')
    return { ok: true, landing: adminPerm === 'view' || adminPerm === 'edit' ? '/admin' : '/' }
  }
  const logout = () => setSession(null)
  const setBranch = (branch: BranchCode) => {
    if (!allowed.includes(branch)) return
    setSession((s) => (s ? { ...s, viewBranch: branch } : s))
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, setBranch, branches: allowed, hiddenPages: new Set(valid?.role === 'administrator' ? [] : (valid?.hidden_pages ?? [])) }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
