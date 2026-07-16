import { useSyncExternalStore } from 'react'
import { ROLES, type BranchCode, type RoleKey } from '@/lib/roles'
import { useDocuments } from '@/lib/documents/store'
import { useVehicles } from '@/lib/fleet/store'
import {
  CATEGORY_META, docStatus, daysUntil, LICENSING_CATEGORIES,
  approvalOf, reviewStatus, typeLabelOf, displayNameOf,
} from '@/lib/documents/types'
import { useCases, CASE_STAGE_META, INCIDENT_TYPE_META } from '@/lib/safety/cases'
import { useSpeedEvents } from '@/lib/speed/store'
import { overBy, isGlitch } from '@/lib/speed/types'
import { useGenFuel, useIssuances } from '@/lib/fuel/store'
import { DRAW_LABEL, latestOdometer } from '@/lib/fuel/types'
import { useMileage } from '@/lib/operations/store'
import { useJobCards, useChecklists, useSpares, usePm, useInspections } from '@/lib/workshop/store'
import { checklistFaults, spareLow, pmService, DEFAULT_PM, inspectionStatus, type MonthlyInspection } from '@/lib/workshop/types'
import { useReqs as usePettyReqs, useLedger as usePettyLedger, useActingApprover } from '@/lib/pettycash/store'
import { fmtK, balanceOf } from '@/lib/pettycash/types'
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
const CASE_DECIDERS: RoleKey[] = ['operations_manager', 'asst_operations_manager', 'hr_manager'] // conclude disciplinary / speeding cases
const SPEED_ACTORS: RoleKey[] = ['tracker', 'operations_manager', 'asst_operations_manager'] // log / confirm / escalate speed events
const WORKSHOP_ACTORS: RoleKey[] = ['workshop_supervisor', 'operations_manager', 'asst_operations_manager'] // workshop does it, ops is aware
const PLANNER_ACTORS: RoleKey[] = ['bus_controller', 'route_supervisor', 'operations_manager', 'asst_operations_manager'] // plan daily/weekly bus movements
const DOC_APPROVERS: RoleKey[] = ['operations_manager', 'asst_operations_manager', 'managing_director'] // approve library documents (admins see all anyway)
const PETTY_CUSTODIAN: RoleKey[] = ['safety_officer'] // checks & disburses petty cash, owns the reconciliation

export interface AppNotification {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  date: string // ISO of the relevant date
  link: string
  audience: RoleKey[] | null // roles that should see it; null = everyone
  viewer?: boolean // also surfaced to view-only roles (incident/safety status only)
  forName?: string // also surfaced to the individual whose name matches (e.g. a petty-cash requester)
}

