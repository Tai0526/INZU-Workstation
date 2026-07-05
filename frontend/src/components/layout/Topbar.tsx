import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Menu, LogOut, MapPin, PanelLeftClose, PanelLeft, Bell, MessageSquare } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { NAV } from '@/lib/nav'
import NotificationPanel from '@/components/notifications/NotificationPanel'
import { useNotifications } from '@/lib/notifications/store'
import { useMessaging, totalUnread } from '@/lib/messaging/store'

/** Breadcrumb-style page title for the top bar: "Fleet · Overview", "Messages", etc. */
function pageTitle(pathname: string): string {
  if (pathname.startsWith('/messages')) return 'Messages'
  for (const node of NAV) {
    for (const page of node.pages) {
      const match = page.path === '/' ? pathname === '/' : pathname === page.path
      if (match) return node.standalone ? page.label : `${node.label} · ${page.label}`
    }
  }
  return 'INZU Workstation'
}

export default function Topbar({
  onMenu,
  onToggleCollapse,
  collapsed,
}: {
  onMenu: () => void
  onToggleCollapse: () => void
  collapsed: boolean
}) {
  const { user, logout, branches, setBranch } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [notifOpen, setNotifOpen] = useState(false)

  const title = pageTitle(location.pathname)

  const branch = BRANCHES.find((b) => b.code === user!.branch)!
  const initials = user!.fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  const { unread: notifUnread } = useNotifications(user!.branch, user!.role, user!.fullName)
  const msgState = useMessaging()
  const msgUnread = totalUnread(msgState, user!.id)

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-black/10 bg-surface px-4">
      {/* Mobile: open drawer */}
      <button onClick={onMenu} className="rounded-md p-1.5 text-navy hover:bg-canvas lg:hidden">
        <Menu size={18} />
      </button>

      {/* Desktop: collapse / expand the sidebar */}
      <button
        onClick={onToggleCollapse}
        className="hidden rounded-md p-1.5 text-navy hover:bg-canvas lg:block"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
      </button>

      <h1 className="min-w-0 truncate font-display text-[15px] font-bold text-navy">{title}</h1>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* Branch context — a switcher when the user may view more than one */}
        {branches.length > 1 ? (
          // Cross-branch switcher — shown on every screen size (incl. mobile).
          <div className="mr-1 flex items-center gap-1 rounded-full bg-navy/5 pl-2.5 pr-1 py-1 text-xs font-medium text-navy">
            <MapPin size={13} className="shrink-0 text-brand" />
            <select value={user!.branch} onChange={(e) => setBranch(e.target.value as any)} className="max-w-[92px] bg-transparent text-xs font-medium text-navy outline-none">
              {branches.map((b) => <option key={b} value={b}>{BRANCHES.find((x) => x.code === b)!.short}</option>)}
            </select>
          </div>
        ) : (
          <div className="mr-1 hidden items-center gap-1.5 rounded-full bg-navy/5 px-3 py-1.5 text-xs font-medium text-navy sm:flex">
            <MapPin size={13} className="text-brand" />
            {branch.short}
          </div>
        )}

        {/* Notifications */}
        <button
          onClick={() => setNotifOpen(true)}
          className="relative rounded-md p-2 text-navy hover:bg-canvas"
          title="Notifications"
        >
          <Bell size={18} />
          {notifUnread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-critical px-1 text-[9px] font-bold text-white">
              {notifUnread > 9 ? '9+' : notifUnread}
            </span>
          )}
        </button>

        {/* Messages */}
        <button
          onClick={() => navigate('/messages')}
          className="relative rounded-md p-2 text-navy hover:bg-canvas"
          title="Messages"
        >
          <MessageSquare size={18} />
          {msgUnread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold text-white">
              {msgUnread > 9 ? '9+' : msgUnread}
            </span>
          )}
        </button>

        {/* User */}
        <div className="ml-1 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy font-display text-xs font-bold text-white">
            {initials}
          </div>
          <div className="hidden leading-tight md:block">
            <div className="text-xs font-semibold text-navy">{user!.fullName}</div>
            <div className="text-[10px] text-status-neutral">{ROLES[user!.role].label}</div>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-status-critical"
          title="Sign out"
        >
          <LogOut size={17} />
        </button>
      </div>

      <NotificationPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
    </header>
  )
}
