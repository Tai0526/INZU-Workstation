import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, BellOff, AlertTriangle, AlertOctagon, Info, CheckCheck, ChevronRight, CalendarClock } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { useNotifications, markRead, markAllRead, type AppNotification } from '@/lib/notifications/store'
import { groupNotifications } from '@/lib/notifications/group'

const SEV_ICON = {
  critical: AlertOctagon,
  warning: AlertTriangle,
  info: Info,
}
const SEV_COLOR = {
  critical: 'text-status-critical',
  warning: 'text-[#8a6d10]',
  info: 'text-navy',
}

export default function NotificationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { items, unread } = useNotifications(user!.branch, user!.role, user!.fullName)
  const [onlyUnread, setOnlyUnread] = useState(false)

  // Grouped by date, newest first — Upcoming (deadlines) on top, then Today,
  // Yesterday, older days. Urgent items lead within each day.
  const groups = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const list = onlyUnread ? items.filter((n) => !n.read) : items
    return groupNotifications(list, today)
  }, [items, onlyUnread])

  function openItem(n: AppNotification) {
    markRead(n.id)
    navigate(n.link)
    onClose()
  }

  const empty = groups.length === 0

  return (
    <>
      {/* Backdrop */}
      <div
        className={clsx(
          'fixed inset-0 z-[90] bg-navy/20 transition-opacity',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />
      {/* Slide-in panel (right → left) */}
      <aside
        className={clsx(
          'fixed right-0 top-0 z-[95] flex h-full w-[360px] max-w-[92vw] flex-col bg-surface shadow-cardhover transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="border-b border-black/10 px-4 pb-3 pt-3.5">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-sm font-bold text-navy">Notifications</h3>
            {unread > 0 && (
              <span className="rounded-full bg-status-critical px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>
            )}
            <div className="ml-auto flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={() => markAllRead(items.map((i) => i.id))}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-status-neutral hover:bg-canvas hover:text-navy"
                  title="Mark all as read"
                >
                  <CheckCheck size={14} /> Read all
                </button>
              )}
              <button onClick={onClose} className="rounded-md p-1 text-status-neutral hover:bg-canvas hover:text-navy">
                <X size={18} />
              </button>
            </div>
          </div>
          {/* All / Unread filter */}
          {items.length > 0 && (
            <div className="mt-2.5 inline-flex overflow-hidden rounded-lg border border-black/10 text-xs font-medium">
              <button onClick={() => setOnlyUnread(false)}
                className={clsx('px-3 py-1', !onlyUnread ? 'bg-navy text-white' : 'bg-white text-status-neutral hover:text-navy')}>
                All
              </button>
              <button onClick={() => setOnlyUnread(true)}
                className={clsx('px-3 py-1', onlyUnread ? 'bg-navy text-white' : 'bg-white text-status-neutral hover:text-navy')}>
                Unread{unread > 0 ? ` (${unread})` : ''}
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {empty ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center text-status-neutral">
              {onlyUnread ? <CheckCheck size={26} /> : <BellOff size={26} />}
              <p className="text-sm">{onlyUnread ? 'Nothing unread.' : "You're all caught up."}</p>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.key}>
                {/* Sticky date header — stays visible while its day scrolls */}
                <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-black/5 bg-canvas px-4 py-1.5">
                  {g.key === 'upcoming' && <CalendarClock size={12} className="self-center text-status-neutral" />}
                  <span className="text-[11px] font-bold uppercase tracking-wide text-navy">{g.label}</span>
                  {g.sub && <span className="text-[10px] text-status-neutral">{g.sub}</span>}
                  <span className="ml-auto text-[10px] text-status-neutral">{g.items.length}</span>
                </div>
                {g.items.map((n) => {
                  const Icon = SEV_ICON[n.severity]
                  return (
                    <button
                      key={n.id}
                      onClick={() => openItem(n)}
                      title="Open"
                      className={clsx(
                        'group flex w-full items-start gap-3 border-b border-black/5 px-4 py-3 text-left transition-colors hover:bg-canvas',
                        !n.read && 'bg-brand-tint/30',
                      )}
                    >
                      <Icon size={17} className={clsx('mt-0.5 shrink-0', SEV_COLOR[n.severity])} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-navy">{n.title}</span>
                          {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />}
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-status-neutral">{n.detail}</p>
                      </div>
                      {/* Click affordance — the row navigates to the item */}
                      <ChevronRight size={15} className="mt-1 shrink-0 text-status-neutral/40 transition-colors group-hover:text-navy" />
                    </button>
                  )
                })}
              </section>
            ))
          )}
        </div>
      </aside>
    </>
  )
}
