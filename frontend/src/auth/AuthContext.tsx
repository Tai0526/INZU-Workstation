import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { BranchCode } from '@/lib/roles'
import { setActor } from '@/lib/audit/actor'
import { setActivePermissions, rolePermsStore, roleDefault } from '@/lib/permissions'
import { brandingStore } from '@/lib/roles'
import { usersStore, allowedBranches, type AppUser } from '@/lib/auth/users'
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'
import { rowToUser, supaUsersStore } from '@/lib/auth/profiles'

/**
 * Authentication. When Supabase is configured this is backed by Supabase Auth
 * (email + password, bcrypt-hashed server-side); otherwise it falls back to the
 * local shell store so the app still runs before/without setup.
 *
 * `user` reflects the live record plus the session's active view-branch, so admin
 * edits to role / branch / permissions take effect immediately.
 */

export type SessionUser = AppUser & { fullName: string }

interface AuthValue {
  user: SessionUser | null
  login: (emailOrUsername: string, password: string) => Promise<{ ok: boolean; reason?: string; landing?: string }>
  logout: () => void
  setBranch: (branch: BranchCode) => void
  branches: BranchCode[]
  hiddenPages: Set<string>
  /** True when the signed-in user must set a new password before using the app. */
  mustChangePassword: boolean
  changePassword: (newPassword: string) => Promise<{ ok: boolean; reason?: string }>
}

const AuthContext = createContext<AuthValue | null>(null)
const VIEW_BRANCH_KEY = 'inzu_view_branch'

function applyActor(user: SessionUser | null) {
  if (user) {
    setActor({ name: user.fullName, role: user.role })
    setActivePermissions(user.role, user.perm_overrides)
  } else {
    setActor({ name: 'System', role: 'system' })
    setActivePermissions(null, {})
  }
}

function landingFor(u: Pick<AppUser, 'role' | 'perm_overrides'>): string {
  const adminPerm = u.perm_overrides?.admin ?? roleDefault(u.role, 'admin')
  return adminPerm === 'view' || adminPerm === 'edit' ? '/admin' : '/'
}

