import { useSyncExternalStore } from 'react'
import type { RoleKey } from './roles'
import { registerCrossTabSync } from '@/lib/storage/sync'

// Top-level module keys used for navigation + access gating.
export type ModuleKey =
  | 'dashboard'
  | 'fleet'
  | 'drivers'
  | 'speed'
  | 'operations'
  | 'safety'
  | 'workshop'
  | 'payroll'
  | 'hr'
  | 'petty_cash'
  | 'documents'
  | 'admin'

export type Permission = 'none' | 'view' | 'edit'
export type PermMap = Partial<Record<ModuleKey, Permission>>

export const MODULE_LABEL: Record<ModuleKey, string> = {
  dashboard: 'Dashboard', fleet: 'Fleet', drivers: 'Drivers', speed: 'Speed Management',
  operations: 'Operations', safety: 'Safety', workshop: 'Workshop', payroll: 'Payroll',
  hr: 'HR', petty_cash: 'Petty Cash', documents: 'Documents', admin: 'Admin',
}
export const MODULE_KEYS = Object.keys(MODULE_LABEL) as ModuleKey[]

/**
 * Baseline every authenticated role gets. Editable role defaults sit on top of
 * this in `rolePermsStore`; a per-user override (set in Admin) wins over both.
 */
const BASE: PermMap = {
  dashboard: 'view',
  petty_cash: 'edit',
  documents: 'view',
}

// Built-in starting permissions per role — the admin can change these at runtime.
export const DEFAULT_OVERRIDES: Record<RoleKey, PermMap> = {
  administrator: { fleet: 'edit', drivers: 'edit', speed: 'edit', operations: 'edit', safety: 'edit', workshop: 'edit', payroll: 'edit', hr: 'edit', documents: 'edit', admin: 'edit' },
  board_chairman: { fleet: 'view', drivers: 'view', speed: 'view', operations: 'view', safety: 'view', workshop: 'view', payroll: 'view', hr: 'view' },
  board_member: { fleet: 'view', drivers: 'view', speed: 'view', operations: 'view', safety: 'view', workshop: 'view', payroll: 'view', hr: 'view' },
  finance_director: { fleet: 'view', drivers: 'view', speed: 'view', operations: 'view', safety: 'view', workshop: 'view', payroll: 'view', hr: 'view' },
  // Only the Administrator role manages the system by default. The MD and Ops
  // Manager keep full operational reach but NOT the Admin page — an admin can
  // still grant it per-user via a permission override if they want a deputy.
  managing_director: { fleet: 'view', drivers: 'view', speed: 'view', operations: 'view', safety: 'view', workshop: 'view', payroll: 'edit', hr: 'view', documents: 'edit' },

  operations_manager: { fleet: 'edit', drivers: 'edit', speed: 'edit', operations: 'edit', safety: 'edit', workshop: 'view', payroll: 'edit', hr: 'view', documents: 'edit' },
  asst_operations_manager: { fleet: 'edit', drivers: 'edit', speed: 'edit', operations: 'edit', safety: 'view', workshop: 'view', payroll: 'view', hr: 'view', documents: 'edit' },

  hr_manager: { hr: 'edit', drivers: 'edit', documents: 'edit' },
  hr_officer: { hr: 'edit', drivers: 'edit' },

  payroll_officer: { payroll: 'edit' },

  safety_officer: { safety: 'edit', drivers: 'edit', hr: 'view', documents: 'edit' },
  workshop_supervisor: { workshop: 'edit', fleet: 'edit', hr: 'view', documents: 'edit' },
  route_supervisor: { drivers: 'edit', operations: 'view' },

  bus_controller: { operations: 'edit' },
  tracker: { speed: 'edit', operations: 'edit' },
  fuel_controller: { operations: 'edit' },

  viewer: { fleet: 'view', drivers: 'view', operations: 'view', safety: 'view', workshop: 'view' },
}

// ── Editable role-default store (persisted) ─────────────────────────────
const KEY = 'inzu_role_perms'
// One-time marker: older builds persisted an Admin-page default for the Ops
// Manager / MD. Admin is now Administrator-only by default, so we strip that
// legacy grant once. Guarded by this key so an admin can still re-grant it later.
const ADMIN_DEFAULT_MIGRATION = 'inzu_role_perms_admin_only_v2'
let cache: Record<RoleKey, PermMap> | null = null
const listeners = new Set<() => void>()
function load(): Record<RoleKey, PermMap> {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    const saved = raw ? (JSON.parse(raw) as Record<RoleKey, PermMap>) : null
    if (typeof localStorage !== 'undefined' && localStorage.getItem(ADMIN_DEFAULT_MIGRATION) !== '1') {
      if (saved) {
        for (const r of ['operations_manager', 'managing_director'] as RoleKey[]) {
          if (saved[r] && saved[r]!.admin) { const m = { ...saved[r] }; delete m.admin; saved[r] = m }
        }
        localStorage.setItem(KEY, JSON.stringify(saved))
      }
      localStorage.setItem(ADMIN_DEFAULT_MIGRATION, '1')
    }
    cache = saved ? { ...DEFAULT_OVERRIDES, ...saved } : DEFAULT_OVERRIDES
  } catch {
    cache = DEFAULT_OVERRIDES
  }
  return cache!
}
function commit(next: Record<RoleKey, PermMap>) {
  cache = next
  localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
}
registerCrossTabSync(KEY, () => { cache = null; load(); listeners.forEach((l) => l()) })
export const rolePermsStore = {
  get: (): Record<RoleKey, PermMap> => load(),
  setPerm(role: RoleKey, module: ModuleKey, perm: Permission) {
    const cur = load()
    commit({ ...cur, [role]: { ...cur[role], [module]: perm } })
  },
  resetRole(role: RoleKey) {
    const cur = { ...load() }
    cur[role] = { ...DEFAULT_OVERRIDES[role] }
    commit(cur)
  },
  resetAll() { commit({ ...DEFAULT_OVERRIDES }) },
  subscribe(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) },
}
export function useRolePerms(): Record<RoleKey, PermMap> {
  return useSyncExternalStore(rolePermsStore.subscribe, rolePermsStore.get, rolePermsStore.get)
}

// ── Active user's per-user overrides (set by AuthContext) ───────────────
// permFor is called as permFor(role, module) throughout the app, always with the
// CURRENT user's role — so we apply that user's overrides here without changing
// every call site.
let activeRole: RoleKey | null = null
let activeOverrides: PermMap = {}
export function setActivePermissions(role: RoleKey | null, overrides: PermMap) {
  activeRole = role
  activeOverrides = overrides ?? {}
}

/** Effective permission for a role on a module (role default + active user override). */
export function permFor(role: RoleKey, module: ModuleKey): Permission {
  // The Administrator always has full access — it can never be locked out.
  if (role === 'administrator') return 'edit'
  const roleMap = { ...BASE, ...load()[role] }
  let p: Permission = roleMap[module] ?? 'none'
  if (role === activeRole && activeOverrides[module] !== undefined) p = activeOverrides[module]!
  return p
}
/** Role default only (ignores per-user overrides) — for the Admin permission editor. */
export function roleDefault(role: RoleKey, module: ModuleKey): Permission {
  return ({ ...BASE, ...load()[role] }[module]) ?? 'none'
}

export function canView(role: RoleKey, module: ModuleKey): boolean {
  const p = permFor(role, module)
  return p === 'view' || p === 'edit'
}
export function canEdit(role: RoleKey, module: ModuleKey): boolean {
  return permFor(role, module) === 'edit'
}
