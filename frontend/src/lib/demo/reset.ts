import { clearAllFiles } from '@/lib/storage/fileStore'

/**
 * Data reset helpers (Admin → Data).
 *
 * Stores re-seed themselves only when their localStorage key is *absent*. So to
 * get a genuinely empty database we write an empty container ('[]' / '{}') to
 * each key — present-but-empty means the seeds never run. To bring the demo data
 * back we simply remove the keys and let the stores re-seed on reload.
 */

// Record stores (arrays of rows the user enters).
const ARRAY_KEYS = [
  'inzu_vehicles',
  'inzu_operated_vehicles',
  'inzu_drivers',
  'inzu_documents',
  'inzu_mileage_trips',
  'inzu_mileage_routes',
  'inzu_employees',
  'inzu_speed_events',
  'inzu_disciplinary_cases',
  'inzu_safety_compliance',
  'inzu_safety_training',
  'inzu_safety_hazards',
  'inzu_safety_cap',
  'inzu_safety_loto',
  'inzu_safety_tools',
  'inzu_payroll_deductions',
  'inzu_sessions',
  'inzu_op_routes',
  'inzu_op_allocations',
  'inzu_op_mileage',
  'inzu_op_daily_plan',
  'inzu_op_weekly_assign',
  'inzu_messages',
  'inzu_report_recipients',
  'inzu_fuel_issuances',
  'inzu_fuel_receipts',
  'inzu_fuel_generator',
  'inzu_notifications_read',
]
// Config maps (cleared → code falls back to sensible defaults the user then edits).
const OBJECT_KEYS = [
  'inzu_mileage_rates',
  'inzu_mileage_signatories',
  'inzu_fuel_config',
  'inzu_fuel_rates',
]
// Configuration that should reset to its built-in DEFAULTS (not be emptied):
// e.g. the compliance class catalog — an empty list would leave no columns.
const RESET_TO_DEFAULT_KEYS = [
  'inzu_safety_classes',
  'inzu_users', // never leave the system with no accounts — reseed the admin
  'inzu_role_perms',
  'inzu_approvals',
  'inzu_branding',
]
const ALL_KEYS = [...ARRAY_KEYS, ...OBJECT_KEYS, ...RESET_TO_DEFAULT_KEYS]

/** Wipe all records and uploaded files, leaving an empty database to enter real data into. */
export async function clearAllData(): Promise<void> {
  ARRAY_KEYS.forEach((k) => localStorage.setItem(k, '[]'))
  OBJECT_KEYS.forEach((k) => localStorage.setItem(k, '{}'))
  RESET_TO_DEFAULT_KEYS.forEach((k) => localStorage.removeItem(k)) // re-seed defaults
  try { await clearAllFiles() } catch { /* IndexedDB may be unavailable; ignore */ }
  location.reload()
}

/** Remove the keys so the built-in demo data re-seeds on the next load. */
export async function restoreDemoData(): Promise<void> {
  ALL_KEYS.forEach((k) => localStorage.removeItem(k))
  try { await clearAllFiles() } catch { /* ignore */ }
  location.reload()
}
