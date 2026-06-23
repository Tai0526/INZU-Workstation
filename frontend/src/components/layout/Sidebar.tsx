import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { NAV } from '@/lib/nav'
import { canView } from '@/lib/permissions'
import { useAuth } from '@/auth/AuthContext'

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={clsx(
        'flex items-center gap-3 border-b border-white/10 py-4',
        collapsed ? 'justify-center px-0' : 'px-5',
      )}
    >
      <img
        src="/logo.png"
        alt="INZU"
        className="h-9 w-9 shrink-0 rounded-lg object-contain"
        onError={(e) => {
          const el = e.currentTarget
          el.style.display = 'none'
          ;(el.nextElementSibling as HTMLElement | null)?.style.removeProperty('display')
        }}
      />
      <div
        className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand font-display text-sm font-extrabold text-navy"
        style={{ display: 'none' }}
      >
        IZ
      </div>
      {!collapsed && (
        <div className="leading-tight">
          <div className="font-display text-sm font-bold">INZU Workstation</div>
          <div className="text-[10px] text-white/45">Transport · Safety · Compliance</div>
        </div>
      )}
    </div>
  )
}

export default function Sidebar({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const { user, hiddenPages } = useAuth()
  const location = useLocation()
  const role = user!.role

  const pagesOf = (n: (typeof NAV)[number]) => n.pages.filter((p) => !hiddenPages.has(p.path))
  const nodes = NAV.filter((n) => canView(role, n.module) && pagesOf(n).length > 0)

  const activeNode = nodes.find((n) =>
    pagesOf(n).some((p) => (p.path === '/' ? location.pathname === '/' : location.pathname.startsWith(p.path))),
  )
  const [openModule, setOpenModule] = useState<string | null>(activeNode?.module ?? null)

  useEffect(() => {
    if (activeNode && !activeNode.standalone) setOpenModule(activeNode.module)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  return (
    <aside className={clsx('flex h-full flex-col bg-navy text-white transition-all', collapsed ? 'w-16' : 'w-64')}>
      <Brand collapsed={collapsed} />

      <nav className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2.5 py-3">
        {nodes.map((node) => {
          const Icon = node.icon
          const pages = pagesOf(node)
          const segActive = pages.some((p) =>
            p.path === '/' ? location.pathname === '/' : location.pathname.startsWith(p.path),
          )

          // ── Collapsed rail: icon only, navigates to the first page ──
          if (collapsed) {
            return (
              <NavLink
                key={node.module}
                to={pages[0].path}
                end={pages[0].path === '/'}
                onClick={onNavigate}
                title={node.label}
                className={clsx(
                  'flex items-center justify-center rounded-lg py-2.5 transition-colors',
                  segActive ? 'bg-navy-secondary text-brand' : 'text-white/60 hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon size={18} />
              </NavLink>
            )
          }

          // ── Standalone item ──
          if (node.standalone) {
            const page = pages[0]
            return (
              <NavLink
                key={node.module}
                to={page.path}
                end={page.path === '/'}
                onClick={onNavigate}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-navy-secondary font-medium text-white'
                      : 'text-white/60 hover:bg-white/5 hover:text-white',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={clsx('h-4 w-[2.5px] rounded-full', isActive ? 'bg-brand' : 'bg-transparent')} />
                    <Icon size={16} className="shrink-0" />
                    <span className="truncate">{node.label}</span>
                  </>
                )}
              </NavLink>
            )
          }

          // ── Expandable segment ──
          const isOpen = openModule === node.module
          return (
            <div key={node.module}>
              <button
                onClick={() => setOpenModule(isOpen ? null : node.module)}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  segActive ? 'text-white' : 'text-white/60 hover:bg-white/5 hover:text-white',
                )}
              >
                <span className={clsx('h-4 w-[2.5px] rounded-full', segActive ? 'bg-brand' : 'bg-transparent')} />
                <Icon size={16} className="shrink-0" />
                <span className="flex-1 truncate text-left">{node.label}</span>
                <ChevronDown size={14} className={clsx('shrink-0 transition-transform', isOpen && 'rotate-180')} />
              </button>

              {isOpen && (
                <div className="mb-1 ml-[26px] mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
                  {pages.map((page) => (
                    <NavLink
                      key={page.path}
                      to={page.path}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        clsx(
                          'block rounded-md px-3 py-1.5 text-[13px] transition-colors',
                          isActive
                            ? 'bg-navy-secondary font-medium text-brand'
                            : 'text-white/55 hover:bg-white/5 hover:text-white',
                        )
                      }
                    >
                      {page.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {!collapsed && (
        <div className="border-t border-white/10 px-5 py-3 text-[10px] text-white/35">
          Ventura Capital Group · {new Date().getFullYear()}
        </div>
      )}
    </aside>
  )
}
