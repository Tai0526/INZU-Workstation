import { useSyncExternalStore } from 'react'
import { ROLES, BRANCHES, type RoleKey, type BranchCode } from '@/lib/roles'
import type { ModuleKey, Permission, PermMap } from '@/lib/permissions'
import { registerCrossTabSync } from '@/lib/storage/sync'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { supaUsersStore } from './profiles'

/**
 * Identity store — the shell-phase "backend" for authentication. Users are
 * created by an admin (no self sign-up); everyone must log in. Passwords are
 * stored locally for the demo (NOT secure — a real backend hashes them server
 * side). Swapping to a real API later means replacing this module's internals.
 */

export interface AppUser {
  id: string
  username: string
  password: string // shell-phase only
  full_name: string
  email: string
  role: RoleKey
  branch: BranchCode
  extra_branches: BranchCode[] // additional branches this user may view
  perm_overrides: PermMap // per-user module permission overrides (win over role default)
  hidden_pages: string[] // nav paths hidden from this user
  is_employee: boolean
  employee_id: string // link into HR employees ('' if none)
  active: boolean
  created_at: string
  created_by: string
  last_login_at: string
  login_count: number
}
export type NewUser = Omit<AppUser, 'id' | 'created_at' | 'created_by' | 'last_login_at' | 'login_count'>

export interface SessionEvent {
  id: string
  user_id: string
  username: string
  full_name: string
  role: RoleKey
  at: string
}

const UKEY = 'inzu_users'
const SKEY = 'inzu_sessions'
const A = '2026-01-01T00:00:00.000Z'

function mk(
  id: string, username: string, password: string, full_name: string, role: RoleKey, branch: BranchCode,
  opts: Partial<AppUser> = {},
): AppUser {
  return {
    id, username, password, full_name, email: `${username}@inzumcs.com`, role, branch,
    extra_branches: [], perm_overrides: {}, hidden_pages: [], is_employee: false, employee_id: '',
    active: true, created_at: A, created_by: 'System (seed)', last_login_at: '', login_count: 0, ...opts,
  }
}

// Seed: just the administrator account. All other users are created in Admin → Users.
const SEED: AppUser[] = [
  mk('U-ADMIN', 'admin', 'admin123', 'System Administrator', 'administrator', 'trident', { extra_branches: ['kansanshi'], email: 'admin@inzumcs.com' }),
]

