import { useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { RoleKey, BranchCode } from '@/lib/roles'
import type { PermMap } from '@/lib/permissions'
import type { AppUser } from './users'

/**
 * Supabase-backed user directory (the `profiles` table). Mirrors the legacy
 * usersStore's read surface (list / byId / subscribe → useUsers) so messaging,
 * document sharing and the admin table keep working unchanged, plus the
 * privileged actions that run through the `admin-users` Edge Function.
 *
 * Reads are cached and refreshed after every mutation; the cache hydrates on the
 * first subscription (i.e. once something renders the directory).
 */

interface ProfileRow {
  id: string
  username: string | null
  full_name: string
  email: string | null
  role: RoleKey
  branch: BranchCode
  extra_branches: BranchCode[] | null
  perm_overrides: PermMap | null
  hidden_pages: string[] | null
  is_employee: boolean
  employee_id: string | null
  active: boolean
  must_change_password: boolean
  created_at: string
  created_by: string | null
  last_login_at: string | null
  login_count: number
}

export function rowToUser(r: ProfileRow): AppUser {
  return {
    id: r.id,
    username: r.username ?? (r.email ? r.email.split('@')[0] : r.id),
    password: '', // never exposed — auth lives in Supabase
    full_name: r.full_name ?? '',
    email: r.email ?? '',
    role: r.role,
    branch: r.branch,
    extra_branches: r.extra_branches ?? [],
    perm_overrides: r.perm_overrides ?? {},
    hidden_pages: r.hidden_pages ?? [],
    is_employee: !!r.is_employee,
    employee_id: r.employee_id ?? '',
    active: !!r.active,
    created_at: r.created_at,
    created_by: r.created_by ?? '',
    last_login_at: r.last_login_at ?? '',
    login_count: r.login_count ?? 0,
  }
}

let cache: AppUser[] = []
let hydrating = false
let hydratedOnce = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

async function hydrate(): Promise<void> {
  if (!supabase) return
  hydrating = true
  const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true })
  hydrating = false
  hydratedOnce = true
  if (!error && data) {
    cache = (data as ProfileRow[]).map(rowToUser)
    emit()
  }
}

export interface CreateUserInput {
  email: string
  full_name: string
  role: RoleKey
  branch: BranchCode
  username?: string
  password?: string
  extra_branches?: BranchCode[]
  perm_overrides?: PermMap
  hidden_pages?: string[]
  is_employee?: boolean
  employee_id?: string
}

async function invoke(action: string, payload: Record<string, unknown>): Promise<any> {
  if (!supabase) throw new Error('Supabase not configured')
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { action, ...payload } })
  if (error) {
    // Surface the function's JSON error message when present.
    const msg = (data && (data as any).error) || error.message
    throw new Error(msg)
  }
  if (data && (data as any).error) throw new Error((data as any).error)
  return data
}

export const supaUsersStore = {
  list: (): AppUser[] => cache,
  byId: (id: string): AppUser | undefined => cache.find((u) => u.id === id),
  refresh: hydrate,

  /** Create an account (temp password + forced change). Returns the temp password to share. */
  async createUser(input: CreateUserInput): Promise<{ user_id: string; temp_password: string }> {
    const res = await invoke('create', {
      email: input.email, full_name: input.full_name, role: input.role, branch: input.branch,
      username: input.username, password: input.password, extra_branches: input.extra_branches,
      perm_overrides: input.perm_overrides, hidden_pages: input.hidden_pages,
      is_employee: input.is_employee, employee_id: input.employee_id,
    })
    await hydrate()
    return res
  },
  /** Reset a user's password to a new temporary one (forces change on next login). */
  async resetPassword(userId: string, password?: string): Promise<{ temp_password: string }> {
    return invoke('reset_password', { user_id: userId, password })
  },
  /** Activate / deactivate an account (also bans the auth login when off). */
  async setActive(userId: string, active: boolean): Promise<void> {
    await invoke('set_active', { user_id: userId, active })
    await hydrate()
  },
  /** Permanently delete an account. */
  async deleteUser(userId: string): Promise<void> {
    await invoke('delete', { user_id: userId })
    await hydrate()
  },
  /** Update non-credential profile fields (role, branch, permissions, etc.). */
  async updateProfile(id: string, patch: Partial<ProfileRow>): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured')
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    await hydrate()
  },

  subscribe(cb: () => void) {
    if (!hydratedOnce && !hydrating) void hydrate()
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
}

export function useSupaUsers(): AppUser[] {
  return useSyncExternalStore(supaUsersStore.subscribe, supaUsersStore.list, supaUsersStore.list)
}
