import type { BranchCode } from '@/lib/roles'

/**
 * Operational sections (zones) each branch runs routes/drivers across.
 * Single source of truth — used by the Drivers module and the Dashboard.
 */
export const SECTIONS: Record<BranchCode, string[]> = {
  kansanshi: ['Inside the Mine', 'Outside the Mine'],
  trident: ['Pit (Enterprise Mine)', 'Pit (Sentinel Mine)', 'Sentinel', 'Enterprise', 'Security', 'Omega', 'Dewatering'],
}
