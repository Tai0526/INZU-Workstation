import { Construction, Eye, Pencil, Lock } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { permFor, type ModuleKey } from '@/lib/permissions'
import { BRANCHES } from '@/lib/roles'

/**
 * Generic placeholder for every not-yet-built page. Renders the page title, the
 * spec description of what it will do, and the current role's access level —
 * so the whole app is navigable and reviewable before any module is wired up.
 */
export default function PlaceholderPage({
  title,
  blurb,
  module,
}: {
  title: string
  blurb: string
  module: ModuleKey
}) {
  const { user } = useAuth()
  const perm = permFor(user!.role, module)
  const branch = BRANCHES.find((b) => b.code === user!.branch)!

  const access =
    perm === 'edit'
      ? { icon: Pencil, label: 'You can view & edit here', cls: 'text-status-good bg-status-good/10' }
      : perm === 'view'
        ? { icon: Eye, label: 'View only', cls: 'text-navy bg-navy/5' }
        : { icon: Lock, label: 'No access', cls: 'text-status-critical bg-status-critical/10' }
  const AccessIcon = access.icon

  return (
    <div className="page">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm leading-relaxed text-status-neutral">{blurb}</p>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${access.cls}`}>
          <AccessIcon size={13} />
          {access.label}
        </span>
      </div>

      <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-tint text-brand">
          <Construction size={26} />
        </div>
        <h3 className="font-display text-base font-semibold text-navy">Page scaffolded — ready to build</h3>
        <p className="mt-1.5 max-w-md text-sm text-status-neutral">
          This screen is part of the shell. We'll build it out next, page by page, wiring real data,
          forms, and the approval flows described above.
        </p>
        <div className="mt-4 flex items-center gap-2 text-xs text-status-neutral">
          <span className="rounded-full bg-canvas px-2.5 py-1">Branch: {branch.short}</span>
          <span className="rounded-full bg-canvas px-2.5 py-1">Module: {module}</span>
        </div>
      </div>
    </div>
  )
}
