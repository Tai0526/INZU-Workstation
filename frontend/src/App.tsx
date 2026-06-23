import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/auth/LoginPage'
import Dashboard from '@/pages/Dashboard'
import FleetOverview from '@/pages/fleet/FleetOverview'
import VehicleRegister from '@/pages/fleet/VehicleRegister'
import Licensing from '@/pages/fleet/Licensing'
import OperatedVehicles from '@/pages/fleet/OperatedVehicles'
import DriversOverview from '@/pages/drivers/DriversOverview'
import DriverRoster from '@/pages/drivers/DriverRoster'
import DriverSchedule from '@/pages/drivers/DriverSchedule'
import DriverProfiles from '@/pages/drivers/DriverProfiles'
import SpeedOverview from '@/pages/speed/SpeedOverview'
import SpeedEvents from '@/pages/speed/SpeedEvents'
import OperationsOverview from '@/pages/operations/OperationsOverview'
import DailyPlan from '@/pages/operations/DailyPlan'
import WeeklyPlan from '@/pages/operations/WeeklyPlan'
import BusAllocation from '@/pages/operations/BusAllocation'
import Mileage from '@/pages/operations/Mileage'
import Fuel from '@/pages/operations/Fuel'
import SafetyOverview from '@/pages/safety/SafetyOverview'
import Incidents from '@/pages/safety/Incidents'
import DriverCompliance from '@/pages/safety/DriverCompliance'
import TrainingRecords from '@/pages/safety/TrainingRecords'
import HazardRegister from '@/pages/safety/HazardRegister'
import CapTracker from '@/pages/safety/CapTracker'
import LotoRegister from '@/pages/safety/LotoRegister'
import ToolInspections from '@/pages/safety/ToolInspections'
import DocumentsLibrary from '@/pages/documents/DocumentsLibrary'
import Messages from '@/pages/messages/Messages'
import Admin from '@/pages/admin/Admin'
import PlaceholderPage from '@/components/PlaceholderPage'
import { ALL_PAGES } from '@/lib/nav'

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
  '/documents': DocumentsLibrary,
  '/admin': Admin,
}
import { canView } from '@/lib/permissions'
import { useAuth } from '@/auth/AuthContext'

/** Blocks a page if the current role can't view its module or it's hidden for the user. */
function Gate({ module, path, children }: { module: any; path: string; children: React.ReactNode }) {
  const { user, hiddenPages } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!canView(user.role, module)) return <Navigate to="/" replace />
  if (hiddenPages.has(path)) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
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
