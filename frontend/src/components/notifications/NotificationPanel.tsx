import { useNavigate } from 'react-router-dom'
import { X, BellOff, AlertTriangle, AlertOctagon, Info, CheckCheck } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { useNotifications, markRead, markAllRead, type AppNotification } from '@/lib/notifications/store'

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
  const { items, unread } = useNotifications(user!.branch, user!.role)

  function openItem(n: AppNotification) {
    markRead(n.id)
    navigate(n.link)
    onClose()
  }

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
          'fixed right-0 top-0 z-[95] flex h-full w-[340px] max-w-[88vw] flex-col bg-surface shadow-cardhover transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center gap-2 border-b border-black/10 px-4 py-3.5">
          <h3 className="font-display text-sm font-bold text-navy">Notifications</h3>
          {unread > 0 && (
            <span className="rounded-full bg-status-critical px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {items.length > 0 && (
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

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center text-status-neutral">
              <BellOff size={26} />
              <p className="text-sm">You're all caught up.</p>
            </div>
          ) : (
            items.map((n) => {
              const Icon = SEV_ICON[n.severity]
              return (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={clsx(
                    'flex w-full gap-3 border-b border-black/5 px-4 py-3 text-left transition-colors hover:bg-canvas',
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
                </button>
              )
            })
          )}
        </div>
      </aside>
    </>
  )
}
