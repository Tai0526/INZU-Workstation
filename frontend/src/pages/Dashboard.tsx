import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  CheckCircle2, AlertOctagon, AlertTriangle, ArrowRight, ListChecks, Eye,
  Truck, Route as RouteIcon, Wrench, UserCog, Users, UserRound,
  Gauge, ShieldAlert, ClipboardCheck, Lock, Fuel, FileWarning, Flame,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type RoleKey } from '@/lib/roles'
import { useUsers, allowedBranches } from '@/lib/auth/users'
import { canView, type ModuleKey } from '@/lib/permissions'
import { useVehicles } from '@/lib/fleet/store'
import { useOperatedVehicles } from '@/lib/fleet/operated'
import { useDrivers } from '@/lib/drivers/store'
import { driverShiftState } from '@/lib/drivers/types'
import { buildAssignmentIndex, dutyOn } from '@/lib/drivers/duty'
import { useDriverLeave } from '@/lib/drivers/leave'
import { useHrPeople } from '@/lib/hr/directory'
import { useAllocations, useWeeklyAssign } from '@/lib/operations/store'
import { useDocuments } from '@/lib/documents/store'
import { docStatus, LICENSING_CATEGORIES } from '@/lib/documents/types'
import { SECTIONS } from '@/lib/org/sections'
import { useSpeedEvents } from '@/lib/speed/store'
import { isGlitch, countsAgainstDriver } from '@/lib/speed/types'
import { useCases } from '@/lib/safety/cases'
import {
  useHazards, riskScore, useCap, useCompliance, useComplianceClasses, classMap,
  cellState, prereqsMet, isCompliantCell, credStatus, useLoto, lotoStatus, useTools, inspectionDue,
} from '@/lib/safety/registers'
import { useGenFuel, useIssuances, useReceipts, useFuelConfig } from '@/lib/fuel/store'
import { computeStock, isApprovedDraw } from '@/lib/fuel/types'
import { useMileage } from '@/lib/operations/store'
import { useInspections } from '@/lib/workshop/store'
import { inspectionStatus, type MonthlyInspection } from '@/lib/workshop/types'
import KpiCard from '@/components/ui/KpiCard'
import OpsInsight from '@/components/dashboard/OpsInsight'
import StoryCard, { type Story } from '@/components/dashboard/StoryCard'
import SafetyCard from '@/components/dashboard/SafetyCard'
import SpeedCard from '@/components/dashboard/SpeedCard'

type Severity = 'critical' | 'warning' | 'action'
interface Item {
  id: string
  severity: Severity
  icon: typeof AlertOctagon
  title: string
  detail: string
  link: string
  actors: RoleKey[]
}

const SEV = {
  critical: { text: 'text-status-critical', bar: 'bg-status-critical', tint: 'bg-status-critical/10', chip: 'bg-status-critical/10 text-status-critical', label: 'Critical', rank: 0 },
  warning: { text: 'text-[#8a6d10]', bar: 'bg-status-warning', tint: 'bg-status-warning/15', chip: 'bg-status-warning/10 text-[#8a6d10]', label: 'Attention', rank: 1 },
  action: { text: 'text-brand', bar: 'bg-brand', tint: 'bg-brand-tint', chip: 'bg-brand-tint text-[#8a4513]', label: 'To-do', rank: 2 },
}

const OPS = ['operations_manager', 'asst_operations_manager'] as RoleKey[]
// The whole operations chain: the two managers plus the people under them. Used
// to give execs (MD / Directors) oversight of what Ops & their team haven't done.
const OPS_CHAIN = ['operations_manager', 'asst_operations_manager', 'route_supervisor', 'bus_controller', 'tracker', 'fuel_controller'] as RoleKey[]
const SAFETY = ['safety_officer', 'operations_manager'] as RoleKey[]
const WORKSHOP = ['workshop_supervisor', 'operations_manager'] as RoleKey[]
const SPEED = ['tracker', 'operations_manager', 'asst_operations_manager'] as RoleKey[]

/**
 * The role that actually OWNS the next step of each attention item (the person to
 * follow up with). `actors` is who SEES the item; `owner` is who must act. A
 * manager sees an item owned by someone else so they can chase it — when the
 * owner is the manager themselves, no follow-up is shown.
 */
const ITEM_OWNER: Record<string, RoleKey> = {
  lic: 'workshop_supervisor', 'lic-soon': 'workshop_supervisor', ground: 'workshop_supervisor', 'missing-docs': 'workshop_supervisor',
  'inc-ops': 'operations_manager', 'inc-safety': 'safety_officer',
  speed: 'tracker',
  'haz-high': 'safety_officer', haz: 'safety_officer', cap: 'safety_officer', comp: 'safety_officer',
  loto: 'workshop_supervisor', tools: 'workshop_supervisor', 'tools-due': 'workshop_supervisor',
  mil: 'operations_manager', 'fuel-auth': 'operations_manager',
  'mil-entry': 'tracker', 'fuel-entry': 'fuel_controller', 'alloc-entry': 'bus_controller',
  insp: 'workshop_supervisor',
}
const ownerOf = (i: Item): RoleKey => ITEM_OWNER[i.id] ?? i.actors[0]

