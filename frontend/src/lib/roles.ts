import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

// ── Branches (spec §2) ────────────────────────────────────────────────
// Two fixed branch codes; their display ("client") names are admin-editable.
export type BranchCode = 'kansanshi' | 'trident'
export const BRANCH_CODES: BranchCode[] = ['kansanshi', 'trident']

export interface BranchBrand { label: string; short: string }
// Defaults: Kansanshi is just "Kansanshi"; Trident is "FQM Trident".
const DEFAULT_BRANDING: Record<BranchCode, BranchBrand> = {
  kansanshi: { label: 'Kansanshi', short: 'Kansanshi' },
  trident: { label: 'FQM Trident', short: 'Trident' },
}

const BRAND_KEY = 'inzu_branding'
const brandCfg = createSyncConfig<Record<BranchCode, BranchBrand>>({
  key: 'branding', lsKey: BRAND_KEY, default: DEFAULT_BRANDING,
  merge: (saved) => ({ ...DEFAULT_BRANDING, ...saved }),
})
const brandListeners = new Set<() => void>()
function loadBrand(): Record<BranchCode, BranchBrand> { return brandCfg.get() }
function buildBranches() {
  const b = loadBrand()
  return BRANCH_CODES.map((code) => ({ code, label: b[code].label, short: b[code].short }))
}

/** Live list of branches with their current display names. Rebuilt when the
 *  admin renames a branch (importers see the updated value via ES live bindings). */
export let BRANCHES: { code: BranchCode; label: string; short: string }[] = buildBranches()
// Rebuild the live binding whenever branding changes (Supabase hydrate/realtime,
// a local edit, or a cross-tab update).
brandCfg.subscribe(() => { BRANCHES = buildBranches(); brandListeners.forEach((l) => l()) })

export const brandingStore = {
  get: (): Record<BranchCode, BranchBrand> => loadBrand(),
  set(code: BranchCode, brand: BranchBrand) { brandCfg.set({ ...loadBrand(), [code]: brand }) },
  reset() { brandCfg.set({ ...DEFAULT_BRANDING }) },
  subscribe(cb: () => void) { brandListeners.add(cb); return () => brandListeners.delete(cb) },
}
export function useBranches() {
  return useSyncExternalStore(brandingStore.subscribe, () => BRANCHES, () => BRANCHES)
}

// ── The sixteen roles (spec §2.2) ─────────────────────────────────────
export type RoleKey =
  | 'administrator'
  | 'board_chairman'
  | 'board_member'
  | 'managing_director'
  | 'finance_director'
  | 'operations_manager'
  | 'asst_operations_manager'
  | 'hr_manager'
  | 'hr_officer'
  | 'payroll_officer'
  | 'safety_officer'
  | 'workshop_supervisor'
  | 'route_supervisor'
  | 'bus_controller'
  | 'tracker'
  | 'fuel_controller'
  | 'fuel_supervisor'
  | 'viewer'

export interface RoleMeta {
  key: RoleKey
  label: string
  /** Roles that span both branches by nature see "both" and cannot be branch-locked. */
  crossBranch: boolean
  /** Senior roles permitted to toggle branch on Speed Management & Operations (spec §3.3, §4.4.1). */
  canToggleBranch: boolean
  /** Holds administrative privilege → Admin module visible (spec §4.12). */
  isAdmin: boolean
  blurb: string
}

