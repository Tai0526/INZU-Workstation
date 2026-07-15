import { useMemo, useState } from 'react'
import {
  Plus, Search, Download, Upload, Pencil, Trash2, ChevronsUpDown, Info, Eye,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { useDeepLink } from '@/lib/ui/deeplink'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import VehicleFormModal from '@/components/fleet/VehicleFormModal'
import ImportModal from '@/components/fleet/ImportModal'
import { useVehicles, vehiclesStore } from '@/lib/fleet/store'
import { type Vehicle, type VehicleStatus, STATUS_META, TYPE_LABELS } from '@/lib/fleet/types'
import { exportVehicles } from '@/lib/fleet/excel'

type SortKey = 'fleet_no' | 'status'

export default function VehicleRegister() {
  const { user } = useAuth()
  const role = user!.role
  const editable = canEdit(role, 'fleet')
  const canToggle = ROLES[role].canToggleBranch
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short

  const all = useVehicles()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | VehicleStatus>('all')
  useDeepLink(['status'], (p) => { const s = p.get('status'); if (s) setStatusFilter(s as VehicleStatus) })
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fleet_no', dir: 1 })

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    let list = all.filter((v) => v.branch === branch)
    if (statusFilter !== 'all') list = list.filter((v) => v.status === statusFilter)
    if (term)
      list = list.filter((v) =>
        [v.fleet_no, v.reg_plate, v.make, v.model].some((f) => f.toLowerCase().includes(term)),
      )
    list = [...list].sort((a, b) => {
      const av = String(a[sort.key]).toLowerCase()
      const bv = String(b[sort.key]).toLowerCase()
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0
    })
    return list
  }, [all, branch, q, statusFilter, sort])

  const counts = useMemo(() => {
    const branchVehicles = all.filter((v) => v.branch === branch)
    return {
      total: branchVehicles.length,
      active: branchVehicles.filter((v) => v.status === 'active').length,
      unavailable: branchVehicles.filter((v) => v.status !== 'active').length,
    }
  }, [all, branch])

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }))
  }

  function openAdd() {
    setEditing(null)
    setFormOpen(true)
  }
  function openEdit(v: Vehicle) {
    setEditing(v)
    setFormOpen(true)
  }
  function remove(v: Vehicle) {
    if (confirm(`Delete ${v.fleet_no} (${v.reg_plate})? This cannot be undone.`)) vehiclesStore.remove(v.id)
  }

  return (
    <div className="page space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          One record per vehicle, keyed by Fleet Number — the anchor every other module references.
        </p>
        {!editable && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-navy/5 px-3 py-1 text-xs font-medium text-navy">
            <Eye size={13} /> View only
          </span>
        )}
      </div>

      {/* Availability rule note */}
      <div className="flex gap-2.5 rounded-xl border border-brand/30 bg-brand-tint/50 px-4 py-3 text-sm text-navy">
        <Info size={16} className="mt-0.5 shrink-0 text-brand" />
        <p className="leading-relaxed">
          <span className="font-medium">Status drives availability.</span> Only{' '}
          <span className="font-medium text-status-good">Active</span> vehicles can receive fuel, be allocated to a
          route, log mileage, or be tracked for speed. <span className="font-medium text-status-warning">In Workshop</span>{' '}
          and <span className="font-medium text-status-critical">Grounded</span> vehicles drop out of those flows
          automatically.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search fleet no, plate, model…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand"
        >
          <option value="all">All statuses</option>
          {Object.entries(STATUS_META).map(([v, m]) => (
            <option key={v} value={v}>{m.label}</option>
          ))}
        </select>

        <Button variant="secondary" onClick={() => exportVehicles(rows, branchLabel)} title="Export current list to Excel">
          <Download size={15} /> Export
        </Button>
        {editable && (
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload size={15} /> Import
          </Button>
        )}
        {editable && (
          <Button onClick={openAdd}>
            <Plus size={15} /> Add vehicle
          </Button>
        )}
      </div>

      {/* Counts */}
      <div className="flex flex-wrap gap-4 text-xs text-status-neutral">
        <span><b className="text-navy">{counts.total}</b> vehicles</span>
        <span><b className="text-status-good">{counts.active}</b> active</span>
        <span><b className="text-status-critical">{counts.unavailable}</b> unavailable</span>
        <span>Showing <b className="text-navy">{rows.length}</b></span>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <Th onClick={() => toggleSort('fleet_no')}>Fleet No</Th>
                <th className="px-4 py-2.5 font-medium">Reg Plate</th>
                <th className="px-4 py-2.5 font-medium">Make / Model</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Year</th>
                <th className="px-4 py-2.5 font-medium">Seats</th>
                <Th onClick={() => toggleSort('status')}>Status</Th>
                {editable && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((v, i) => (
                <tr key={v.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-4 py-2.5 font-semibold text-navy">{v.fleet_no}</td>
                  <td className="px-4 py-2.5 text-navy">{v.reg_plate}</td>
                  <td className="px-4 py-2.5 text-status-neutral">{v.make} {v.model}</td>
                  <td className="px-4 py-2.5 text-status-neutral">{TYPE_LABELS[v.type]}</td>
                  <td className="px-4 py-2.5 text-status-neutral">{v.year ?? '—'}</td>
                  <td className="px-4 py-2.5 text-status-neutral">{v.capacity ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge tone={STATUS_META[v.status].tone}>{STATUS_META[v.status].label}</StatusBadge>
                  </td>
                  {editable && (
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openEdit(v)} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Edit">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => remove(v)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical" title="Delete">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={editable ? 8 : 7} className="px-4 py-12 text-center text-sm text-status-neutral">
                    No vehicles match. {editable && 'Add one or import from Excel to get started.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canToggle && (
        <p className="text-xs text-status-neutral">You are viewing {branchLabel} only — your role is locked to this branch.</p>
      )}

      {/* Modals */}
      <VehicleFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        lockedBranch={canToggle ? null : branch}
        activeBranch={branch}
      />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} defaultBranch={branch} />
    </div>
  )
}

function Th({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <th className="px-4 py-2.5 font-medium">
      <button onClick={onClick} className="inline-flex items-center gap-1 hover:text-brand">
        {children}
        <ChevronsUpDown size={12} className="opacity-60" />
      </button>
    </th>
  )
}
