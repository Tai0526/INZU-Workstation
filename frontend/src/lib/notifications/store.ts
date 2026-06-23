import { useSyncExternalStore } from 'react'
import { ROLES, type BranchCode, type RoleKey } from '@/lib/roles'
import { useDocuments } from '@/lib/documents/store'
import { useVehicles } from '@/lib/fleet/store'
import { CATEGORY_META, docStatus, daysUntil, LICENSING_CATEGORIES } from '@/lib/documents/types'
import { useCases, CASE_STAGE_META, INCIDENT_TYPE_META } from '@/lib/safety/cases'
import { useSpeedEvents } from '@/lib/speed/store'
import { overBy, isGlitch } from '@/lib/speed/types'
import { useGenFuel } from '@/lib/fuel/store'
import { DRAW_LABEL } from '@/lib/fuel/types'
import { useMileage } from '@/lib/operations/store'
import { registerCrossTabSync } from '@/lib/storage/sync'

/**
 * Notifications are derived live from real data (no separate event log). Each
 * item carries an `audience` — the roles who need to act on or be informed of it
 * — so the right person is alerted at every workflow handoff. `audience: null`
 * means everyone in the branch sees it. Only "read" state is persisted.
 */

// ── Who acts at each handoff ────────────────────────────────────────────
const SAFETY_ACTORS: RoleKey[] = ['safety_officer', 'operations_manager'] // investigate / prepare incidents
const OPS_DECIDERS: RoleKey[] = ['operations_manager', 'asst_operations_manager'] // approve / reject / authorise
const SPEED_ACTORS: RoleKey[] = ['tracker', 'operations_manager', 'asst_operations_manager'] // log / confirm / escalate speed events
const WORKSHOP_ACTORS: RoleKey[] = ['workshop_supervisor', 'operations_manager', 'asst_operations_manager'] // workshop does it, ops is aware
const PLANNER_ACTORS: RoleKey[] = ['bus_controller', 'route_supervisor', 'operations_manager', 'asst_operations_manager'] // plan daily/weekly bus movements

export interface AppNotification {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  date: string // ISO of the relevant date
  link: string
  audience: RoleKey[] | null // roles that should see it; null = everyone
}

// ── Read-state (persisted, reactive) ───────────────────────────────────
const KEY = 'inzu_notifications_read'
const listeners = new Set<() => void>()
let readCache: Set<string> | null = null

function readSet(): Set<string> {
  if (readCache) return readCache
  try {
    const raw = localStorage.getItem(KEY)
    readCache = new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    readCache = new Set()
  }
  return readCache
}

function persist() {
  localStorage.setItem(KEY, JSON.stringify([...readSet()]))
  listeners.forEach((l) => l())
}

export function markRead(id: string) {
  readSet().add(id)
  persist()
}

