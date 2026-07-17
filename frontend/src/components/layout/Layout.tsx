import { Suspense, useEffect, useState } from 'react'
import { Outlet, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { reconcileVehicleDocBranches } from '@/lib/fleet/store'
import ErrorBoundary from '@/components/ErrorBoundary'
import SyncStatus from '@/components/SyncStatus'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

const LS_COLLAPSED = 'inzu_sidebar_collapsed'

/** Shown only while a page's chunk downloads — usually a single frame on a warm cache. */
function PageLoading() {
  return (
    <div className="flex h-full items-center justify-center py-24">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-black/10 border-t-brand" />
    </div>
  )
}

export default function Layout() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(LS_COLLAPSED) === '1')

  // Keep vehicle documents on the same branch as their vehicle (heals transfers).
  useEffect(() => { reconcileVehicleDocBranches() }, [])

  if (!user) return <Navigate to="/login" replace />

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem(LS_COLLAPSED, next ? '1' : '0')
      return next
    })
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Desktop sidebar (collapsible) */}
      <div className="hidden shrink-0 lg:block">
        <Sidebar collapsed={collapsed} />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-navy/50 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed left-0 top-0 z-50 h-full lg:hidden">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </>
      )}

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onMenu={() => setMobileOpen((o) => !o)}
          onToggleCollapse={toggleCollapsed}
          collapsed={collapsed}
        />
        <main className="flex-1 overflow-auto bg-canvas">
          {/* Pages are code-split (see App.tsx), so this boundary catches the
              moment a route's chunk is still downloading. It sits inside the
              shell on purpose: the sidebar and top bar stay put, so navigation
              feels instant even on a slow connection. */}
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <SyncStatus />
    </div>
  )
}