function roleTier(role: RoleKey): 'exec' | 'mgmt' | 'dept' | 'entry' | 'other' {
  if (['board_chairman', 'board_member', 'finance_director', 'managing_director'].includes(role)) return 'exec'
  if (OPS.includes(role)) return 'mgmt'
  if (['safety_officer', 'workshop_supervisor', 'route_supervisor', 'hr_manager', 'hr_officer', 'payroll_officer'].includes(role)) return 'dept'
  if (['tracker', 'fuel_controller', 'bus_controller'].includes(role)) return 'entry'
  return 'other'
}

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Dashboard() {
  const { user } = useAuth()
  const role = user!.role
  const tier = roleTier(role)
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const users = useUsers()

  // Who to follow up with for an item owned by `owner`: the actual user(s) holding
  // that role in this branch, or the role name itself if no user is assigned yet.
  const responsible = (owner: RoleKey) => {
    const holders = users.filter((u) => u.active && u.role === owner && allowedBranches(u).includes(branch))
    const roleLabel = ROLES[owner].label
    const clean = (s: string) => s.replace(/\s*\(demo\)$/, '')
    if (holders.length === 0) return { name: roleLabel, role: roleLabel, assigned: false }
    const name = holders.length === 1 ? clean(holders[0].full_name) : `${clean(holders[0].full_name)} +${holders.length - 1}`
    return { name, role: roleLabel, assigned: true }
  }

  // ── Real data (live from every module's store) ──
  const vehicles = useVehicles()
  const drivers = useDrivers().filter((d) => d.branch === branch)
  const docs = useDocuments()
  const events = useSpeedEvents().filter((e) => e.branch === branch)
  const cases = useCases().filter((c) => c.branch === branch)
  const hazards = useHazards().filter((h) => h.branch === branch)
  const cap = useCap().filter((f) => f.branch === branch)
  const compliance = useCompliance().filter((c) => c.branch === branch)
  const classes = useComplianceClasses()
  const loto = useLoto().filter((p) => p.branch === branch)
  const tools = useTools().filter((t) => t.branch === branch)
  const draws = useGenFuel().filter((g) => g.branch === branch)
  const issuances = useIssuances().filter((i) => i.branch === branch)
  const receipts = useReceipts().filter((rr) => rr.branch === branch)
  const fuelCfg = useFuelConfig(branch)
  const mileage = useMileage().filter((mm) => mm.branch === branch)
  const allocations = useAllocations().filter((a) => a.branch === branch)
  const fleet = vehicles.filter((v) => v.branch === branch)
  const branchDocs = docs.filter((d) => d.branch === branch && !d.superseded)
  // Operated (not owned) vehicles — counted separately from the owned fleet.
  const operatedV = useOperatedVehicles().filter((v) => v.branch === branch)
  const operated = { total: operatedV.length, active: operatedV.filter((v) => v.status === 'active').length }

  // Overtime is driven by the Weekly Plan (off-duty drivers covering today), not a
  // per-driver flag — so count covers that span today.
  const weekAssigns = useWeeklyAssign().filter((a) => a.branch === branch)
  const otIdx = useMemo(() => buildAssignmentIndex(weekAssigns), [weekAssigns])
  const leaveMap = useDriverLeave()
  const todayISO = new Date().toISOString().slice(0, 10)

  // Real staffing / operations / HR roll-ups for the cards + staffing visuals.
  const staff = useMemo(() => {
    const isOT = (d: (typeof drivers)[number]) => dutyOn(d, todayISO, otIdx).kind === 'overtime' || d.overtime
    const onNow = (d: (typeof drivers)[number]) => { const s = driverShiftState(d); return s === 'on_shift' || s === 'overtime' || isOT(d) }
    return {
      active: drivers.filter((d) => d.status === 'active').length,
      onShift: drivers.filter(onNow).length,
      overtime: drivers.filter(isOT).length,
      onLeave: drivers.filter((d) => driverShiftState(d) === 'leave').length,
      total: drivers.length,
      zones: SECTIONS[branch].map((z) => ({ name: z, drivers: drivers.filter((d) => d.section === z).length })),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, branch, otIdx, todayISO, leaveMap])
  const today = new Date().toISOString().slice(0, 10)
  const ops = useMemo(() => {
    const todays = allocations.filter((a) => a.date === today)
    return { runsToday: todays.length, busesToday: new Set(todays.map((a) => a.fleet_no)).size }
  }, [allocations, today])
  // HR headcount is the consolidated directory (employees + drivers + staff accounts).
  const hr = { headcount: useHrPeople(branch).length }

  const real = useMemo(() => {
    const activeV = fleet.filter((v) => v.status === 'active')
    const active = activeV.length
    const grounded = fleet.filter((v) => v.status === 'grounded').length
    const repair = fleet.filter((v) => v.status === 'under_repair').length
    const total = fleet.length
    const inService = total - grounded // grounded buses aren't part of the operating fleet
    const seats = activeV.reduce((s, v) => s + (v.capacity || 0), 0) // seating capacity on the road
    const licExpired = branchDocs.filter((d) => docStatus(d) === 'expired').length
    const licExpiring = branchDocs.filter((d) => docStatus(d) === 'expiring').length
    const missingDocs = fleet.filter((v) => LICENSING_CATEGORIES.some((cat) => !branchDocs.some((d) => d.entity_id === v.id && d.category === cat))).length
    return { active, grounded, repair, total, inService, seats, avail: inService ? Math.round((active / inService) * 100) : 0, licExpired, licExpiring, missingDocs }
  }, [fleet, branchDocs])

  // Fuel & fleet overview (live depot stock + this month's movements) — for the
  // execs / ops managers who oversee the whole branch.
  const fuelOverview = useMemo(() => {
    const ym = today.slice(0, 7)
    const genApproved = draws.filter(isApprovedDraw).reduce((s, g) => s + g.litres, 0)
    const stock = computeStock(issuances, receipts, fuelCfg, genApproved)
    const receivedThisMonth = receipts.filter((rr) => rr.date.slice(0, 7) === ym).reduce((s, rr) => s + rr.litres, 0)
    const usedThisMonth =
      issuances.filter((i) => i.date.slice(0, 7) === ym).reduce((s, i) => s + i.liters_given, 0) +
      draws.filter((g) => isApprovedDraw(g) && g.date.slice(0, 7) === ym).reduce((s, g) => s + g.litres, 0)
    return { usable: stock.usable, daysLeft: stock.daysLeft, receivedThisMonth, usedThisMonth }
  }, [issuances, receipts, fuelCfg, draws, today])
  // "Done today?" signals so recurring entry tasks clear once completed (and the
  // exec oversight panel reflects reality).
  const allocToday = ops.runsToday > 0
  const mileageToday = mileage.some((m) => m.date === today)
  const fuelToday = issuances.some((i) => i.date === today)

  // Derived metrics for the attention feed + safety/speed cards.
  const r = useMemo(() => {
    const prereqKeys = classes.filter((c) => c.prerequisite).map((c) => c.key)
    const byKey = classMap(classes)
    const caseEventIds = new Set(cases.map((c) => c.event_id).filter(Boolean))
    // Incidents
    const incSafety = cases.filter((c) => c.stage === 'safety_review').length
    const incOps = cases.filter((c) => c.stage === 'ops_review').length
    // Speed
    const valid = events.filter((e) => countsAgainstDriver(e))
    const offence = new Map<string, number>()
    valid.forEach((e) => { const k = e.driver_id || e.driver_name; offence.set(k, (offence.get(k) ?? 0) + 1) })
    const offenderKeys = new Set(events.filter((e) => !isGlitch(e)).map((e) => e.driver_id || e.driver_name))
    const confirmedToEscalate = events.filter((e) => e.status === 'confirmed' && !isGlitch(e) && !caseEventIds.has(e.id)).length
    // Hazards
    const openHaz = hazards.filter((h) => h.status !== 'closed')
    const highHaz = openHaz.filter((h) => riskScore(h) >= 10).length
    // CAP
    const capCompliant = cap.filter((f) => f.status === 'compliant').length
    const capOpen = cap.length - capCompliant
    // Compliance certs expiring/expired (only classes that carry an expiry)
    const compIssues = compliance.filter((c) => byKey[c.category]?.has_expiry && ['expired', 'expiring'].includes(credStatus(c.expiry))).length
    // Driver compliance score (avg across drivers)
    const compliancePct = drivers.length
      ? Math.round(drivers.reduce((sum, d) => {
        const creds = compliance.filter((c) => c.driver_id === d.id)
        const met = prereqsMet(creds, prereqKeys)
        const done = classes.filter((cls) => isCompliantCell(cellState(creds.find((c) => c.category === cls.key), cls.prerequisite, met))).length
        return sum + (classes.length ? done / classes.length : 0)
      }, 0) / drivers.length * 100)
      : 0
    return {
      incSafety, incOps, openInc: incSafety + incOps,
      speedEvents: valid.length, repeatOffenders: [...offence.values()].filter((n) => n >= 2).length,
      cleanDrivers: drivers.filter((d) => !offenderKeys.has(d.id) && !offenderKeys.has(d.full_name)).length,
      confirmedToEscalate,
      openHaz: openHaz.length, highHaz,
      capOpen, capPct: cap.length ? Math.round((capCompliant / cap.length) * 100) : 100,
      compIssues, compliancePct,
      lotoOverdue: loto.filter((p) => lotoStatus(p) === 'overdue').length,
      toolsBad: tools.filter((t) => t.condition === 'defective' || !t.safe_to_use).length,
      toolsDue: tools.filter((t) => inspectionDue(t)).length,
      drawsPending: draws.filter((g) => g.status === 'pending').length,
      mileagePending: mileage.filter((mm) => mm.status === 'pending').length,
    }
  }, [classes, cases, events, hazards, cap, compliance, drivers, loto, tools, draws, mileage])

  // Monthly vehicle inspection coverage for this month — which buses aren't done.
  const inspections = useInspections().filter((i) => i.branch === branch)
  const insp = useMemo(() => {
    const month = today.slice(0, 7)
    const byFleet = new Map<string, MonthlyInspection>()
    for (const it of inspections) {
      if (it.month !== month) continue
      const cur = byFleet.get(it.fleet_no)
      if (!cur || it.status === 'done' || it.updated_at > cur.updated_at) byFleet.set(it.fleet_no, it)
    }
    let overdue = 0, dueToday = 0, unscheduled = 0, worstOver = 0, done = 0
    for (const v of fleet) {
      const st = inspectionStatus(byFleet.get(v.fleet_no), month, today)
      if (st.state === 'overdue') { overdue++; worstOver = Math.max(worstOver, st.daysOver) }
      else if (st.state === 'today') dueToday++
      else if (st.state === 'unscheduled') unscheduled++
      else if (st.state === 'done') done++
    }
    return { overdue, dueToday, unscheduled, worstOver, done }
  }, [inspections, fleet, today])

  // ── Action / attention items — live from the stores, tagged with who acts ──
  const allItems = useMemo<Item[]>(() => {
    const items: Item[] = []
    const push = (i: Item) => items.push(i)
    const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

    // Fleet / licensing (real)
    if (real.licExpired > 0)
      push({ id: 'lic', severity: 'critical', icon: FileWarning, title: `${real.licExpired} licensing ${plural(real.licExpired, 'item')} expired`, detail: 'Vehicles legally need a renewed document on file.', link: '/fleet/licensing', actors: [...OPS, 'workshop_supervisor'] })
    if (real.licExpiring > 0)
      push({ id: 'lic-soon', severity: 'warning', icon: FileWarning, title: `${real.licExpiring} licensing ${plural(real.licExpiring, 'item')} expiring soon`, detail: 'Renew before they lapse to stay road-legal.', link: '/fleet/licensing', actors: [...OPS, 'workshop_supervisor'] })
    if (real.grounded > 0)
      push({ id: 'ground', severity: 'warning', icon: Truck, title: `${real.grounded} ${plural(real.grounded, 'vehicle')} grounded`, detail: 'Out of service — reducing available capacity.', link: '/fleet/vehicles', actors: [...OPS, 'workshop_supervisor'] })
    if (real.missingDocs > 0)
      push({ id: 'missing-docs', severity: 'warning', icon: FileWarning, title: `${real.missingDocs} ${plural(real.missingDocs, 'vehicle')} missing required documents`, detail: 'Workshop to upload road tax, fitness, insurance or FQM inspection.', link: '/fleet/licensing', actors: ['workshop_supervisor', ...OPS] })

    // Incidents (real)
    if (r.incOps > 0)
      push({ id: 'inc-ops', severity: 'critical', icon: ShieldAlert, title: `${r.incOps} ${plural(r.incOps, 'verdict')} awaiting your decision`, detail: 'Safety proposed a verdict — approve or reject it.', link: '/safety/incidents?stage=ops_review', actors: OPS })
    if (r.incSafety > 0)
      push({ id: 'inc-safety', severity: 'warning', icon: ShieldAlert, title: `${r.incSafety} ${plural(r.incSafety, 'incident')} to investigate`, detail: 'Attach evidence and propose a verdict to Ops.', link: '/safety/incidents?stage=safety_review', actors: SAFETY })

    // Speed (real)
    if (r.confirmedToEscalate > 0)
      push({ id: 'speed', severity: 'action', icon: Gauge, title: `${r.confirmedToEscalate} confirmed speeding ${plural(r.confirmedToEscalate, 'event')} to escalate`, detail: 'Raise an incident so Safety can act.', link: '/speed/events', actors: SPEED })

    // Hazards (real)
    if (r.highHaz > 0)
      push({ id: 'haz-high', severity: 'critical', icon: Flame, title: `${r.highHaz} high-risk ${plural(r.highHaz, 'hazard')} open`, detail: 'Severity × likelihood ≥ 10 — control these first.', link: '/safety/hazards', actors: SAFETY })
    else if (r.openHaz > 0)
      push({ id: 'haz', severity: 'warning', icon: Flame, title: `${r.openHaz} open ${plural(r.openHaz, 'hazard')}`, detail: 'Near misses / unsafe conditions awaiting close-out.', link: '/safety/hazards', actors: SAFETY })

    // CAP, compliance (real)
    if (r.capOpen > 0)
      push({ id: 'cap', severity: 'warning', icon: ClipboardCheck, title: `${r.capOpen} CAP ${plural(r.capOpen, 'finding')} outstanding`, detail: `FQM audit close-out at ${r.capPct}%.`, link: '/safety/cap', actors: SAFETY })
    if (r.compIssues > 0)
      push({ id: 'comp', severity: 'warning', icon: ShieldAlert, title: `${r.compIssues} driver compliance ${plural(r.compIssues, 'item')} expiring`, detail: 'Medicals / site classes need renewal.', link: '/safety/compliance', actors: SAFETY })

    // LOTO / tools (real)
    if (r.lotoOverdue > 0)
      push({ id: 'loto', severity: 'warning', icon: Lock, title: `${r.lotoOverdue} LOTO ${plural(r.lotoOverdue, 'point')} overdue`, detail: 'Isolation points unlabelled or past audit.', link: '/safety/loto', actors: WORKSHOP })
    if (r.toolsBad > 0)
      push({ id: 'tools', severity: 'warning', icon: Wrench, title: `${r.toolsBad} ${plural(r.toolsBad, 'tool')} defective or unsafe`, detail: 'Remove from service or repair.', link: '/safety/tools', actors: WORKSHOP })
    else if (r.toolsDue > 0)
      push({ id: 'tools-due', severity: 'action', icon: Wrench, title: `${r.toolsDue} tool ${plural(r.toolsDue, 'inspection')} due`, detail: 'Run the periodic tool inspection.', link: '/safety/tools', actors: WORKSHOP })

    // Monthly vehicle inspection — who hasn't inspected their buses this month (Ops/Asst Ops oversee, Workshop acts)
    if (insp.overdue > 0)
      push({ id: 'insp', severity: insp.worstOver >= 7 ? 'critical' : 'warning', icon: ClipboardCheck, title: `${insp.overdue} ${plural(insp.overdue, 'bus', 'buses')} overdue for monthly inspection`, detail: insp.worstOver ? `Worst is ${insp.worstOver} ${plural(insp.worstOver, 'day')} overdue — assign a mechanic and inspect.` : 'Past due — assign a mechanic and inspect.', link: '/workshop/inspections', actors: [...OPS, 'workshop_supervisor'] })
    else if (insp.dueToday > 0)
      push({ id: 'insp', severity: 'warning', icon: ClipboardCheck, title: `${insp.dueToday} monthly ${plural(insp.dueToday, 'inspection')} due today`, detail: 'Scheduled for today — complete the inspection.', link: '/workshop/inspections', actors: [...OPS, 'workshop_supervisor'] })
    else if (insp.unscheduled > 0)
      push({ id: 'insp', severity: 'action', icon: ClipboardCheck, title: `${insp.unscheduled} ${plural(insp.unscheduled, 'bus', 'buses')} not scheduled for inspection`, detail: 'Assign a mechanic so every bus is inspected this month.', link: '/workshop/inspections', actors: [...OPS, 'workshop_supervisor'] })

    // Operations (real)
    if (r.mileagePending > 0)
      push({ id: 'mil', severity: 'action', icon: RouteIcon, title: `${r.mileagePending} mileage ${plural(r.mileagePending, 'entry', 'entries')} to approve`, detail: 'Daily mileage submitted by the Tracker.', link: '/operations/mileage', actors: OPS })
    if (r.drawsPending > 0)
      push({ id: 'fuel-auth', severity: 'action', icon: Fuel, title: `${r.drawsPending} fuel ${plural(r.drawsPending, 'authorisation')} pending`, detail: 'Authorised-vehicle draws awaiting your sign-off.', link: '/operations/fuel', actors: OPS })

    // Data-entry recurring tasks — shown only while still outstanding for today,
    // so they clear once the entry is made (and the exec oversight stays honest).
    if (!mileageToday)
      push({ id: 'mil-entry', severity: 'action', icon: RouteIcon, title: "Log today's mileage", detail: 'Capture actual distance covered per bus.', link: '/operations/mileage', actors: ['tracker'] })
    if (!fuelToday)
      push({ id: 'fuel-entry', severity: 'action', icon: Fuel, title: "Record today's fuel", detail: 'Fuel issued, driver, vehicle, locations visited.', link: '/operations/fuel', actors: ['fuel_controller'] })
    if (!allocToday)
      push({ id: 'alloc-entry', severity: 'action', icon: RouteIcon, title: "Set today's bus allocation", detail: 'Assign bus, route and driver for the day.', link: '/operations/allocation', actors: ['bus_controller'] })

    return items
  }, [real, r, insp, allocToday, mileageToday, fuelToday])

  // Execs (MD / Directors) + admin oversee the whole branch rather than holding
  // personal action items, so their "Needs your attention" IS the branch watch —
  // everything not in order, at the top (the ops-team backlog has its own panel).
  const isExecView = tier === 'exec' || role === 'administrator'
  const myItems = (isExecView
    ? allItems.filter((i) => i.severity !== 'action' && !OPS_CHAIN.includes(ownerOf(i)))
    : allItems.filter((i) => i.actors.includes(role))
  ).sort((a, b) => SEV[a.severity].rank - SEV[b.severity].rank)
  const sevCounts = {
    critical: myItems.filter((i) => i.severity === 'critical').length,
    warning: myItems.filter((i) => i.severity === 'warning').length,
    action: myItems.filter((i) => i.severity === 'action').length,
  }
  // Oversight of the whole operations chain — what Ops & their team haven't done.
  const showOpsOversight = isExecView
  const opsOutstanding = showOpsOversight
    ? allItems.filter((i) => OPS_CHAIN.includes(ownerOf(i))).sort((a, b) => SEV[a.severity].rank - SEV[b.severity].rank)
    : []
  // Fleet & fuel overview audience: ops managers, execs and admin.
  const showOverview = tier === 'exec' || tier === 'mgmt' || role === 'administrator'
  // Ops managers keep a bottom "Branch watch" for awareness; execs/admin already
  // get the full branch picture at the top, so they don't need a second list.
  const watch = tier === 'mgmt'
    ? allItems.filter((i) => !i.actors.includes(role) && i.severity !== 'action').slice(0, 5)
    : []

  // ── Domain cards (gated to what the role can view), in spec order ──
  // Fleet / Drivers / Operations / Workshop / HR are narrative StoryCards;
  // Speed / Safety / Payroll get dedicated visual cards for faster reading.
  const stories = buildStories(role, branchLabel, { real, staff, ops, hr, operated })
  const storyMap = Object.fromEntries(stories.map((s) => [s.module, s])) as Partial<Record<ModuleKey, Story>>
  const glance: JSX.Element[] = []
  const pushStory = (mod: ModuleKey) => {
    const s = storyMap[mod]
    if (s) glance.push(<StoryCard key={mod} s={s} />)
  }
  pushStory('fleet')
  pushStory('drivers')
  if (canView(role, 'speed')) glance.push(<SpeedCard key="speed" events={r.speedEvents} repeat={r.repeatOffenders} clean={r.cleanDrivers} />)
  pushStory('operations')
  if (canView(role, 'safety')) glance.push(<SafetyCard key="safety" openIncidents={r.openInc} capCompletion={r.capPct} driverCompliance={r.compliancePct} />)
  pushStory('hr')

  // Operations & staffing visuals — for managers & execs who oversee operations
  const showOps = (tier === 'exec' || tier === 'mgmt') && canView(role, 'operations')

  // ── Headline ──
  const criticalCount = myItems.filter((i) => i.severity === 'critical').length + watch.filter((i) => i.severity === 'critical').length
  const headlineTone = criticalCount > 0 ? 'critical' : myItems.length > 0 ? 'warning' : 'good'
  const HeadIcon = headlineTone === 'good' ? CheckCircle2 : headlineTone === 'critical' ? AlertOctagon : AlertTriangle
  const headColor = headlineTone === 'good' ? 'text-status-good' : headlineTone === 'critical' ? 'text-status-critical' : 'text-[#8a6d10]'

  const story =
    myItems.length === 0
      ? `${branchLabel} looks healthy — ${isExecView ? "nothing's out of order" : 'nothing needs your action'} right now.`
      : isExecView
        ? `${branchLabel}: ${myItems.length} thing${myItems.length === 1 ? '' : 's'} ${myItems.length === 1 ? 'is' : 'are'} not in order.`
        : `${branchLabel}: ${myItems.length} item${myItems.length === 1 ? '' : 's'} ${myItems.length === 1 ? 'needs' : 'need'} your action.`

  const monthLbl = new Date().toLocaleDateString('en', { month: 'long', year: 'numeric' })
  const fuelTone: 'neutral' | 'critical' | 'warning' | 'good' =
    fuelOverview.daysLeft == null ? 'neutral' : fuelOverview.daysLeft < 7 ? 'critical' : fuelOverview.daysLeft < 14 ? 'warning' : 'good'

  return (
    <div className="page space-y-6">
      {/* Headline story */}
      <div className="flex items-start gap-3">
        <HeadIcon size={22} className={`mt-0.5 shrink-0 ${headColor}`} />
        <div>
          <h2 className="font-display text-lg font-bold text-navy">
            {greeting()}, {user!.fullName.replace(/\s*\(demo\)$/, '')}.
          </h2>
          <p className="text-sm text-status-neutral">{story} Here's where {branchLabel} stands before you dive in.</p>
        </div>
      </div>

      {/* Needs your attention / your tasks — the heart of the dashboard */}
      <div className={clsx('card overflow-hidden', sevCounts.critical > 0 && 'ring-1 ring-status-critical/20')}>
        <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <ListChecks size={16} className="text-brand" />
          <h3 className="font-display text-sm font-bold text-navy">
            {tier === 'entry' ? 'Your tasks today' : 'Needs your attention'}
          </h3>
          {myItems.length > 0 && <span className="rounded-full bg-navy/5 px-2 py-0.5 text-xs font-bold text-navy">{myItems.length}</span>}
          {myItems.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {(['critical', 'warning', 'action'] as Severity[]).filter((sv) => sevCounts[sv] > 0).map((sv) => (
                <span key={sv} className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold', SEV[sv].chip)}>
                  <span className={clsx('h-1.5 w-1.5 rounded-full', SEV[sv].bar)} /> {sevCounts[sv]} {SEV[sv].label}
                </span>
              ))}
            </div>
          )}
        </div>
        {myItems.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-6 py-12 text-center">
            <CheckCircle2 size={28} className="text-status-good" />
            <p className="text-sm font-semibold text-navy">{isExecView ? 'Everything is in order' : "You're all caught up"}</p>
            <p className="text-xs text-status-neutral">{isExecView ? `Nothing is out of order in ${branchLabel} right now.` : `Nothing needs your action in ${branchLabel} right now.`}</p>
          </div>
        ) : (
          <div className="max-h-96 divide-y divide-black/5 overflow-y-auto">
            {myItems.map((i) => {
              const s = SEV[i.severity]
              const Icon = i.icon
              const owner = ownerOf(i)
              const who = owner !== role ? responsible(owner) : null
              return (
                <Link key={i.id} to={i.link} className="group flex items-stretch hover:bg-canvas">
                  <span className={clsx('w-1.5 shrink-0', s.bar)} aria-hidden />
                  <div className="flex flex-1 items-center gap-3 px-4 py-3.5">
                    <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', s.tint)}>
                      <Icon size={18} className={s.text} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-navy">{i.title}</div>
                      <div className="text-xs text-status-neutral">{i.detail}</div>
                      {who && (
                        <div className="mt-1 inline-flex flex-wrap items-center gap-1 text-[11px]">
                          <UserRound size={11} className="shrink-0 text-status-neutral" />
                          <span className="text-status-neutral">Follow up:</span>
                          <span className="font-semibold text-navy">{who.name}</span>
                          {who.assigned
                            ? <span className="text-status-neutral">· {who.role}</span>
                            : <span className="font-medium text-status-critical">· no user assigned</span>}
                        </div>
                      )}
                    </div>
                    <span className={clsx('hidden rounded-full px-2 py-0.5 text-[10px] font-semibold sm:inline', s.chip)}>{s.label}</span>
                    <ArrowRight size={16} className="shrink-0 text-status-neutral transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Operations oversight — what Ops & their team haven't done (execs + admin) */}
      {showOpsOversight && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <UserCog size={16} className="text-brand" />
            <h3 className="font-display text-sm font-bold text-navy">Operations — outstanding</h3>
            {opsOutstanding.length > 0 && <span className="rounded-full bg-navy/5 px-2 py-0.5 text-xs font-bold text-navy">{opsOutstanding.length}</span>}
            <span className="ml-auto text-[11px] text-status-neutral">what Ops &amp; their team haven't done yet</span>
          </div>
          {opsOutstanding.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
              <CheckCircle2 size={26} className="text-status-good" />
              <p className="text-sm font-semibold text-navy">Operations is on top of everything</p>
              <p className="text-xs text-status-neutral">No outstanding ops tasks in {branchLabel} right now.</p>
            </div>
          ) : (
            <div className="max-h-96 divide-y divide-black/5 overflow-y-auto">
              {opsOutstanding.map((i) => {
                const s = SEV[i.severity]
                const Icon = i.icon
                const who = responsible(ownerOf(i))
                return (
                  <Link key={i.id} to={i.link} className="group flex items-stretch hover:bg-canvas">
                    <span className={clsx('w-1.5 shrink-0', s.bar)} aria-hidden />
                    <div className="flex flex-1 items-center gap-3 px-4 py-3">
                      <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', s.tint)}>
                        <Icon size={18} className={s.text} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-navy">{i.title}</div>
                        <div className="text-xs text-status-neutral">{i.detail}</div>
                        <div className="mt-1 inline-flex flex-wrap items-center gap-1 text-[11px]">
                          <UserRound size={11} className="shrink-0 text-status-neutral" />
                          <span className="text-status-neutral">Follow up:</span>
                          <span className="font-semibold text-navy">{who.name}</span>
                          {who.assigned ? <span className="text-status-neutral">· {who.role}</span> : <span className="font-medium text-status-critical">· no user assigned</span>}
                        </div>
                      </div>
                      <span className={clsx('hidden rounded-full px-2 py-0.5 text-[10px] font-semibold sm:inline', s.chip)}>{s.label}</span>
                      <ArrowRight size={16} className="shrink-0 text-status-neutral transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Fleet & fuel overview — for ops managers, execs and admin */}
      {showOverview && (
        <div className="space-y-3">
          <h3 className="font-display text-sm font-bold text-navy">
            Fleet &amp; fuel overview <span className="font-normal text-status-neutral">· {monthLbl} · {branchLabel}</span>
          </h3>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-status-neutral"><Fuel size={13} className="text-brand" /> Fuel</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiCard label="Fuel left" value={`${Math.round(fuelOverview.usable).toLocaleString()} L`} highlight tone={fuelTone} sub="usable in the depot" info="What's in the tank now minus the dead-stock reserve." />
              <KpiCard label="Days left" value={fuelOverview.daysLeft == null ? '—' : Math.floor(fuelOverview.daysLeft)} tone={fuelTone} sub="at current usage" />
              <KpiCard label="Received this month" value={`${fuelOverview.receivedThisMonth.toLocaleString()} L`} tone="good" sub={monthLbl} />
              <KpiCard label="Used this month" value={`${Math.round(fuelOverview.usedThisMonth).toLocaleString()} L`} sub="vehicles + generator" />
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-status-neutral"><Truck size={13} className="text-brand" /> Fleet</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiCard label="On the road" value={real.active} tone="good" sub={`of ${real.inService} in service`} />
              <KpiCard label="Vehicles down" value={real.repair + real.grounded} tone={real.repair + real.grounded ? 'critical' : 'good'} sub={`${real.repair} workshop · ${real.grounded} grounded`} info="Buses not available — in the workshop or grounded." />
              <KpiCard label="Availability" value={real.inService ? `${real.avail}%` : '—'} tone={real.avail >= 90 ? 'good' : 'warning'} sub="active ÷ in service" />
              <KpiCard label="Need attention" value={real.licExpired + real.licExpiring + real.missingDocs} tone={real.licExpired ? 'critical' : real.licExpiring + real.missingDocs ? 'warning' : 'good'} sub="licensing & documents" info="Expired / expiring licensing plus vehicles missing required documents." />
            </div>
          </div>
        </div>
      )}

      {/* Domain cards — visual where it helps you act, narrative otherwise */}
      {glance.length > 0 && (
        <div>
          <h3 className="mb-3 font-display text-sm font-bold text-navy">
            {tier === 'exec' ? 'Branch at a glance' : 'Where things stand'}
          </h3>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{glance}</div>
        </div>
      )}

      {/* Operations & staffing visuals */}
      {showOps && (
        <OpsInsight
          branchLabel={branchLabel}
          active={real.active}
          repair={real.repair}
          grounded={real.grounded}
          avail={real.avail}
          overtimeDrivers={staff.overtime}
          activeDrivers={staff.active}
          onShift={staff.onShift}
          zones={staff.zones}
        />
      )}

      {/* Branch watch — awareness for managers & execs */}
      {watch.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <Eye size={16} className="text-brand" />
            <h3 className="font-display text-sm font-bold text-navy">Branch watch</h3>
            <span className="ml-auto text-[11px] text-status-neutral">for awareness</span>
          </div>
          <div className="max-h-96 divide-y divide-black/5 overflow-y-auto">
            {watch.map((i) => {
              const s = SEV[i.severity]
              const Icon = i.icon
              const who = responsible(ownerOf(i))
              return (
                <Link key={i.id} to={i.link} className="flex items-center gap-3 px-5 py-2.5 hover:bg-canvas">
                  <Icon size={15} className={`shrink-0 ${s.text}`} />
                  <span className="flex-1 text-sm text-navy">{i.title}</span>
                  <span className="hidden items-center gap-1 text-[11px] text-status-neutral sm:inline-flex">
                    <UserRound size={11} className="shrink-0" />
                    {who.name}
                  </span>
                  <ArrowRight size={14} className="text-status-neutral" />
                </Link>
              )
            })}
          </div>
        </div>
      )}

      <p className="text-center text-xs text-status-neutral">
        Every figure is a live roll-up from its module — entered once, visible everywhere, stamped with who and when.
      </p>
    </div>
  )
}

// ── Narrative story builder — all live data (Speed/Safety have visual cards).
// Workshop & Payroll cards are omitted until those modules store real data.
function buildStories(
  role: RoleKey,
  branchLabel: string,
  data: {
    real: { avail: number; grounded: number; repair: number; total: number; inService: number; seats: number; active: number; licExpired: number; licExpiring: number }
    staff: { active: number; onShift: number; overtime: number; onLeave: number; total: number }
    ops: { runsToday: number; busesToday: number }
    hr: { headcount: number }
    operated: { total: number; active: number }
  },
): Story[] {
  const { real, staff, ops, hr, operated } = data
  const out: Story[] = []
  const add = (module: ModuleKey, s: Omit<Story, 'module'>) => {
    if (canView(role, module)) out.push({ module, ...s })
  }

  add('fleet', {
    title: 'Fleet', icon: Truck, link: '/fleet',
    narrative: `${real.active} of ${real.inService} active buses on the road in ${branchLabel} · ${real.seats} seats${real.grounded ? ` (${real.grounded} grounded, excluded)` : ''}${real.licExpired ? `. ${real.licExpired} licensing item(s) expired.` : '.'}`,
    stats: [
      { label: 'Availability', value: real.inService ? `${real.avail}%` : '—', tone: real.avail >= 90 ? 'good' : 'warning' },
      { label: 'Seats', value: real.seats },
      { label: 'Grounded', value: real.grounded, tone: real.grounded ? 'critical' : undefined },
      { label: 'Lic. expired', value: real.licExpired, tone: real.licExpired ? 'critical' : 'good' },
    ],
  })
  add('drivers', {
    title: 'Drivers', icon: Users, link: '/drivers',
    narrative: `${staff.active} active driver(s), ${staff.onShift} on shift now${staff.overtime ? `, ${staff.overtime} on overtime` : ''}${staff.onLeave ? `, ${staff.onLeave} on leave` : ''}.`,
    stats: [
      { label: 'On shift', value: staff.onShift },
      { label: 'Overtime', value: staff.overtime, tone: staff.overtime ? 'warning' : undefined },
      { label: 'On leave', value: staff.onLeave, tone: staff.onLeave ? 'warning' : undefined },
    ],
  })
  add('operations', {
    title: 'Operations', icon: RouteIcon, link: '/operations',
    narrative: (ops.runsToday
      ? `${ops.busesToday} bus(es) allocated across ${ops.runsToday} run(s) today; ${staff.onShift} drivers on shift.`
      : `No bus allocation set for today yet; ${staff.onShift} drivers on shift.`) + (operated.total ? ` Plus ${operated.active} mine vehicle(s) we operate under contract.` : ''),
    stats: [
      { label: 'Buses today', value: ops.busesToday },
      { label: 'Runs today', value: ops.runsToday, tone: ops.runsToday ? undefined : 'warning' },
      { label: 'Operated', value: operated.active },
      { label: 'On shift', value: staff.onShift },
    ],
  })
  add('hr', {
    title: 'HR', icon: UserCog, link: '/hr',
    narrative: `${hr.headcount} staff on record in ${branchLabel}.`,
    stats: [{ label: 'Headcount', value: hr.headcount }],
  })

  return out
}