// ── Users ───────────────────────────────────────────────────────────────
// Demo accounts that earlier builds seeded — pruned on load so only the admin
// (and any real accounts) remain.
const DEMO_SEED_IDS = ['U-OPS', 'U-AOPS', 'U-SAFE', 'U-TRACK', 'U-FUEL', 'U-BUS', 'U-ROUTE', 'U-WORK', 'U-HR', 'U-PAY', 'U-MD']
let uCache: AppUser[] | null = null
const uListeners = new Set<() => void>()
function loadUsers(): AppUser[] {
  if (uCache) return uCache
  try {
    const raw = localStorage.getItem(UKEY)
    if (raw) {
      const arr = (JSON.parse(raw) as AppUser[]).map(normalize)
      const pruned = arr
        .filter((u) => !(DEMO_SEED_IDS.includes(u.id) && u.created_by === 'System (seed)'))
        // Migrate the seed admin from the old MD role to the dedicated Administrator role.
        .map((u) => (u.id === 'U-ADMIN' && u.role === 'managing_director' ? { ...u, role: 'administrator' as RoleKey } : u))
      uCache = pruned
      if (JSON.stringify(pruned) !== JSON.stringify(arr)) localStorage.setItem(UKEY, JSON.stringify(pruned))
    } else {
      uCache = SEED
      localStorage.setItem(UKEY, JSON.stringify(SEED))
    }
  } catch {
    uCache = SEED
  }
  return uCache!
}
function normalize(u: any): AppUser {
  return {
    extra_branches: [], perm_overrides: {}, hidden_pages: [], is_employee: false, employee_id: '',
    active: true, last_login_at: '', login_count: 0, ...u,
  }
}
function commitUsers(next: AppUser[]) {
  uCache = next
  localStorage.setItem(UKEY, JSON.stringify(next))
  uListeners.forEach((l) => l())
}
function newId(p: string) {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${p}_${Date.now()}_${Math.round(Math.random() * 1e5)}`
}

// ── Sessions / login history ─────────────────────────────────────────────
let sCache: SessionEvent[] | null = null
const sListeners = new Set<() => void>()
function loadSessions(): SessionEvent[] {
  if (sCache) return sCache
  try { const raw = localStorage.getItem(SKEY); sCache = raw ? (JSON.parse(raw) as SessionEvent[]) : [] } catch { sCache = [] }
  return sCache!
}
function commitSessions(next: SessionEvent[]) {
  sCache = next
  localStorage.setItem(SKEY, JSON.stringify(next))
  sListeners.forEach((l) => l())
}
// Live-sync accounts + login history across tabs/windows (e.g. an admin edits a
// user's role or deactivates them while that user is signed in elsewhere).
registerCrossTabSync(UKEY, () => { uCache = null; loadUsers(); uListeners.forEach((l) => l()) })
registerCrossTabSync(SKEY, () => { sCache = null; loadSessions(); sListeners.forEach((l) => l()) })

export const usersStore = {
  list: (): AppUser[] => loadUsers(),
  byId: (id: string): AppUser | undefined => loadUsers().find((u) => u.id === id),

  authenticate(username: string, password: string): { ok: true; user: AppUser } | { ok: false; reason: string } {
    const u = loadUsers().find((x) => x.username.toLowerCase() === username.trim().toLowerCase())
    if (!u) return { ok: false, reason: 'No account with that username.' }
    if (u.password !== password) return { ok: false, reason: 'Incorrect password.' }
    if (!u.active) return { ok: false, reason: 'This account is deactivated. Contact the administrator.' }
    return { ok: true, user: u }
  },

  recordLogin(id: string) {
    const now = new Date().toISOString()
    commitUsers(loadUsers().map((u) => (u.id === id ? { ...u, last_login_at: now, login_count: (u.login_count ?? 0) + 1 } : u)))
    const u = loadUsers().find((x) => x.id === id)
    if (u) {
      const ev: SessionEvent = { id: newId('s'), user_id: u.id, username: u.username, full_name: u.full_name, role: u.role, at: now }
      commitSessions([ev, ...loadSessions()].slice(0, 100))
    }
  },

  add(data: NewUser): AppUser {
    const u: AppUser = { ...data, id: newId('U'), created_at: new Date().toISOString(), created_by: 'admin', last_login_at: '', login_count: 0 }
    commitUsers([...loadUsers(), u])
    return u
  },
  update(id: string, patch: Partial<AppUser>) {
    commitUsers(loadUsers().map((u) => (u.id === id ? { ...u, ...patch, id: u.id } : u)))
  },
  remove(id: string) { commitUsers(loadUsers().filter((u) => u.id !== id)) },

  setOverride(id: string, module: ModuleKey, perm: Permission | undefined) {
    const u = usersStore.byId(id); if (!u) return
    const next = { ...u.perm_overrides }
    if (perm === undefined) delete next[module]; else next[module] = perm
    usersStore.update(id, { perm_overrides: next })
  },

  subscribe(cb: () => void) { uListeners.add(cb); return () => uListeners.delete(cb) },
}

export const sessionsStore = {
  list: (): SessionEvent[] => loadSessions(),
  subscribe(cb: () => void) { sListeners.add(cb); return () => sListeners.delete(cb) },
}

// The live user directory: the Supabase `profiles` table when configured, else
// the local seed store. Same AppUser[] shape either way.
const directory = isSupabaseConfigured ? supaUsersStore : usersStore
export function useUsers(): AppUser[] {
  return useSyncExternalStore(directory.subscribe, directory.list, directory.list)
}
export function useSessions(): SessionEvent[] {
  return useSyncExternalStore(sessionsStore.subscribe, sessionsStore.list, sessionsStore.list)
}

/** Branches a user may view — both for cross-branch roles, else home + granted extras. */
export function allowedBranches(u: Pick<AppUser, 'role' | 'branch' | 'extra_branches'>): BranchCode[] {
  if (ROLES[u.role]?.crossBranch) return BRANCHES.map((b) => b.code)
  return Array.from(new Set([u.branch, ...(u.extra_branches ?? [])]))
}
