import { routesStore } from './store'
import { mileageRoutesStore } from '@/lib/mileage/store'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * The route catalogues, topped up from the Geotab lab.
 *
 * The lab reads every bus's GPS against the contract and has settled the real
 * names and distances — Kisasa to the Main Mine Gate is 30 km on the schedule,
 * not the 35 the demo seed guessed; Pineapple (one 'p', two 'p's — the seed
 * misspelled it) is 11 km, not 28. The catalogues here should speak the same
 * language as the files the lab generates, so a route picked by hand and a row
 * bulk-uploaded from the lab agree on both the name and the kilometres.
 *
 * Healing runs once per catalogue VERSION, recorded in app_config: stable ids
 * make it idempotent across devices, and the version gate means an entry a
 * person later deletes stays deleted — the heal does not fight the user.
 * Corrections to the old demo entries only touch rows still stamped
 * 'System (seed)': anything a person has edited is theirs.
 */

const VERSION = 1
const versionCfg = createSyncConfig<number>({ key: 'route_catalogue_version', lsKey: 'inzu_route_catalogue_v', default: 0 })

// ── The lab's locations (operations library: name + one-way km) ────────
// Distances are CONTRACT km from geotab-lab/routes.json, never GPS measurement.
const LAB_LOCATIONS = [
  { id: 'L-LAB-TWE', name: 'TWE', distance_km: 40, notes: 'Trident Woodlands Estate — 40 km from Lumwana East, 30 km from Kisasa. Contract km per Geotab lab.' },
  { id: 'L-LAB-ER', name: 'Enterprise Resettlement', distance_km: 14, notes: 'To Main Mine Gate via Enterprise Housing (10 + 4). Contract km per Geotab lab.' },
  { id: 'L-LAB-EH', name: 'Enterprise Housing', distance_km: 4, notes: 'Bus station, 4 km to Main Mine Gate. Contract km per Geotab lab.' },
  { id: 'L-LAB-EHA', name: 'Enterprise Housing Admin', distance_km: 8, notes: 'INZ067 start/end, 8 km to Main Mine Gate. Contract km per Geotab lab.' },
  { id: 'L-LAB-EM', name: 'Enterprise Mine', distance_km: 32, notes: '32 km inside from the Main Mine Gate. Contract km per Geotab lab.' },
  { id: 'L-LAB-IQ', name: 'Intrapid Quarry', distance_km: 36, notes: '36 km from the Main Mine Gate. Contract km per Geotab lab.' },
  { id: 'L-LAB-WS', name: 'Inzu Workshop', distance_km: 0, notes: 'Depot — movements here are not billable.' },
] as const

// Demo-seed rows the lab has since proven wrong. Corrected only while the row
// is still untouched by a person (updated_by 'System (seed)').
const SEED_FIXES = [
  { id: 'L-T1', name: 'Kisasa', distance_km: 30, notes: 'Contract km per Geotab lab (was 35 in the demo seed).' },
  { id: 'L-T2', name: 'Pineapple', distance_km: 11, notes: 'Contract km per Geotab lab (demo seed had "Pineaple", 28 km).' },
  { id: 'L-T3', name: 'Lumwana East', distance_km: 38, notes: 'Contract km per Geotab lab (was "Lumwana", 60 km).' },
] as const

