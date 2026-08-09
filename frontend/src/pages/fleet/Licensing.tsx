import { useMemo, useState } from 'react'
import { Search, Eye, Wrench, ChevronRight, Download, Settings, Plus, Trash2, FileSpreadsheet } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { useDeepLink } from '@/lib/ui/deeplink'
import StatChips from '@/components/ui/StatChips'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import VehicleDocsModal from '@/components/fleet/VehicleDocsModal'
import { useVehicles } from '@/lib/fleet/store'
import type { Vehicle } from '@/lib/fleet/types'
import { useDocuments } from '@/lib/documents/store'
import { docStatus, type DocumentRecord } from '@/lib/documents/types'
import { useLicensingCats, licensingConfigStore, type LicCat } from '@/lib/documents/licensingConfig'
import { exportLicensingXlsx } from '@/lib/fleet/licensingExport'

type VStatus = 'none' | 'noncompliant' | 'expiring' | 'compliant'
type FilterKey = 'all' | VStatus

const STATUS_META: Record<VStatus, { label: string; accent: string; chip: string }> = {
  none: { label: 'No documents', accent: 'border-[#7f1d1d] bg-[#7f1d1d]/[0.07]', chip: 'bg-[#7f1d1d]/15 text-[#7f1d1d]' },
  noncompliant: { label: 'Action needed', accent: 'border-status-critical bg-status-critical/[0.04]', chip: 'bg-status-critical/10 text-status-critical' },
  expiring: { label: 'Expiring soon', accent: 'border-status-warning bg-status-warning/[0.05]', chip: 'bg-status-warning/15 text-[#8a6d10]' },
  compliant: { label: 'Compliant', accent: 'border-status-good bg-status-good/[0.04]', chip: 'bg-status-good/10 text-status-good' },
}

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

export default function Licensing() {
  const { user } = useAuth()
  const role = user!.role
  const editable = canEdit(role, 'fleet')
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[role].canToggleBranch

  const vehicles = useVehicles()
  const docs = useDocuments()
  const cats = useLicensingCats()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  useDeepLink(['filter'], (p) => { const f = p.get('filter'); if (f) setFilter(f as FilterKey) })
  const [picked, setPicked] = useState<Vehicle | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const branchVehicles = useMemo(() => vehicles.filter((v) => v.branch === branch), [vehicles, branch])

  const fleet = useMemo(() => {
    return branchVehicles
      .map((v) => {
        const cells = cats.map((cat) => {
          const cur = docs.find((d) => d.entity_id === v.id && d.category === cat.key && !d.superseded)
          return { cat, state: (cur ? docStatus(cur) : 'missing') as ReturnType<typeof docStatus> | 'missing' }
        })
        const required = cells.filter((c) => c.cat.required)
        const reqPresent = required.filter((c) => c.state !== 'missing')
        const anyPresent = cells.some((c) => c.state !== 'missing')
        // Compliance counts REQUIRED documents; an uploaded optional document
        // that has expired still needs action (it's on file and out of date).
        const anyExpired = cells.some((c) => c.state === 'expired')
        const missingReq = required.some((c) => c.state === 'missing')
        const status: VStatus =
          !anyPresent && required.length > 0 ? 'none'
            : anyExpired || missingReq ? 'noncompliant'
              : cells.some((c) => c.state === 'expiring') ? 'expiring'
                : 'compliant'
        return { v, cells, present: reqPresent.length, reqTotal: required.length, status }
      })
      .sort((a, b) => a.v.fleet_no.localeCompare(b.v.fleet_no))
  }, [branchVehicles, docs, cats])

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

  const requiredShorts = cats.filter((c) => c.required).map((c) => c.short).join(', ')

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="max-w-2xl text-sm text-status-neutral">
            Pick a vehicle to view or upload its documents{requiredShorts ? ` — ${requiredShorts}` : ''}.
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-status-neutral">
            <Wrench size={13} className="text-brand" /> Maintained by Workshop · Operations is alerted to any gaps.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!editable && <span className="inline-flex items-center gap-1.5 rounded-full bg-navy/5 px-3 py-1 text-xs font-medium text-navy"><Eye size={13} /> View only</span>}
          <Button variant="secondary" onClick={() => setExportOpen(true)}><Download size={15} /> Export</Button>
          {editable && <Button variant="secondary" onClick={() => setManageOpen(true)}><Settings size={15} /> Manage</Button>}
        </div>
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
          const missing = f.cells.filter((c) => c.state === 'missing' && c.cat.required).map((c) => c.cat.short)
          const expiringList = f.cells.filter((c) => c.state === 'expiring').map((c) => c.cat.short)
          const expiredList = f.cells.filter((c) => c.state === 'expired').map((c) => c.cat.short)
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
                <span className="text-status-neutral"><b className="text-navy">{f.present}/{f.reqTotal}</b> required on file</span>
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
      <ManageCatsModal open={manageOpen} onClose={() => setManageOpen(false)} />
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} vehicles={branchVehicles} docs={docs} branchLabel={branchLabel} />
    </div>
  )
}