export const ROLES: Record<RoleKey, RoleMeta> = {
  administrator: {
    key: 'administrator', label: 'Administrator', crossBranch: true, canToggleBranch: true, isAdmin: true,
    blurb: 'System administrator — manages users, permissions, branches, approvals and settings; full access across the workstation.',
  },
  board_chairman: {
    key: 'board_chairman', label: 'Board Chairman', crossBranch: true, canToggleBranch: true, isAdmin: false,
    blurb: 'Read-only executive dashboard across both branches. Top of the reporting chain.',
  },
  board_member: {
    key: 'board_member', label: 'Board Member', crossBranch: true, canToggleBranch: true, isAdmin: false,
    blurb: 'Read-only executive dashboard across both branches.',
  },
  managing_director: {
    key: 'managing_director', label: 'Managing Director', crossBranch: true, canToggleBranch: true, isAdmin: true,
    blurb: 'Read-only executive dashboard, plus final lock-approval on every payroll run.',
  },
  finance_director: {
    key: 'finance_director', label: 'Finance Director', crossBranch: true, canToggleBranch: true, isAdmin: false,
    blurb: 'Read-only executive dashboard. Not part of the payroll workflow.',
  },
  operations_manager: {
    key: 'operations_manager', label: 'Operations Manager', crossBranch: false, canToggleBranch: false, isAdmin: true,
    blurb: 'Branch-level operational authority. Second approver on mileage, fuel, petty cash and payroll.',
  },
  asst_operations_manager: {
    key: 'asst_operations_manager', label: 'Asst Operations Manager', crossBranch: false, canToggleBranch: false, isAdmin: false,
    blurb: 'Branch-level operational authority, mirrors the Operations Manager for most approval chains.',
  },
  hr_manager: {
    key: 'hr_manager', label: 'HR Manager', crossBranch: true, canToggleBranch: false, isAdmin: false,
    blurb: 'Single role spanning both branches. Oversees HR Officers, consolidated leave, employee records.',
  },
  hr_officer: {
    key: 'hr_officer', label: 'HR Officer', crossBranch: false, canToggleBranch: false, isAdmin: false,
    blurb: 'Per-branch HR administration: leave balance deductions, employee record upkeep.',
  },
  payroll_officer: {
    key: 'payroll_officer', label: 'Payroll Officer', crossBranch: false, canToggleBranch: false, isAdmin: false,
    blurb: 'Per-branch. Initiates and submits payroll runs, configures bank file order, generates payslips.',
  },
  safety_officer: {
    key: 'safety_officer', label: 'Safety Officer', crossBranch: false, canToggleBranch: false, isAdmin: false,
    blurb: 'Per-branch. Owns Incidents, Hazards, CAP, Driver Compliance, Training, LOTO, Tool Inspections. Manages General Worker leave.',
  },
  workshop_supervisor: {
    key: 'workshop_supervisor', label: 'Workshop Supervisor', crossBranch: false, canToggleBranch: false, isAdmin: false,
    blurb: 'Per-branch. Owns Job Cards, Checklists, PM Schedules, Tyres, Critical Spares, RCA. Manages Mechanic leave.',
  },
  route_supervisor: {
    key: 'route_supervisor', label: 'Route Supervisor', crossBranch: false, canToggleBranch: false, isAdmin: false,
    blurb: 'Per-branch. Plans routes and bus allocation only. Manages Driver leave. Cannot see mileage totals.',
  },
  bus_controller: {
    key: 'bus_controller', label: 'Bus Controller', crossBranch: false, canToggleBranch: false, isAdmin: false,
    blurb: 'Per-branch. Enters bus allocation against routes planned by the Route Supervisor.',
  },
  tracker: {
    key: 'tracker', label: 'Tracker', crossBranch: false, canToggleBranch: false, isAdmin: false,
    blurb: 'Per-branch. Enters daily mileage; flags speed events from Geotab data.',
  },
  fuel_controller: {
    key: 'fuel_controller', label: 'Fuel Attendant', crossBranch: false, canToggleBranch: false, isAdmin: false,
    blurb: 'Per-branch. Dispenses and records fuel — fuel issued, driver, vehicle and locations per fill-up.',
  },
  fuel_supervisor: {
    key: 'fuel_supervisor', label: 'Fuel Supervisor', crossBranch: false, canToggleBranch: false, isAdmin: false,
    blurb: 'Per-branch. Oversees fuelling and authorises non-fleet (visitor) vehicle fuel draws; records fuel like an attendant.',
  },
  viewer: {
    key: 'viewer', label: 'Viewer', crossBranch: false, canToggleBranch: false, isAdmin: false,
    blurb: 'Read-only access, scope assigned per use case.',
  },
}

export const ROLE_LIST: RoleMeta[] = Object.values(ROLES)