// ── The lab's runs (mileage catalogue: per-project, internal/external) ─
// One-way legs and their returns, named exactly as the lab writes them, so a
// picked route and an uploaded row read the same.
const LAB_MILEAGE_ROUTES = [
  // Sentinel — township legs, external only.
  { id: 'MR-LAB-S1', project: 'Sentinel', name: 'Kisasa - Main Mine Gate', internal_km: 0, external_km: 30 },
  { id: 'MR-LAB-S2', project: 'Sentinel', name: 'Kisasa - Main Mine Gate x2 (return)', internal_km: 0, external_km: 60 },
  { id: 'MR-LAB-S3', project: 'Sentinel', name: 'Lumwana East - Main Mine Gate', internal_km: 0, external_km: 38 },
  { id: 'MR-LAB-S4', project: 'Sentinel', name: 'Lumwana East - Main Mine Gate x2 (return)', internal_km: 0, external_km: 76 },
  { id: 'MR-LAB-S5', project: 'Sentinel', name: 'Pineapple - Main Mine Gate', internal_km: 0, external_km: 11 },
  { id: 'MR-LAB-S6', project: 'Sentinel', name: 'Pineapple - Main Mine Gate x2 (return)', internal_km: 0, external_km: 22 },
  { id: 'MR-LAB-S7', project: 'Sentinel', name: 'Lumwana East - TWE', internal_km: 0, external_km: 40 },
  { id: 'MR-LAB-S8', project: 'Sentinel', name: 'Lumwana East - TWE x2 (return)', internal_km: 0, external_km: 80 },
  { id: 'MR-LAB-S9', project: 'Sentinel', name: 'Kisasa - TWE', internal_km: 0, external_km: 30 },
  { id: 'MR-LAB-S10', project: 'Sentinel', name: 'Kisasa - TWE x2 (return)', internal_km: 0, external_km: 60 },
  // Enterprise — the mine legs are internal, the township legs external.
  { id: 'MR-LAB-E1', project: 'Enterprise', name: 'Enterprise Resettlement - Enterprise Housing', internal_km: 0, external_km: 10 },
  { id: 'MR-LAB-E2', project: 'Enterprise', name: 'Enterprise Housing - Main Mine Gate', internal_km: 0, external_km: 4 },
  { id: 'MR-LAB-E3', project: 'Enterprise', name: 'Enterprise Resettlement - Main Mine Gate', internal_km: 0, external_km: 14 },
  { id: 'MR-LAB-E4', project: 'Enterprise', name: 'Enterprise Housing Admin - Main Mine Gate', internal_km: 0, external_km: 8 },
  { id: 'MR-LAB-E5', project: 'Enterprise', name: 'Main Mine Gate - Enterprise Mine', internal_km: 32, external_km: 0 },
  { id: 'MR-LAB-E6', project: 'Enterprise', name: 'Main Mine Gate - Enterprise Mine x2 (return)', internal_km: 64, external_km: 0 },
  { id: 'MR-LAB-E7', project: 'Enterprise', name: 'Main Mine Gate - Intrapid Quarry', internal_km: 36, external_km: 0 },
  { id: 'MR-LAB-E8', project: 'Enterprise', name: 'Main Mine Gate - Intrapid Quarry x2 (return)', internal_km: 72, external_km: 0 },
  { id: 'MR-LAB-E9', project: 'Enterprise', name: 'Enterprise Housing Admin - Enterprise Mine (via Gate)', internal_km: 32, external_km: 8 },
  { id: 'MR-LAB-E10', project: 'Enterprise', name: 'Enterprise Resettlement - Enterprise Mine (via Housing & Gate)', internal_km: 32, external_km: 14 },
] as const

/**
 * Bring both catalogues up to the lab's vocabulary. Safe to call on every
 * load: it does nothing once the stored version matches, writes nothing when
 * there is nothing to change, and never touches a row a person has edited.
 */
export function ensureRouteCatalogues() {
  if (versionCfg.get() >= VERSION) return

  // Operations locations library (Trident).
  const locs = routesStore.list()
  for (const fix of SEED_FIXES) {
    const cur = locs.find((r) => r.id === fix.id)
    if (cur && cur.updated_by === 'System (seed)' && (cur.name !== fix.name || cur.distance_km !== fix.distance_km)) {
      routesStore.update(fix.id, { name: fix.name, distance_km: fix.distance_km, notes: fix.notes })
    }
  }
  const haveLoc = new Set(locs.map((r) => r.id))
  const locNames = new Set(locs.map((r) => r.name.trim().toLowerCase()))
  for (const l of LAB_LOCATIONS) {
    if (haveLoc.has(l.id) || locNames.has(l.name.toLowerCase())) continue
    routesStore.add({ id: l.id, branch: 'trident', name: l.name, code: '', distance_km: l.distance_km, notes: l.notes })
  }

  // Mileage route catalogue (per project).
  const routes = mileageRoutesStore.list()
  const haveRoute = new Set(routes.map((r) => r.id))
  const routeNames = new Set(routes.map((r) => `${r.project}|${r.name.trim().toLowerCase()}`))
  for (const r of LAB_MILEAGE_ROUTES) {
    if (haveRoute.has(r.id) || routeNames.has(`${r.project}|${r.name.toLowerCase()}`)) continue
    mileageRoutesStore.add({ id: r.id, branch: 'trident', project: r.project, name: r.name, internal_km: r.internal_km, external_km: r.external_km })
  }

  versionCfg.set(VERSION)
}
