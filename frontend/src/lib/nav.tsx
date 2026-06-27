import {
  LayoutDashboard, Truck, Users, Gauge, Route as RouteIcon,
  ShieldCheck, Wrench, Wallet, UserCog, ReceiptText, FolderOpen, Settings,
  type LucideIcon,
} from 'lucide-react'
import type { ModuleKey } from './permissions'

export interface NavPage {
  label: string
  path: string
  /** What this page will do — drawn from the spec, shown on the placeholder. */
  blurb: string
}

export interface NavNode {
  module: ModuleKey
  label: string
  icon: LucideIcon
  /** Standalone top-level item (no expandable children). */
  standalone?: boolean
  /** First child is always "Overview" for segments (spec §3.3). */
  pages: NavPage[]
}

/**
 * The complete sidebar, in spec order (§4). Every page renders from here:
 * the sidebar, the router, and the placeholder pages all read this tree.
 * To build a real page later, point its route at a real component (App.tsx).
 */
export const NAV: NavNode[] = [
  {
    module: 'admin', label: 'Admin', icon: Settings, standalone: true,
    pages: [{ label: 'Admin', path: '/admin', blurb: 'User accounts, permissions, login activity, approval order, branch names, and system data.' }],
  },
  {
    module: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, standalone: true,
    pages: [{ label: 'Dashboard', path: '/', blurb: 'Cross-branch executive snapshot — KPIs, pending-approvals queue, and month-on-month trends rolled up live from every module.' }],
  },
  {
    module: 'fleet', label: 'Fleet', icon: Truck,
    pages: [
      { label: 'Overview', path: '/fleet', blurb: 'Branch comparison: fleet size, vehicles grounded, licensing expiring within 30 days, fleet compliance score.' },
      { label: 'Vehicle Register', path: '/fleet/vehicles', blurb: 'One record per bus — the anchor every other module references. Plate, make/model, year, branch, status.' },
      { label: 'Licensing & Documents', path: '/fleet/licensing', blurb: 'Statutory docs per vehicle with mandatory file upload and expiry-driven email reminders.' },
      { label: 'Operated Vehicles', path: '/fleet/operated', blurb: 'Contract vehicles we operate but do not own (Pit, Security, Dewatering) — fleet no, registration, owner and status. We provide the drivers only; no documents required.' },
    ],
  },
  {
    module: 'drivers', label: 'Drivers', icon: Users,
    pages: [
      { label: 'Overview', path: '/drivers', blurb: 'Branch comparison: active drivers, on shift now, in overtime, licence/PSV expiry warnings.' },
      { label: 'Driver Roster', path: '/drivers/roster', blurb: 'Crews and shift patterns — who is on, off, or logging overtime (derived from Fuel entries).' },
      { label: 'Work Schedule', path: '/drivers/schedule', blurb: 'Calendar of each driver’s work/rest rotation (7-7 split, 14-7 and 10-5 continuous) — Day, Night or Off per day, with daily coverage.' },
      { label: 'Driver Profiles', path: '/drivers/profiles', blurb: 'Per-driver record: licence, PSV, crew/shift; links to speed history, compliance and training. Medical & site classes live in Safety → Driver Compliance.' },
    ],
  },
  {
    module: 'speed', label: 'Speed Management', icon: Gauge,
    pages: [
      { label: 'Overview', path: '/speed', blurb: 'Events this month vs last, confirmed/disputed split, repeat-offender leaderboard, clean-record scoreboard, vehicle/route breakdown. (Branch toggle: senior roles only.)' },
      { label: 'Speed Events', path: '/speed/events', blurb: 'The Geotab-flagged event log: flagged → confirmed → disputed → closed, each linked to driver, vehicle and route.' },
    ],
  },
  {
    module: 'operations', label: 'Operations', icon: RouteIcon,
    pages: [
      { label: 'Overview', path: '/operations', blurb: 'Reconciles plan vs paid km (Mileage) vs driven km (Fuel odometer): paid-to-unpaid ratio, fuel economy and fuel-vs-revenue per bus to steer efficiency.' },
      { label: 'Daily Plan', path: '/operations/daily-plan', blurb: 'The day’s intended movements — driver, bus, from → to (default Main Mine Gate), departure time. Mobile-friendly entry; exportable; total trips at a glance.' },
      { label: 'Weekly Plan', path: '/operations/weekly-plan', blurb: 'Assign drivers to vehicles for the week. Drag (or tap) on-shift drivers onto a bus; pull in off-duty drivers to cover a shortage and it logs overtime automatically.' },
      { label: 'Bus Allocation', path: '/operations/allocation', blurb: 'The actuals report of how buses moved — driver, bus, route, time and passengers carried. Routes are pulled from the Mileage catalogue.' },
      { label: 'Mileage', path: '/operations/mileage', blurb: 'Daily bus movements split internal/external, rolled into a costed monthly FQM billing reconciliation. Excel workbook + PDF export.' },
      { label: 'Fuel', path: '/operations/fuel', blurb: 'Fuel issued, driver, vehicle, locations visited, next-refuel odometer — the second independent distance figure.' },
    ],
  },
  {
    module: 'safety', label: 'Safety', icon: ShieldCheck,
    pages: [
      { label: 'Overview', path: '/safety', blurb: 'Branch comparison: open incidents, CAP completion, driver compliance, overdue tool inspections, open hazards.' },
      { label: 'Incidents', path: '/safety/incidents', blurb: 'Full incident workflow draft → submitted → reviewed → closed/rejected, with document upload at every stage.' },
      { label: 'Driver Compliance', path: '/safety/compliance', blurb: 'Per-driver record against compliance categories, with mandatory certificate upload and expiry tracking.' },
      { label: 'Training Records', path: '/safety/training', blurb: 'Training/certification categories (defensive driving, TATA OEM, first aid) with mandatory certificate upload.' },
      { label: 'Hazard Register', path: '/safety/hazards', blurb: 'Near-miss and hazard log: type, severity, likelihood, risk rating, control measures, owner, target close date.' },
      { label: 'CAP Tracker', path: '/safety/cap', blurb: 'The twelve FQM Trident OHS audit findings, each with sub-actions and mandatory evidence upload before "compliant".' },
      { label: 'LOTO Register', path: '/safety/loto', blurb: 'Lock-Out Tag-Out isolation points per asset: label code, procedure reference, labelled status, last audit.' },
      { label: 'Tool Inspections', path: '/safety/tools', blurb: 'Hand-tool and equipment checklist: asset tag, condition, safe-to-use flag, next inspection date.' },
    ],
  },
  {
    module: 'workshop', label: 'Workshop', icon: Wrench,
    pages: [
      { label: 'Overview', path: '/workshop', blurb: 'Overdue PM, critical spares below minimum, open RCA, plus fault insights by driver/vehicle/technician/part.' },
      { label: 'Daily Checklists', path: '/workshop/checklists', blurb: 'One per vehicle per day; any failed item auto-creates a draft Job Card tied to the driver and vehicle.' },
      { label: 'PM Schedules', path: '/workshop/pm', blurb: 'OEM/PM tracker per vehicle and component, with its own inspection form feeding Job Cards.' },
      { label: 'Job Cards', path: '/workshop/jobcards', blurb: 'Raised from checklist, PM inspection, or standalone; multi-mechanic; closure needs evidence; tyre jobs write to Tyre Management.' },
      { label: 'Mechanics Schedule', path: '/workshop/mechanics', blurb: 'Work & rest roster for the workshop mechanics (pulled from HR → Employees) — working days and Day/Night shift per mechanic.' },
      { label: 'Tyre Management', path: '/workshop/tyres', blurb: 'Per-vehicle tyre history, auto-populated from tyre-related Job Card closures and directly editable.' },
      { label: 'Critical Spares', path: '/workshop/spares', blurb: 'Inventory register with minimum-stock flagging, informed by the "parts failing most often" insight.' },
      { label: 'Failure / RCA Log', path: '/workshop/rca', blurb: 'Root-cause analysis for serious failures: findings, corrective and preventive action, status to closure.' },
    ],
  },
  {
    module: 'payroll', label: 'Payroll', icon: Wallet,
    pages: [
      { label: 'Overview', path: '/payroll', blurb: 'Upcoming pay run snapshot, current tax liability, and payroll cost trend.' },
      { label: 'Pay Runs', path: '/payroll/runs', blurb: 'Three-step chain: Payroll Officer submits → Operations Manager reviews → Managing Director lock-approves.' },
      { label: 'Taxes', path: '/payroll/taxes', blurb: 'NAPSA, NHIMA, SDL rates and the PAYE band table — changes apply on the next run, not retroactively.' },
      { label: 'Approvals', path: '/payroll/approvals', blurb: 'Dedicated queue of runs awaiting Ops review or MD lock-approval.' },
      { label: 'Payslips', path: '/payroll/payslips', blurb: 'Generated payslips per employee per run, with customisable templates.' },
      { label: 'Reports', path: '/payroll/reports', blurb: 'Payroll summary, employee pay summary, salary statement, deductions and tax summaries.' },
      { label: 'Settings', path: '/payroll/settings', blurb: 'Bank file column order, pay schedule configuration, and other run-level settings.' },
    ],
  },
  {
    module: 'hr', label: 'HR', icon: UserCog,
    pages: [
      { label: 'Overview', path: '/hr', blurb: 'Headcount and pending leave requests by branch, current leave balance snapshot.' },
      { label: 'Employees', path: '/hr/employees', blurb: 'Non-system staff and system employee records, each with branch, role and HOD assignment.' },
      { label: 'Leave', path: '/hr/leave', blurb: 'HOD-based approval: Safety→General Workers, Workshop→Mechanics, Route→Drivers; HR sees a consolidated view.' },
      { label: 'Reports', path: '/hr/reports', blurb: 'Leave and headcount reports in one place.' },
    ],
  },
  {
    module: 'petty_cash', label: 'Petty Cash Requisition', icon: ReceiptText, standalone: true,
    pages: [{ label: 'Petty Cash Requisition', path: '/petty-cash', blurb: 'Request-first model: amount, reason, branch, department, date needed. Safety Officer checks; Ops/Asst Ops gives final approval (first to act).' }],
  },
  {
    module: 'documents', label: 'Documents', icon: FolderOpen, standalone: true,
    pages: [{ label: 'Documents', path: '/documents', blurb: 'Central library for every document — policies, SOPs, risk assessments, licences, permits, IDs, contracts, registers. Versioned, searchable by metadata, approval workflow, expiry/review reminders, and a full audit trail of who filed what and when.' }],
  },
]

/** Flat list of every page with its owning module — used to build routes. */
export const ALL_PAGES = NAV.flatMap((n) => n.pages.map((p) => ({ ...p, module: n.module })))