// View-only roles get NONE of the operational to-do notifications (licensing,
// documents, fuel, workshop, grounded vehicles…) — only the incident/safety
// status items flagged `viewer: true` (e.g. "escalated to incident", "with Ops").
const VIEWER_ROLES: RoleKey[] = ['viewer']

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
export function useNotifications(branch: BranchCode, role?: RoleKey, userName?: string): {
  items: (AppNotification & { read: boolean })[]
  unread: number
} {
  const docs = useDocuments()
  const vehicles = useVehicles()
  const cases = useCases()
  const speed = useSpeedEvents()
  const draws = useGenFuel()
  const fuelIssuances = useIssuances()
  const mileage = useMileage()
  const jobCards = useJobCards()
  const checklists = useChecklists()
  const spares = useSpares()
  const pm = usePm()
  const inspections = useInspections()
  const pettyReqs = usePettyReqs()
  const pettyLedger = usePettyLedger()
  const pettyActing = useActingApprover()
  const read = useSyncExternalStore(subscribe, snapshot, snapshot)
  const today = new Date().toISOString().slice(0, 10)

  const items: AppNotification[] = []

  // ── Disciplinary / safety incidents — alert whoever owns the next step ──
  for (const c of cases) {
    if (c.branch !== branch) continue
    const what = `${INCIDENT_TYPE_META[c.incident_type].label}${c.driver_name ? ` — ${c.driver_name}` : ''}`
    if (c.stage === 'safety_review') {
      items.push({
        id: `case:${c.id}:safety_review`, severity: 'warning', audience: SAFETY_ACTORS, viewer: true,
        title: `Incident with Safety: ${what}`,
        detail: 'Investigate, attach evidence and propose a verdict to Ops.',
        date: c.updated_at, link: `/safety/incidents?case=${c.id}`,
      })
    } else if (c.stage === 'ops_review') {
      items.push({
        id: `case:${c.id}:ops_review`, severity: 'critical', audience: CASE_DECIDERS, viewer: true,
        title: `Verdict awaiting your decision: ${what}`,
        detail: `Safety proposed ${c.proposal?.decisions.length ? 'a verdict' : 'an outcome'} — approve or reject it.`,
        date: c.updated_at, link: `/safety/incidents?case=${c.id}`,
      })
    } else if (c.stage === 'closed' && c.verdict) {
      // Inform Safety that Ops has responded.
      items.push({
        id: `case:${c.id}:closed`, severity: 'info', audience: SAFETY_ACTORS, viewer: true,
        title: `Incident ${c.verdict.outcome}: ${what}`,
        detail: c.verdict.outcome === 'approved'
          ? `Ops approved the verdict${c.verdict.fine_amount ? ` (fine K${c.verdict.fine_amount.toLocaleString()})` : ''}.`
          : 'Ops rejected the proposed verdict.',
        date: c.verdict.decided_at || c.updated_at, link: `/safety/incidents?case=${c.id}`,
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
      date: e.updated_at || e.event_datetime, link: '/speed/events?status=confirmed',
    })
  }

  // ── Pending Geotab speed events awaiting driver confirmation (daily task) ──
  const pendingSpeed = speed.filter((e) => e.branch === branch && e.status === 'pending' && !isGlitch(e))
  if (pendingSpeed.length > 0) {
    const latest = pendingSpeed.reduce((a, b) => (a.event_datetime > b.event_datetime ? a : b))
    items.push({
      id: `speed:pending:${pendingSpeed.length}`, severity: 'warning', audience: SPEED_ACTORS,
      title: `${pendingSpeed.length} speeding event${pendingSpeed.length === 1 ? '' : 's'} need a driver confirmed`,
      detail: 'Geotab events imported without a driver — after speaking to the driver, confirm who it was or write it off.',
      date: latest.event_datetime.slice(0, 10), link: '/speed/events?status=pending',
    })
  }

  // ── Authorised-vehicle fuel draws pending Ops sign-off ──
  for (const g of draws) {
    if (g.branch !== branch || g.status !== 'pending') continue
    items.push({
      id: `fueldraw:${g.id}:pending`, severity: 'warning', audience: OPS_DECIDERS,
      title: `Fuel authorisation needed: ${g.recipient}`,
      detail: `${DRAW_LABEL[g.kind]}${g.vehicle_reg ? ` (${g.vehicle_reg})` : ''} — ${g.litres} L awaiting your approval.`,
      date: g.date, link: '/operations/fuel?draw=pending',
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
      date: new Date().toISOString().slice(0, 10), link: '/fleet/licensing?filter=noncompliant',
    })
  }

  // ── Document library: approvals, review cycles, and expiries ──
  for (const d of docs) {
    // Company-wide documents surface in both branches.
    if (d.superseded || (d.branch !== branch && !d.all_branches)) continue
    const meta = CATEGORY_META[d.category]
    if (!meta) continue // unknown/legacy category — skip rather than crash
    const kind = typeLabelOf(d)
    const subject = d.entity_type === 'general' ? displayNameOf(d) : d.entity_label
    const link = meta.licensing ? '/fleet/licensing' : '/documents'

    // Awaiting approval — alert the approvers (admins see it regardless).
    if (approvalOf(d) === 'pending') {
      items.push({
        id: `doc:${d.id}:pending`, severity: 'warning', audience: DOC_APPROVERS,
        title: `Document awaiting approval: ${subject}`,
        detail: `${kind} submitted by ${d.uploaded_by} — review and approve or reject.`,
        date: d.uploaded_at.slice(0, 10), link: '/documents',
      })
    }

    // Periodic review due (policies, SOPs, registers).
    const rv = reviewStatus(d)
    if (rv === 'due' || rv === 'soon') {
      const days = daysUntil(d.review_date ?? '')
      items.push({
        id: `doc:${d.id}:review`, severity: rv === 'due' ? 'warning' : 'info', audience: null,
        title: `Review due: ${subject}`,
        detail: rv === 'due' ? `Review was due ${d.review_date}.` : `Review due in ${days} day${days === 1 ? '' : 's'} (${d.review_date}).`,
        date: d.review_date ?? '', link: '/documents',
      })
    }

    // Expiry (licensing, permits, certificates, contracts…).
    const st = docStatus(d)
    if (st === 'expired') {
      items.push({
        id: `lic:${d.id}:expired`, severity: 'critical', audience: null,
        title: `${kind} expired — ${subject}`,
        detail: `Expired ${d.expiry_date}. Upload the renewed document.`,
        date: d.expiry_date, link,
      })
    } else if (st === 'expiring') {
      const days = daysUntil(d.expiry_date)
      items.push({
        id: `lic:${d.id}:expiring`, severity: 'warning', audience: null,
        title: `${kind} expiring — ${subject}`,
        detail: `Due in ${days} day${days === 1 ? '' : 's'} (${d.expiry_date}).`,
        date: d.expiry_date, link,
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
        date: v.updated_at, link: '/fleet/vehicles?status=grounded',
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

  // ── Workshop job cards: sign-off queue (Asst Ops) + sent-back work (Workshop) ──
  for (const j of jobCards) {
    if (j.branch !== branch) continue
    if (j.status === 'awaiting_approval') {
      items.push({
        id: `job:${j.id}:signoff`, severity: 'warning', audience: OPS_DECIDERS,
        title: `Job card needs sign-off: ${j.fleet_no}`,
        detail: `${j.fault} — repaired${j.completed_by ? ` by ${j.completed_by}` : ''}. Approve to return it to service.`,
        date: j.completed_at || j.updated_at, link: '/workshop/jobcards?status=awaiting_approval',
      })
    } else if (j.status === 'open' && j.rejected_note) {
      items.push({
        id: `job:${j.id}:sentback`, severity: 'warning', audience: WORKSHOP_ACTORS,
        title: `Job card sent back: ${j.fleet_no}`,
        detail: `Needs more work: ${j.rejected_note}`,
        date: j.updated_at, link: '/workshop/jobcards?status=open',
      })
    }
  }

  // ── Workshop: checklist faults to action, service overdue, low spares ──
  const unactioned = checklists.filter((c) => c.branch === branch && checklistFaults(c).length > 0 && c.job_ids.length === 0).length
  if (unactioned > 0) items.push({
    id: `chk:unactioned:${unactioned}`, severity: 'warning', audience: WORKSHOP_ACTORS,
    title: `${unactioned} checklist${unactioned === 1 ? '' : 's'} with faults to action`,
    detail: 'Driver-reported faults waiting for a job card.', date: today, link: '/workshop/checklists?job=unactioned',
  })
  // Service due by distance (live odometer from Fuel) or time — for Workshop + Ops.
  const branchIssuances = fuelIssuances.filter((i) => i.branch === branch)
  const pmStates = vehicles.filter((v) => v.branch === branch).map((v) => pmService(pm[v.fleet_no] ?? DEFAULT_PM, latestOdometer(branchIssuances, v.fleet_no), today).state)
  const overdueSvc = pmStates.filter((s) => s === 'overdue').length
  const soonSvc = pmStates.filter((s) => s === 'soon').length
  if (overdueSvc > 0) items.push({
    id: `pm:overdue:${overdueSvc}`, severity: 'warning', audience: WORKSHOP_ACTORS,
    title: `${overdueSvc} bus${overdueSvc === 1 ? '' : 'es'} overdue for service`,
    detail: 'Past the service interval (distance or time). Book it in PM Schedules.', date: today, link: '/workshop/pm?status=overdue',
  })
  if (soonSvc > 0) items.push({
    id: `pm:soon:${soonSvc}`, severity: 'info', audience: WORKSHOP_ACTORS,
    title: `${soonSvc} bus${soonSvc === 1 ? '' : 'es'} due for service soon`,
    detail: 'Approaching the service interval — plan ahead in PM Schedules.', date: today, link: '/workshop/pm?status=soon',
  })
  const lowSpares = spares.filter((s) => s.branch === branch && spareLow(s)).length
  if (lowSpares > 0) items.push({
    id: `spares:low:${lowSpares}`, severity: 'warning', audience: WORKSHOP_ACTORS,
    title: `${lowSpares} critical spare${lowSpares === 1 ? '' : 's'} below minimum`,
    detail: 'Reorder before they run out.', date: today, link: '/workshop/spares',
  })
  // Monthly inspection coverage — buses not yet inspected this month (Workshop does it, Ops oversees).
  const inspMonth = today.slice(0, 7)
  const inspByFleet = new Map<string, MonthlyInspection>()
  for (const it of inspections) {
    if (it.branch !== branch || it.month !== inspMonth) continue
    const cur = inspByFleet.get(it.fleet_no)
    if (!cur || it.status === 'done' || it.updated_at > cur.updated_at) inspByFleet.set(it.fleet_no, it)
  }
  let inspOverdue = 0, inspDue = 0, inspWorst = 0
  for (const v of vehicles) {
    if (v.branch !== branch || v.status === 'grounded') continue // grounded buses are out of the inspection cycle
    const st = inspectionStatus(inspByFleet.get(v.fleet_no), inspMonth, today)
    if (st.state === 'overdue') { inspOverdue++; inspWorst = Math.max(inspWorst, st.daysOver) }
    else if (st.state === 'today' || st.state === 'unscheduled') inspDue++
  }
  if (inspOverdue > 0) items.push({
    id: `insp:overdue:${inspOverdue}`, severity: 'warning', audience: WORKSHOP_ACTORS,
    title: `${inspOverdue} bus${inspOverdue === 1 ? '' : 'es'} overdue for monthly inspection`,
    detail: `${inspWorst ? `Worst is ${inspWorst} day${inspWorst === 1 ? '' : 's'} overdue. ` : ''}Assign a mechanic and inspect before the month closes.`,
    date: today, link: '/workshop/inspections?state=overdue',
  })
  if (inspDue > 0) items.push({
    id: `insp:due:${inspDue}`, severity: 'info', audience: WORKSHOP_ACTORS,
    title: `${inspDue} bus${inspDue === 1 ? '' : 'es'} still need this month's inspection`,
    detail: 'Schedule a mechanic so every bus is inspected at least once this month.',
    date: today, link: '/workshop/inspections?state=attention',
  })

  // ── Petty cash — every party alerted at each handoff; the requester is notified
  //    of the outcome via forName (approved / paid / rejected). ──
  const actingName = pettyActing?.name
  for (const q of pettyReqs) {
    if (q.branch !== branch) continue
    const amt = fmtK(q.amount)
    if (q.status === 'pending') {
      items.push({ id: `petty:${q.id}:check`, severity: 'warning', audience: PETTY_CUSTODIAN,
        title: `Petty cash to check: ${q.requester_name}`, detail: `${amt} — ${q.purpose.slice(0, 60)}. Check it, then it goes to Asst Ops.`, date: q.created_at.slice(0, 10), link: '/petty-cash' })
    } else if (q.status === 'checked') {
      items.push({ id: `petty:${q.id}:auth`, severity: 'warning', audience: OPS_DECIDERS, forName: actingName,
        title: `Petty cash to authorise: ${q.requester_name}`, detail: `${amt} — checked by ${q.checked_by}. Asst Ops to authorise (or skip if on leave).`, date: q.checked_at.slice(0, 10), link: '/petty-cash' })
    } else if (q.status === 'authorised') {
      items.push({ id: `petty:${q.id}:approve`, severity: 'critical', audience: OPS_DECIDERS, forName: actingName,
        title: `Petty cash to approve: ${q.requester_name}`, detail: `${amt} — ${q.authorised_skipped ? 'authorisation skipped (Asst Ops on leave)' : `authorised by ${q.authorised_by}`}. Approve or reject.`, date: q.authorised_at.slice(0, 10), link: '/petty-cash' })
    } else if (q.status === 'approved') {
      items.push({ id: `petty:${q.id}:pay`, severity: 'warning', audience: PETTY_CUSTODIAN,
        title: `Petty cash to pay out: ${q.requester_name}`, detail: `${amt} approved — disburse and post it to the ledger.`, date: q.approved_at.slice(0, 10), link: '/petty-cash' })
      items.push({ id: `petty:${q.id}:approved-you`, severity: 'info', audience: [], forName: q.requester_name,
        title: 'Your petty cash was approved', detail: `${amt} approved — you can collect it from petty cash.`, date: q.approved_at.slice(0, 10), link: '/petty-cash' })
    } else if (q.status === 'paid') {
      items.push({ id: `petty:${q.id}:paid-you`, severity: 'info', audience: [], forName: q.requester_name,
        title: `Petty cash paid: ${fmtK(q.paid_amount)}`, detail: `Your requisition was paid out by ${q.paid_by}.`, date: q.paid_at.slice(0, 10), link: '/petty-cash' })
    } else if (q.status === 'rejected') {
      items.push({ id: `petty:${q.id}:rejected-you`, severity: 'warning', audience: [], forName: q.requester_name,
        title: 'Petty cash request rejected', detail: `Your ${amt} request was rejected${q.rejected_note ? `: ${q.rejected_note}` : ''}.`, date: q.rejected_at.slice(0, 10), link: '/petty-cash' })
    }
  }
  const pettyBal = balanceOf(pettyLedger.filter((e) => e.branch === branch))
  if (pettyBal < 0) items.push({
    id: 'petty:overdrawn', severity: 'critical', audience: [...PETTY_CUSTODIAN, ...OPS_DECIDERS],
    title: 'Petty cash overdrawn', detail: `Balance is ${fmtK(pettyBal)}. Top up the float and record where any borrowed cash came from.`, date: today, link: '/petty-cash',
  })

  // View-only roles see ONLY the incident/safety status items (no operational
  // to-dos). Everyone else: admins (MD, Ops Manager) see everything for oversight;
  // other roles see branch-wide items plus those addressed to their role.
  const isViewer = role ? VIEWER_ROLES.includes(role) : false
  const isAdmin = role ? ROLES[role].isAdmin : true
  const nameMatch = (n: AppNotification) => !!n.forName && !!userName && n.forName.trim().toLowerCase() === userName.trim().toLowerCase()
  const forRole = items.filter((n) => nameMatch(n) || (isViewer
    ? !!n.viewer
    : (!n.audience || isAdmin || (role ? n.audience.includes(role) : true))))

  // Critical first, then by date ascending (soonest)
  const order = { critical: 0, warning: 1, info: 2 }
  forRole.sort((a, b) => order[a.severity] - order[b.severity] || a.date.localeCompare(b.date))

  const withRead = forRole.map((n) => ({ ...n, read: read.has(n.id) }))
  return { items: withRead, unread: withRead.filter((n) => !n.read).length }
}