/** Which documents the fleet must carry — required toggles + custom categories. */
function ManageCatsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cats = useLicensingCats()
  const [label, setLabel] = useState('')
  const [short, setShort] = useState('')
  const [confirmDel, setConfirmDel] = useState('')

  function add() {
    if (!label.trim()) return
    licensingConfigStore.addCustom(label, short)
    setLabel(''); setShort('')
  }

  return (
    <Modal open={open} onClose={onClose} title="Manage required documents"
      subtitle="Required documents count toward compliance and raise alerts when missing or expired. Optional ones still appear for upload, and their expiry is tracked once uploaded."
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-2">
        {cats.map((cat) => (
          <div key={cat.key} className="flex items-center gap-3 rounded-xl border border-black/10 bg-white px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-navy">{cat.label}</span>
              {!cat.builtin && <span className="ml-2 rounded-full bg-navy/5 px-2 py-0.5 text-[10px] font-medium text-status-neutral">custom</span>}
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-navy">
              <input type="checkbox" className="h-4 w-4 accent-[#0F1B33]" checked={cat.required}
                onChange={(e) => licensingConfigStore.setRequired(cat.key, e.target.checked)} />
              Required
            </label>
            {!cat.builtin && (
              confirmDel === cat.key ? (
                <button onClick={() => { licensingConfigStore.removeCustom(cat.key); setConfirmDel('') }}
                  className="rounded-md bg-status-critical px-2 py-1 text-[11px] font-semibold text-white">Remove?</button>
              ) : (
                <button onClick={() => setConfirmDel(cat.key)} title="Remove this category (uploaded documents are kept)"
                  className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button>
              )
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-dashed border-navy/20 p-3">
        <div className="mb-2 text-xs font-semibold text-navy">Add a document category</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_150px_auto]">
          <input className={inputCls} placeholder="Name — e.g. Mine Access Permit" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className={inputCls} placeholder="Short name" value={short} onChange={(e) => setShort(e.target.value)} />
          <Button onClick={add} disabled={!label.trim()}><Plus size={15} /> Add</Button>
        </div>
        <p className="mt-2 text-[11px] text-status-neutral">New categories start as required and appear on every vehicle. Removing one hides the column — documents already uploaded are kept.</p>
      </div>
    </Modal>
  )
}

/** Pick which categories go into the expiry spreadsheet. */
function ExportModal({ open, onClose, vehicles, docs, branchLabel }: {
  open: boolean; onClose: () => void; vehicles: Vehicle[]; docs: DocumentRecord[]; branchLabel: string
}) {
  const cats = useLicensingCats()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [seen, setSeen] = useState(false)
  // Default each time the dialog opens: everything required.
  if (open && !seen) { setSeen(true); setSel(new Set(cats.filter((c) => c.required).map((c) => c.key))) }
  if (!open && seen) setSeen(false)

  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const chosen: LicCat[] = cats.filter((c) => sel.has(c.key))

  function doExport() {
    if (chosen.length === 0) return
    exportLicensingXlsx({ vehicles, docs, cats: chosen, branchLabel })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Export licensing expiry"
      subtitle="A spreadsheet of every vehicle with the expiry date, days left and status for each chosen document — one alone, or all of them side by side."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={doExport} disabled={chosen.length === 0}><FileSpreadsheet size={15} /> Export .xlsx</Button>
      </>}>
      <div className="mb-2 flex gap-2 text-xs">
        <button onClick={() => setSel(new Set(cats.map((c) => c.key)))} className="rounded-md border border-black/15 bg-white px-2 py-1 font-medium text-navy hover:border-brand">Everything</button>
        <button onClick={() => setSel(new Set(cats.filter((c) => c.required).map((c) => c.key)))} className="rounded-md border border-black/15 bg-white px-2 py-1 font-medium text-navy hover:border-brand">Required only</button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {cats.map((cat) => (
          <label key={cat.key} className={clsx('flex cursor-pointer items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-sm', sel.has(cat.key) ? 'border-brand bg-brand-tint/25' : 'border-black/10 hover:border-black/25')}>
            <input type="checkbox" className="h-4 w-4 accent-[#0F1B33]" checked={sel.has(cat.key)} onChange={() => toggle(cat.key)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-navy">{cat.label}</span>
              {!cat.required && <span className="text-[10px] text-status-neutral">optional</span>}
            </span>
          </label>
        ))}
      </div>
      <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-[11px] text-status-neutral">
        {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'} in {branchLabel} will be listed, sorted by fleet number.
      </p>
    </Modal>
  )
}