export function markAllRead(ids: string[]) {
  const s = readSet()
  ids.forEach((id) => s.add(id))
  persist()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function snapshot() {
  return readSet()
}
registerCrossTabSync(KEY, () => { readCache = null; readSet(); listeners.forEach((l) => l()) })

// ── Derivation ─────────────────────────────────────────────────────────
export function useNotifications(branch: BranchCode, role?: RoleKey): {
  items: (AppNotification & { read: boolean })[]
  unread: number
} {
  const docs = useDocuments()
  const vehicles = useVehicles()
  const cases = useCases()
  const speed = useSpeedEvents()
  const draws = useGenFuel()
  const mileage = useMileage()
  const read = useSyncExternalStore(subscribe, snapshot, snapshot)

  const items: AppNotification[] = []

  // ── Disciplinary / safety incidents — alert whoever owns the next step ──
  for (const c of cases) {
    if (c.branch !== branch) continue
    const what = `${INCIDENT_TYPE_META[c.incident_type].label}${c.driver_name ? ` — ${c.driver_name}` : ''}`
    if (c.stage === 'safety_review') {
      items.push({
        id: `case:${c.id}:safety_review`, severity: 'warning', audience: SAFETY_ACTORS,
        title: `Incident with Safety: ${what}`,
        detail: 'Investigate, attach evidence and propose a verdict to Ops.',
        date: c.updated_at, link: '/safety/incidents',
      })
    } else if (c.stage === 'ops_review') {
      items.push({
        id: `case:${c.id}:ops_review`, severity: 'critical', audience: OPS_DECIDERS,
        title: `Verdict awaiting your decision: ${what}`,
        detail: `Safety proposed ${c.proposal?.decisions.length ? 'a verdict' : 'an outcome'} — approve or reject it.`,
        date: c.updated_at, link: '/safety/incidents',
      })
    } else if (c.stage === 'closed' && c.verdict) {
      // Inform Safety that Ops has responded.
      items.push({
        id: `case:${c.id}:closed`, severity: 'info', audience: SAFETY_ACTORS,
        title: `Incident ${c.verdict.outcome}: ${what}`,
        detail: c.verdict.outcome === 'approved'
          ? `Ops approved the verdict${c.verdict.fine_amount ? ` (fine K${c.verdict.fine_amount.toLocaleString()})` : ''}.`
          : 'Ops rejected the proposed verdict.',
        date: c.verdict.decided_at || c.updated_at, link: '/safety/incidents',
      })
    }
  }

  // ── Confirmed speed events not yet escalated — Safety should raise a case ──
  const caseByEvent = new Set(cases.map((c) => c.event_id).filter(Boolean))
  for (const e of speed) {
    if (e.branch !== branch || e.status !== 'confirmed' || isGlitch(e) || caseByEvent.has(e.id)) continue
    items.push({
      id: `speed:${e.id}:confirmed`, severity: 'warning', audience: SPEED_ACTORS,
      title: `Confirmed speeding: ${e.driver_name}`,
      detail: `+${overBy(e)} km/h over on ${e.route || 'route'} — escalate to an incident for Safety.`,
      date: e.updated_at || e.event_datetime, link: '/speed/events',
    })
  }

  // ── Authorised-vehicle fuel draws pending Ops sign-off ──
  for (const g of draws) {
    if (g.branch !== branch || g.status !== 'pending') continue
    items.push({
      id: `fueldraw:${g.id}:pending`, severity: 'warning', audience: OPS_DECIDERS,
      title: `Fuel authorisation needed: ${g.recipient}`,
      detail: `${DRAW_LABEL[g.kind]}${g.vehicle_reg ? ` (${g.vehicle_reg})` : ''} — ${g.litres} L awaiting your approval.`,
      date: g.date, link: '/operations/fuel',
    })
  }

  // ── Mileage entries pending approval ──
  const pendingMileage = mileage.filter((m) => m.branch === branch && m.status === 'pending')
  if (pendingMileage.length > 0) {
    const latest = pendingMileage.reduce((a, b) => (a.date > b.date ? a : b))
    items.push({
      id: `mileage:pending:${pendingMileage.length}`, severity: 'warning', audience: OPS_DECIDERS,
      title: `${pendingMileage.length} mileage entr${pendingMileage.length === 1 ? 'y' : 'ies'} to approve`,
      detail: 'Daily mileage is awaiting your approval.',
      date: latest.date, link: '/operations/mileage',
    })
  }

  // ── Vehicles missing required documents (Workshop acts, Ops aware) ──
  const missingDocs = vehicles.filter(
    (v) => v.branch === branch && LICENSING_CATEGORIES.some((cat) => !docs.some((d) => d.entity_id === v.id && d.category === cat && !d.superseded)),
  ).length
  if (missingDocs > 0) {
    items.push({
      id: `docs:missing:${missingDocs}`, severity: 'warning', audience: WORKSHOP_ACTORS,
      title: `${missingDocs} vehicle${missingDocs === 1 ? '' : 's'} missing required documents`,
      detail: 'Upload the outstanding licensing documents (road tax, fitness, insurance, FQM inspection).',
      date: new Date().toISOString().slice(0, 10), link: '/fleet/licensing',
    })
  }

  // ── Licensing expiries (everyone) ──
  for (const d of docs) {
    if (d.superseded || d.branch !== branch) continue
    const meta = CATEGORY_META[d.category]
    if (!meta) continue // unknown/legacy category — skip rather than crash
    const st = docStatus(d)
    const label = meta.label
    if (st === 'expired') {
      items.push({
        id: `lic:${d.id}:expired`, severity: 'critical', audience: null,
        title: `${label} expired — ${d.entity_label}`,
        detail: `Expired ${d.expiry_date}. Upload the renewed document.`,
        date: d.expiry_date, link: '/fleet/licensing',
      })
    } else if (st === 'expiring') {
      const days = daysUntil(d.expiry_date)
      items.push({
        id: `lic:${d.id}:expiring`, severity: 'warning', audience: null,
        title: `${label} expiring — ${d.entity_label}`,
        detail: `Due in ${days} day${days === 1 ? '' : 's'} (${d.expiry_date}).`,
        date: d.expiry_date, link: '/fleet/licensing',
      })
    }
  }

  // ── Grounded vehicles (everyone) + in-workshop (planners) ──
  for (const v of vehicles) {
    if (v.branch !== branch) continue
    if (v.status === 'grounded') {
      items.push({
        id: `veh:${v.id}:grounded`, severity: 'warning', audience: null,
        title: `${v.fleet_no} grounded`,
        detail: `${v.reg_plate} is out of service — excluded from fuel & allocation.`,
        date: v.updated_at, link: '/fleet/vehicles',
      })
    } else if (v.status === 'under_repair') {
      // Planners need to know a bus is unavailable so they don't assign it.
      items.push({
        id: `veh:${v.id}:workshop`, severity: 'warning', audience: PLANNER_ACTORS,
        title: `${v.fleet_no} is in the workshop`,
        detail: `${v.reg_plate} is under repair — not available to plan until it's back in service.`,
        date: v.updated_at, link: '/operations/weekly-plan',
      })
    }
  }

  // Keep only items meant for this role. Admins (MD, Ops Manager) see everything
  // for oversight; if no role is supplied, fall back to showing all.
  const isAdmin = role ? ROLES[role].isAdmin : true
  const forRole = items.filter((n) => !n.audience || isAdmin || (role ? n.audience.includes(role) : true))

  // Critical first, then by date ascending (soonest)
  const order = { critical: 0, warning: 1, info: 2 }
  forRole.sort((a, b) => order[a.severity] - order[b.severity] || a.date.localeCompare(b.date))

  const withRead = forRole.map((n) => ({ ...n, read: read.has(n.id) }))
  return { items: withRead, unread: withRead.filter((n) => !n.read).length }
}