// ════════════════════════════════════════════════════ Supabase-backed provider
function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<AppUser | null>(null)
  const [mustChange, setMustChange] = useState(false)
  const [ready, setReady] = useState(false)
  const [viewBranch, setViewBranch] = useState<BranchCode | null>(() => {
    try { return (sessionStorage.getItem(VIEW_BRANCH_KEY) as BranchCode) || null } catch { return null }
  })
  const [, bump] = useState(0)

  // Re-render when role-permission / branding stores change (admin edits).
  useEffect(() => {
    const p = rolePermsStore.subscribe(() => bump((n) => n + 1))
    const b = brandingStore.subscribe(() => bump((n) => n + 1))
    return () => { p(); b() }
  }, [])

  async function loadProfile(userId: string): Promise<AppUser | null> {
    if (!supabase) return null
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (error || !data) return null
    setMustChange(!!(data as any).must_change_password)
    void supaUsersStore.refresh() // keep the directory warm for the rest of the app
    return rowToUser(data as any)
  }

  // Bootstrap: current session + react to auth changes.
  useEffect(() => {
    if (!supabase) { setReady(true); return }
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session) setProfile(await loadProfile(data.session.user.id))
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!active) return
      setSession(s)
      setProfile(s ? await loadProfile(s.user.id) : null)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allowed = profile && profile.active ? allowedBranches(profile) : []
  const branch: BranchCode = profile
    ? (viewBranch && allowed.includes(viewBranch) ? viewBranch : profile.branch)
    : 'kansanshi'
  const user: SessionUser | null = profile && profile.active && session
    ? { ...profile, branch, fullName: profile.full_name }
    : null

  applyActor(user)

  const login: AuthValue['login'] = async (emailOrUsername, password) => {
    if (!supabase) return { ok: false, reason: 'Supabase is not configured.' }
    const email = emailOrUsername.trim()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) return { ok: false, reason: error?.message || 'Sign-in failed.' }
    const prof = await loadProfile(data.user.id)
    if (!prof) {
      await supabase.auth.signOut()
      return { ok: false, reason: 'No profile found for this account. Has the database setup (0001_init.sql) been run, and your account promoted?' }
    }
    if (!prof.active) {
      await supabase.auth.signOut()
      return { ok: false, reason: 'This account is deactivated. Contact the administrator.' }
    }
    setSession(data.session)
    setProfile(prof)
    void supabase.rpc('record_login').then(() => {}, () => {}) // fire-and-forget (builder executes on .then)
    return { ok: true, landing: landingFor(prof) }
  }

  const logout = () => { void supabase?.auth.signOut(); setSession(null); setProfile(null); setMustChange(false) }

  const setBranch = (b: BranchCode) => {
    if (!allowed.includes(b)) return
    setViewBranch(b)
    try { sessionStorage.setItem(VIEW_BRANCH_KEY, b) } catch { /* ignore */ }
  }

  const changePassword: AuthValue['changePassword'] = async (newPassword) => {
    if (!supabase) return { ok: false, reason: 'Supabase is not configured.' }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { ok: false, reason: error.message }
    await supabase.rpc('complete_password_change')
    setMustChange(false)
    if (session) setProfile(await loadProfile(session.user.id))
    return { ok: true }
  }

  if (!ready) {
    return <div className="flex h-screen w-screen items-center justify-center bg-canvas text-sm text-status-neutral">Loading…</div>
  }

  return (
    <AuthContext.Provider value={{
      user, login, logout, setBranch, branches: allowed,
      hiddenPages: new Set(profile?.role === 'administrator' ? [] : (profile?.hidden_pages ?? [])),
      mustChangePassword: !!user && mustChange,
      changePassword,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

// ════════════════════════════════════════════════════ Local fallback provider
const LS_KEY = 'inzu_session'
interface LocalSession { userId: string; viewBranch: BranchCode }
function loadLocalSession(): LocalSession | null {
  try { const raw = sessionStorage.getItem(LS_KEY); return raw ? (JSON.parse(raw) as LocalSession) : null } catch { return null }
}

function LocalAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LocalSession | null>(loadLocalSession)
  const [, bump] = useState(0)

  useEffect(() => {
    const onChange = () => bump((n) => n + 1)
    const u = usersStore.subscribe(onChange)
    const p = rolePermsStore.subscribe(onChange)
    const b = brandingStore.subscribe(onChange)
    return () => { u(); p(); b() }
  }, [])

  const record = session ? usersStore.byId(session.userId) : undefined
  const valid = record && record.active ? record : undefined
  const allowed = valid ? allowedBranches(valid) : []
  const viewBranch = valid ? (allowed.includes(session!.viewBranch) ? session!.viewBranch : valid.branch) : 'kansanshi'
  const user: SessionUser | null = valid ? { ...valid, branch: viewBranch, fullName: valid.full_name } : null

  applyActor(user)

  useEffect(() => {
    if (session && valid) sessionStorage.setItem(LS_KEY, JSON.stringify({ userId: session.userId, viewBranch }))
    else if (!valid) sessionStorage.removeItem(LS_KEY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId, viewBranch, !!valid])

  const login: AuthValue['login'] = async (username, password) => {
    const res = usersStore.authenticate(username, password)
    if (!res.ok) return { ok: false, reason: res.reason }
    usersStore.recordLogin(res.user.id)
    setSession({ userId: res.user.id, viewBranch: res.user.branch })
    return { ok: true, landing: landingFor(res.user) }
  }
  const logout = () => setSession(null)
  const setBranch = (branch: BranchCode) => { if (allowed.includes(branch)) setSession((s) => (s ? { ...s, viewBranch: branch } : s)) }
  const changePassword: AuthValue['changePassword'] = async (newPassword) => {
    if (!user) return { ok: false, reason: 'Not signed in.' }
    usersStore.update(user.id, { password: newPassword })
    return { ok: true }
  }

  return (
    <AuthContext.Provider value={{
      user, login, logout, setBranch, branches: allowed,
      hiddenPages: new Set(valid?.role === 'administrator' ? [] : (valid?.hidden_pages ?? [])),
      mustChangePassword: false,
      changePassword,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const AuthProvider = isSupabaseConfigured ? SupabaseAuthProvider : LocalAuthProvider

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
