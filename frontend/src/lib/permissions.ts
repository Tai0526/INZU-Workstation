import { useSyncExternalStore } from 'react'
import type { RoleKey } from './roles'
import { createSyncConfig } from '@/lib/supabase/syncTable'

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

  // HR Manager can view Safety to conclude disciplinary / speeding cases alongside Ops.
  hr_manager: { hr: 'edit', drivers: 'edit', safety: 'view', documents: 'edit' },
  hr_officer: { hr: 'edit', drivers: 'edit' },

  payroll_officer: { payroll: 'edit' },

  safety_officer: { safety: 'edit', drivers: 'edit', hr: 'view', documents: 'edit' },
  workshop_supervisor: { workshop: 'edit', fleet: 'edit', hr: 'view', documents: 'edit' },
  route_supervisor: { drivers: 'edit', operations: 'view' },

  bus_controller: { operations: 'edit' },
  tracker: { speed: 'edit', operations: 'edit' },
  fuel_controller: { operations: 'edit' },
  fuel_supervisor: { operations: 'edit' },

  viewer: { fleet: 'view', drivers: 'view', operations: 'view', safety: 'view', workshop: 'view' },
}

// ── Editable role-default store (persisted) ─────────────────────────────
const KEY = 'inzu_role_perms'
const permsCfg = createSyncConfig<Record<RoleKey, PermMap>>({
  key: 'role_perms', lsKey: KEY, default: DEFAULT_OVERRIDES,
  merge: (saved) => ({ ...DEFAULT_OVERRIDES, ...saved }),
})
function load(): Record<RoleKey, PermMap> { return permsCfg.get() }
function commit(next: Record<RoleKey, PermMap>) { permsCfg.set(next) }
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
  subscribe: permsCfg.subscribe,
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
