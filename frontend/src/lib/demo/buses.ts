/**
 * Canonical Trident demo fleet — ONE roster shared by the Vehicle Register,
 * Mileage and Fuel seeds so the modules stay consistent (same buses, regs and
 * a believable spread of size, intensity and paid-vs-driven efficiency).
 *
 * Each bus carries the few numbers the seeds need:
 *  - dailyKm      → odometer distance per operating day (drives Fuel)
 *  - paidFrac     → share of driven km that is billable (drives Mileage)
 *  - internalShare→ share of paid km run inside the mine (Enterprise only)
 * These are derived deterministically per bus so the demo is reproducible and
 * the Overview shows a real spread (≈78–94% paid ratio, 10k–20k km/bus).
 */

export type DemoSeat = '60' | '40' | '28'
export type DemoProject = 'Enterprise' | 'Sentinel'
export type DemoStatus = 'active' | 'under_repair' | 'grounded'

export interface DemoBus {
  fleet: string
  reg: string
  project: DemoProject
  seat: DemoSeat
  capacity: number
  status: DemoStatus
  driver: string
  startOdo: number
  dailyKm: number
  paidFrac: number
  internalShare: number
}

const DRIVERS = [
  'Njongo', 'Kamocha', 'Mbuzi', 'Phiri', 'Banda', 'Daka', 'Sakala', 'Mwila', 'Tembo', 'Zulu',
  'Lungu', 'Chanda', 'Mwanza', 'Bwalya', 'Sikazwe', 'Kabwe', 'Mulenga', 'Chisenga', 'Mumba', 'Tembwe',
]

let _reg = 5200
let _i = 0
function mk(fleet: string, project: DemoProject, seat: DemoSeat, capacity: number): DemoBus {
  const idx = _i++
  const baseDaily = seat === '60' ? 780 : seat === '40' ? 700 : 480
  return {
    fleet,
    reg: `BCG ${_reg++} ZM`,
    project, seat, capacity, status: 'active',
    driver: DRIVERS[idx % DRIVERS.length],
    startOdo: 30000 + idx * 2500,
    dailyKm: Math.round(baseDaily * (0.9 + (idx % 6) * 0.04)), // 0.90–1.10
    paidFrac: +(0.80 + (idx % 8) * 0.02).toFixed(2), // 0.80–0.94
    internalShare: project === 'Enterprise' ? 0.65 : 0,
  }
}

export const TRIDENT_BUSES: DemoBus[] = [
  // Enterprise — internal + external buses
  ...['INZ 120', 'INZ 121', 'INZ 122', 'INZ 123', 'INZ 124', 'INZ 125'].map((f) => mk(f, 'Enterprise', '40', 40)),
  ...['INZ 067', 'INZ 110'].map((f) => mk(f, 'Enterprise', '28', 24)),
  // Sentinel — external-only buses
  ...Array.from({ length: 12 }, (_, k) => mk(`INZ ${220 + k}`, 'Sentinel', '60', 60)),
  ...['INZ 126', 'INZ 128', 'INZ 129', 'INZ 130', 'INZ 132', 'INZ 133', 'INZ 134', 'INZ 135', 'INZ 136', 'INZ 137', 'INZ 138', 'INZ 139', 'INZ 140', 'INZ 141', 'INZ 142', 'INZ 143', 'INZ 144', 'INZ 145'].map((f) => mk(f, 'Sentinel', '40', 40)),
]
// A couple off-road for realism (they still carry the month's history).
for (const b of TRIDENT_BUSES) {
  if (b.fleet === 'INZ 123') b.status = 'under_repair'
  if (b.fleet === 'INZ 134') b.status = 'grounded'
}

// June 2026 weekdays (Mon–Fri) and the weekly depot refuel dates.
export const JUNE_WEEKDAYS = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`)
  .filter((d) => { const wd = new Date(d + 'T00:00:00').getDay(); return wd >= 1 && wd <= 5 })
export const REFUEL_DATES = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']
