import { useMemo, useState } from 'react'
import { Search, Eye, Wrench, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import StatChips from '@/components/ui/StatChips'
import VehicleDocsModal from '@/components/fleet/VehicleDocsModal'
import { useVehicles } from '@/lib/fleet/store'
import type { Vehicle } from '@/lib/fleet/types'
import { useDocuments } from '@/lib/documents/store'
import { CATEGORY_META, LICENSING_CATEGORIES, docStatus, type DocCategory } from '@/lib/documents/types'

type VStatus = 'none' | 'noncompliant' | 'expiring' | 'compliant'
type FilterKey = 'all' | VStatus

const STATUS_META: Record<VStatus, { label: string; accent: string; chip: string }> = {
  none: { label: 'No documents', accent: 'border-[#7f1d1d] bg-[#7f1d1d]/[0.07]', chip: 'bg-[#7f1d1d]/15 text-[#7f1d1d]' },
  noncompliant: { label: 'Action needed', accent: 'border-status-critical bg-status-critical/[0.04]', chip: 'bg-status-critical/10 text-status-critical' },
  expiring: { label: 'Expiring soon', accent: 'border-status-warning bg-status-warning/[0.05]', chip: 'bg-status-warning/15 text-[#8a6d10]' },
  compliant: { label: 'Compliant', accent: 'border-status-good bg-status-good/[0.04]', chip: 'bg-status-good/10 text-status-good' },
}

export default function Licensing() {
  const { user } = useAuth()
  const role = user!.role
  const editable = canEdit(role, 'fleet')
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[role].canToggleBranch

  const vehicles = useVehicles()
  const docs = useDocuments()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [picked, setPicked] = useState<Vehicle | null>(null)

  const fleet = useMemo(() => {
    return vehicles
      .filter((v) => v.branch === branch)
      .map((v) => {
        const cells = LICENSING_CATEGORIES.map((cat) => {
          const cur = docs.find((d) => d.entity_id === v.id && d.category === cat && !d.superseded)
          return { cat, state: (cur ? docStatus(cur) : 'missing') as ReturnType<typeof docStatus> | 'missing' }
        })
        const present = cells.filter((c) => c.state !== 'missing')
        const status: VStatus =
          present.length === 0 ? 'none'
            : cells.some((c) => c.state === 'expired' || c.state === 'missing') ? 'noncompliant'
              : cells.some((c) => c.state === 'expiring') ? 'expiring'
                : 'compliant'
        return { v, cells, present: present.length, status }
      })
      .sort((a, b) => a.v.fleet_no.localeCompare(b.v.fleet_no))
  }, [vehicles, docs, branch])

  const counts = useMemo(() => ({
    all: fleet.length,
    compliant: fleet.filter((f) => f.status === 'compliant').length,
    expiring: fleet.filter((f) => f.status === 'expiring').length,
    noncompliant: fleet.filter((f) => f.status === 'noncompliant').length,
    none: fleet.filter((f) => f.status === 'none').length,
  }), [fleet])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return fleet
      .filter((f) => !term || [f.v.fleet_no, f.v.reg_plate].some((x) => x.toLowerCase().includes(term)))
      .filter((f) => filter === 'all' || f.status === filter)
  }, [fleet, q, filter])

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="max-w-2xl text-sm text-status-neutral">
            Pick a vehicle to view or upload its documents — Road Tax, Fitness, Insurance and FQM Inspection.
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-status-neutral">
            <Wrench size={13} className="text-brand" /> Maintained by Workshop · Operations is alerted to any gaps.
          </p>
        </div>
        {!editable && <span className="inline-flex items-center gap-1.5 rounded-full bg-navy/5 px-3 py-1 text-xs font-medium text-navy"><Eye size={13} /> View only</span>}
      </div>

      {/* Summary + filter */}
      <StatChips
        active={filter}
        onPick={(v) => setFilter(v)}
        stats={[
          { value: 'all', label: 'All vehicles', count: counts.all, tone: 'neutral' },
          { value: 'compliant', label: 'Compliant', count: counts.compliant, tone: 'good' },
          { value: 'expiring', label: 'Expiring soon', count: counts.expiring, tone: 'warning' },
          { value: 'noncompliant', label: 'Action needed', count: counts.noncompliant, tone: 'critical' },
          { value: 'none', label: 'No documents', count: counts.none, tone: 'critical' },
        ]}
      />

      <div className="relative max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fleet no or plate…"
          className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
      </div>

      {/* Vehicle cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((f) => {
          const meta = STATUS_META[f.status]
          const missing = f.cells.filter((c) => c.state === 'missing').map((c) => CATEGORY_META[c.cat].short)
          const expiringList = f.cells.filter((c) => c.state === 'expiring').map((c) => CATEGORY_META[c.cat].short)
          const expiredList = f.cells.filter((c) => c.state === 'expired').map((c) => CATEGORY_META[c.cat].short)
          return (
            <button key={f.v.id} onClick={() => setPicked(f.v)}
              className={clsx('card group border-l-4 p-4 text-left transition-shadow hover:shadow-cardhover', meta.accent)}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-navy">{f.v.fleet_no}</div>
                  <div className="text-xs text-status-neutral">{f.v.reg_plate}</div>
                </div>
                <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold', meta.chip)}>{meta.label}</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-status-neutral"><b className="text-navy">{f.present}/{f.cells.length}</b> documents on file</span>
                <ChevronRight size={15} className="text-status-neutral transition-transform group-hover:translate-x-0.5" />
              </div>
              {(missing.length > 0 || expiredList.length > 0 || expiringList.length > 0) && (
                <div className="mt-1.5 space-y-0.5 text-[11px]">
                  {missing.length > 0 && <div className="text-[#7f1d1d]">Missing: {missing.join(', ')}</div>}
                  {expiredList.length > 0 && <div className="text-status-critical">Expired: {expiredList.join(', ')}</div>}
                  {expiringList.length > 0 && <div className="text-[#8a6d10]">Expiring: {expiringList.join(', ')}</div>}
                </div>
              )}
            </button>
          )
        })}
        {rows.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-black/15 px-6 py-12 text-center text-sm text-status-neutral">
            {filter === 'all' ? 'No vehicles match.' : 'No vehicles in this group.'}
          </div>
        )}
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only — your role is locked to this branch.</p>}

      <VehicleDocsModal vehicle={picked} open={!!picked} onClose={() => setPicked(null)} canEdit={editable} />
    </div>
  )
}
