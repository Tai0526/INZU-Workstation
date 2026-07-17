import { lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/auth/LoginPage'
import ChangePassword from '@/pages/auth/ChangePassword'
import PlaceholderPage from '@/components/PlaceholderPage'
import { ALL_PAGES } from '@/lib/nav'
import { canView } from '@/lib/permissions'
import { useAuth } from '@/auth/AuthContext'

/**
 * Every page is code-split. Importing them eagerly meant one 4 MB bundle: the
 * login screen waited on Petty Cash's spreadsheet library, Payroll's PDF
 * renderer, the speed map's mapping library and every other page's code before
 * it could paint. Now each route fetches only its own chunk, on demand, and the
 * heavy libraries ride along with the one page that needs them.
 *
 * Deliberately NOT lazy: the layout shell, the login page and the forced
 * password change. They are the first paint — a second round trip for those
 * would trade the win straight back. <Suspense> lives in Layout, around the
 * outlet, so the shell stays on screen while a page loads.
 */
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const FleetOverview = lazy(() => import('@/pages/fleet/FleetOverview'))
const VehicleRegister = lazy(() => import('@/pages/fleet/VehicleRegister'))
const Licensing = lazy(() => import('@/pages/fleet/Licensing'))
const OperatedVehicles = lazy(() => import('@/pages/fleet/OperatedVehicles'))
const DriversOverview = lazy(() => import('@/pages/drivers/DriversOverview'))
const DriverRoster = lazy(() => import('@/pages/drivers/DriverRoster'))
const DriverSchedule = lazy(() => import('@/pages/drivers/DriverSchedule'))
const DriverProfiles = lazy(() => import('@/pages/drivers/DriverProfiles'))
const SpeedOverview = lazy(() => import('@/pages/speed/SpeedOverview'))
const SpeedEvents = lazy(() => import('@/pages/speed/SpeedEvents'))
const OperationsOverview = lazy(() => import('@/pages/operations/OperationsOverview'))
const DailyPlan = lazy(() => import('@/pages/operations/DailyPlan'))
const WeeklyPlan = lazy(() => import('@/pages/operations/WeeklyPlan'))
const BusAllocation = lazy(() => import('@/pages/operations/BusAllocation'))
const Mileage = lazy(() => import('@/pages/operations/Mileage'))
const Fuel = lazy(() => import('@/pages/operations/Fuel'))
const SafetyOverview = lazy(() => import('@/pages/safety/SafetyOverview'))
const Incidents = lazy(() => import('@/pages/safety/Incidents'))
const DriverCompliance = lazy(() => import('@/pages/safety/DriverCompliance'))
const TrainingRecords = lazy(() => import('@/pages/safety/TrainingRecords'))
const HazardRegister = lazy(() => import('@/pages/safety/HazardRegister'))
const CapTracker = lazy(() => import('@/pages/safety/CapTracker'))
const LotoRegister = lazy(() => import('@/pages/safety/LotoRegister'))
const ToolInspections = lazy(() => import('@/pages/safety/ToolInspections'))
const GeneralWorkers = lazy(() => import('@/pages/safety/GeneralWorkers'))
const WorkshopOverview = lazy(() => import('@/pages/workshop/WorkshopOverview'))
const JobCards = lazy(() => import('@/pages/workshop/JobCards'))
const MechanicsSchedule = lazy(() => import('@/pages/workshop/MechanicsSchedule'))
const DailyChecklists = lazy(() => import('@/pages/workshop/DailyChecklists'))
const PmSchedules = lazy(() => import('@/pages/workshop/PmSchedules'))
const MonthlyInspections = lazy(() => import('@/pages/workshop/MonthlyInspections'))
const TyreManagement = lazy(() => import('@/pages/workshop/TyreManagement'))
const CriticalSpares = lazy(() => import('@/pages/workshop/CriticalSpares'))
const RcaLog = lazy(() => import('@/pages/workshop/RcaLog'))
const HrOverview = lazy(() => import('@/pages/hr/HrOverview'))
const Employees = lazy(() => import('@/pages/hr/Employees'))
const StaffSchedule = lazy(() => import('@/pages/hr/StaffSchedule'))
const HrLeave = lazy(() => import('@/pages/hr/Leave'))
const HrReports = lazy(() => import('@/pages/hr/HrReports'))
const PayRuns = lazy(() => import('@/pages/payroll/PayRuns'))
const PayrollTaxes = lazy(() => import('@/pages/payroll/Taxes'))
const Payslips = lazy(() => import('@/pages/payroll/Payslips'))
const DocumentsLibrary = lazy(() => import('@/pages/documents/DocumentsLibrary'))
const Messages = lazy(() => import('@/pages/messages/Messages'))
const Admin = lazy(() => import('@/pages/admin/Admin'))
const PettyCash = lazy(() => import('@/pages/pettycash/PettyCash'))

// Real (built) pages, keyed by path. Anything not here renders as a placeholder.
const REAL_PAGES: Record<string, React.ComponentType> = {
  '/fleet': FleetOverview,
  '/fleet/vehicles': VehicleRegister,
  '/fleet/licensing': Licensing,
  '/fleet/operated': OperatedVehicles,
  '/drivers': DriversOverview,
  '/drivers/roster': DriverRoster,
  '/drivers/schedule': DriverSchedule,
  '/drivers/profiles': DriverProfiles,
  '/speed': SpeedOverview,
  '/speed/events': SpeedEvents,
  '/operations': OperationsOverview,
  '/operations/daily-plan': DailyPlan,
  '/operations/weekly-plan': WeeklyPlan,
  '/operations/allocation': BusAllocation,
  '/operations/mileage': Mileage,
  '/operations/fuel': Fuel,
  '/safety': SafetyOverview,
  '/safety/incidents': Incidents,
  '/safety/compliance': DriverCompliance,
  '/safety/training': TrainingRecords,
  '/safety/hazards': HazardRegister,
  '/safety/cap': CapTracker,
  '/safety/loto': LotoRegister,
  '/safety/tools': ToolInspections,
  '/safety/general-workers': GeneralWorkers,
  '/workshop': WorkshopOverview,
  '/workshop/checklists': DailyChecklists,
  '/workshop/pm': PmSchedules,
  '/workshop/inspections': MonthlyInspections,
  '/workshop/jobcards': JobCards,
  '/workshop/mechanics': MechanicsSchedule,
  '/workshop/tyres': TyreManagement,
  '/workshop/spares': CriticalSpares,
  '/workshop/rca': RcaLog,
  '/hr': HrOverview,
  '/hr/employees': Employees,
  '/hr/staff-schedule': StaffSchedule,
  '/hr/leave': HrLeave,
  '/hr/reports': HrReports,
  '/payroll': PayRuns,
  '/payroll/runs': PayRuns,
  '/payroll/taxes': PayrollTaxes,
  '/payroll/payslips': Payslips,
  '/documents': DocumentsLibrary,
  '/petty-cash': PettyCash,
  '/admin': Admin,
}

/** Blocks a page if the current role can't view its module or it's hidden for the user. */
function Gate({ module, path, children }: { module: any; path: string; children: React.ReactNode }) {
  const { user, hiddenPages } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!canView(user.role, module)) return <Navigate to="/" replace />
  if (hiddenPages.has(path)) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const { user, mustChangePassword } = useAuth()
  // A user signed in with a temporary password must set their own before anything else.
  if (user && mustChangePassword) return <ChangePassword />

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />

        {/* Top-nav destinations available to any signed-in user */}
        <Route path="messages" element={<Messages />} />

        {/* Non-dashboard pages: a real component if built, else a placeholder. */}
        {ALL_PAGES.filter((p) => p.path !== '/').map((p) => {
          const Real = REAL_PAGES[p.path]
          return (
            <Route
              key={p.path}
              path={p.path.replace(/^\//, '')}
              element={
                <Gate module={p.module} path={p.path}>
                  {Real ? <Real /> : <PlaceholderPage title={p.label} blurb={p.blurb} module={p.module} />}
                </Gate>
              }
            />
          )
        })}
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
