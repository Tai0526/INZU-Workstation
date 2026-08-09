import { useMemo, useState } from 'react'
import { Search, Eye, Wrench, Download, Settings, Plus, Trash2, FileSpreadsheet, ArrowUpDown, AlertTriangle } from 'lucide-react'
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
import type { DocumentRecord } from '@/lib/documents/types'
import { useLicensingCats, licensingConfigStore, type LicCat } from '@/lib/documents/licensingConfig'
import {
  rowFlags, matchesFilter, normaliseFilter, daysChip, buildLicensingRows,
  EXPIRING_WINDOW_DAYS, type CellTone, type LicCell, type LicFilter, type LicFlags,
} from '@/lib/fleet/licensingStatus'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

/** Days-left chip styling — the same colour language as the exported sheet. */
const TONE: Record<CellTone, { chip: string; bar: string }> = {
  valid: { chip: 'bg-status-good/10 text-status-good', bar: 'border-status-good' },
  expiring: { chip: 'bg-status-warning/20 text-[#8a6d10] font-semibold', bar: 'border-status-warning' },
  today: { chip: 'bg-status-critical/15 text-status-critical font-bold', bar: 'border-status-critical' },
  expired: { chip: 'bg-status-critical/15 text-status-critical font-bold', bar: 'border-status-critical' },
  missing: { chip: 'bg-[#7f1d1d]/10 text-[#7f1d1d] font-semibold', bar: 'border-[#7f1d1d]' },
  quiet: { chip: 'bg-navy/5 text-status-neutral', bar: 'border-black/10' },
  nodate: { chip: 'bg-navy/5 text-status-neutral', bar: 'border-black/10' },
}

/** Short date for the grid — "15 Aug 26". */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en', { day: '2-digit', month: 'short', year: '2-digit' })
}

/** The worst state on a row — drives its left accent bar. */
function worstTone(f: LicFlags): CellTone {
  if (f.expired) return 'expired'
  if (f.missing) return 'missing'
  if (f.expiring) return 'expiring'
  return 'valid'
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
  const cats = useLicensingCats()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<LicFilter>('all')
  useDeepLink(['filter'], (p) => setFilter(normaliseFilter(p.get('filter'))))
  const [sort, setSort] = useState<'urgency' | 'fleet'>('urgency')
  const [picked, setPicked] = useState<Vehicle | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const branchVehicles = useMemo(() => vehicles.filter((v) => v.branch === branch), [vehicles, branch])

  // One pass, shared with the exported sheet (lib/fleet/licensingStatus).
  const fleet = useMemo(() => {
    const byFleet = new Map(branchVehicles.map((v) => [v.fleet_no, v]))
    return buildLicensingRows(branchVehicles, docs, cats).map((r) => ({
      row: r,
      v: byFleet.get(r.fleet)!,
      flags: rowFlags(r.cells),
    }))
  }, [branchVehicles, docs, cats])

  // Counts OVERLAP by design: a bus with an expired licence and a missing
  // certificate is counted under both, because both need chasing.
  const counts = useMemo(() => ({
    all: fleet.length,
    compliant: fleet.filter((f) => f.flags.compliant).length,
    expiring: fleet.filter((f) => f.flags.expiring).length,
    expired: fleet.filter((f) => f.flags.expired).length,
    missing: fleet.filter((f) => f.flags.missing).length,
  }), [fleet])

  // Document-level totals — "how many renewals", not "how many buses".
  const docCounts = useMemo(() => {
    let expired = 0, expiring = 0, missing = 0
    for (const f of fleet) for (const c of f.row.cells) {
      if (c.tone === 'expired') expired++
      else if (c.tone === 'expiring' || c.tone === 'today') expiring++
      else if (c.tone === 'missing') missing++
    }
    return { expired, expiring, missing }
  }, [fleet])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = fleet
      .filter((f) => !term || [f.row.fleet, f.row.reg].some((x) => x.toLowerCase().includes(term)))
      .filter((f) => matchesFilter(f.flags, filter))
    return sort === 'fleet'
      ? [...list].sort((a, b) => a.row.fleet.localeCompare(b.row.fleet, undefined, { numeric: true }))
      : [...list].sort((a, b) => a.flags.urgency - b.flags.urgency || a.row.fleet.localeCompare(b.row.fleet, undefined, { numeric: true }))
  }, [fleet, q, filter, sort])

  const requiredShorts = cats.filter((c) => c.required).map((c) => c.short).join(', ')

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="max-w-2xl text-sm text-status-neutral">
            Every vehicle's documents with the days left before each one expires{requiredShorts ? ` — ${requiredShorts}` : ''}. Click a row to view or upload.
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

      {/* What needs doing, in documents rather than vehicles */}
      {(docCounts.expired > 0 || docCounts.expiring > 0 || docCounts.missing > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-status-warning/40 bg-status-warning/10 px-4 py-2.5 text-sm text-navy">
          <AlertTriangle size={16} className="shrink-0 text-[#8a6d10]" />
          {docCounts.expired > 0 && <span><b className="text-status-critical">{docCounts.expired}</b> document{docCounts.expired === 1 ? '' : 's'} expired</span>}
          {docCounts.expiring > 0 && <span><b className="text-[#8a6d10]">{docCounts.expiring}</b> expiring within {EXPIRING_WINDOW_DAYS} days</span>}
          {docCounts.missing > 0 && <span><b className="text-[#7f1d1d]">{docCounts.missing}</b> required document{docCounts.missing === 1 ? '' : 's'} not on file</span>}
        </div>
      )}

      {/* Filters — a vehicle can appear under more than one */}
      <StatChips
        active={filter}
        onPick={(v) => setFilter(v as LicFilter)}
        stats={[
          { value: 'all', label: 'All vehicles', count: counts.all, tone: 'neutral' },
          { value: 'compliant', label: 'Compliant', count: counts.compliant, tone: 'good' },
          { value: 'expiring', label: 'Expiring soon', count: counts.expiring, tone: 'warning' },
          { value: 'expired', label: 'Expired', count: counts.expired, tone: 'critical' },
          { value: 'missing', label: 'Missing documents', count: counts.missing, tone: 'critical' },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fleet no or plate…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <button onClick={() => setSort((s) => (s === 'urgency' ? 'fleet' : 'urgency'))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-navy hover:border-brand"
          title="Switch between most-urgent-first and fleet order">
          <ArrowUpDown size={14} className="text-status-neutral" /> {sort === 'urgency' ? 'Most urgent first' : 'Fleet order'}
        </button>
        <span className="text-xs text-status-neutral">Showing {rows.length} of {fleet.length}</span>
      </div>

      {/* The grid — the same shape as the exported sheet */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="sticky left-0 z-10 bg-navy px-4 py-2.5 font-medium">Vehicle</th>
                {cats.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-4 py-2.5 text-center font-medium">
                    {c.label}
                    {!c.required && <span className="ml-1 text-[10px] font-normal text-white/55">optional</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, v, flags }) => (
                <tr key={v.id} onClick={() => setPicked(v)}
                  className="group cursor-pointer border-t border-black/5 hover:bg-canvas">
                  {/* Solid background: this column stays put while the rest scrolls under it. */}
                  <td className={clsx('sticky left-0 z-10 border-l-4 bg-surface px-4 py-2 group-hover:bg-canvas', TONE[worstTone(flags)].bar)}>
                    <div className="font-semibold text-navy">{row.fleet}</div>
                    <div className="text-[11px] text-status-neutral">{row.reg}</div>
                    {flags.noneOnFile && <div className="text-[10px] font-medium text-[#7f1d1d]">nothing on file</div>}
                  </td>
                  {row.cells.map((cell, ci) => <DocCell key={cats[ci].key} cell={cell} />)}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={cats.length + 1} className="px-4 py-12 text-center text-sm text-status-neutral">
                  {filter === 'all' ? 'No vehicles match.' : 'Nothing in this group — good news.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only — your role is locked to this branch.</p>}

      <VehicleDocsModal vehicle={picked} open={!!picked} onClose={() => setPicked(null)} canEdit={editable} />
      <ManageCatsModal open={manageOpen} onClose={() => setManageOpen(false)} />
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} vehicles={branchVehicles} docs={docs}
        branchLabel={branchLabel} pageFilter={filter} />
    </div>
  )
}

/** One document's expiry date + days-left chip. */
function DocCell({ cell }: { cell: LicCell }) {
  const tone = TONE[cell.tone]
  return (
    <td className="px-4 py-2 text-center" title={cell.status}>
      <div className="flex items-center justify-center gap-1.5">
        <span className={clsx('text-xs', cell.expiry ? 'text-navy' : 'text-status-neutral')}>{cell.expiry ? shortDate(cell.expiry) : '—'}</span>
        <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px] leading-none', tone.chip)}>
          {cell.tone === 'missing' ? 'missing' : daysChip(cell)}
        </span>
      </div>
    </td>
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

const SCOPES: { key: LicFilter; label: string; hint: string }[] = [
  { key: 'all', label: 'Whole fleet', hint: 'Every vehicle, whatever its state' },
  { key: 'expired', label: 'Expired only', hint: 'Vehicles with a document already out of date' },
  { key: 'expiring', label: 'Expiring soon', hint: `Anything due within ${EXPIRING_WINDOW_DAYS} days` },
  { key: 'missing', label: 'Missing documents', hint: 'A required document never uploaded' },
]

/** Pick which categories, and how much of the fleet, goes into the sheet. */
function ExportModal({ open, onClose, vehicles, docs, branchLabel, pageFilter }: {
  open: boolean; onClose: () => void; vehicles: Vehicle[]; docs: DocumentRecord[]; branchLabel: string; pageFilter: LicFilter
}) {
  const cats = useLicensingCats()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<LicFilter>('all')
  const [busy, setBusy] = useState(false)
  const [seen, setSeen] = useState(false)
  // Each time it opens: every required category, and the scope the user is
  // already looking at (so "filter to Expired, hit Export" does what it says).
  if (open && !seen) {
    setSeen(true)
    setSel(new Set(cats.filter((c) => c.required).map((c) => c.key)))
    setScope(SCOPES.some((s) => s.key === pageFilter) ? pageFilter : 'all')
  }
  if (!open && seen) setSeen(false)

  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const chosen: LicCat[] = cats.filter((c) => sel.has(c.key))

  // Live count of what the chosen scope will actually list.
  const willList = useMemo(() => {
    if (chosen.length === 0) return 0
    const rows = buildLicensingRows(vehicles, docs, chosen)
    return scope === 'all' ? rows.length : rows.filter((r) => matchesFilter(rowFlags(r.cells), scope)).length
  }, [vehicles, docs, chosen, scope])

  async function doExport() {
    if (chosen.length === 0 || busy) return
    setBusy(true)
    try {
      // Loaded on demand: the spreadsheet engine is large and only needed here.
      const { exportLicensingXlsx } = await import('@/lib/fleet/licensingExport')
      await exportLicensingXlsx({ vehicles, docs, cats: chosen, branchLabel, scope })
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Export licensing expiry"
      subtitle="A spreadsheet of each chosen document's expiry date, days left and status — the whole fleet, or only what needs action."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={doExport} disabled={chosen.length === 0 || willList === 0 || busy}>
          <FileSpreadsheet size={15} /> {busy ? 'Building…' : 'Export .xlsx'}
        </Button>
      </>}>
      <div className="space-y-4">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">Which vehicles</h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SCOPES.map((s) => (
              <button key={s.key} onClick={() => setScope(s.key)}
                className={clsx('rounded-xl border-2 px-3 py-2 text-left transition-colors', scope === s.key ? 'border-brand bg-brand-tint/30' : 'border-black/10 hover:border-black/25')}>
                <div className="text-sm font-medium text-navy">{s.label}</div>
                <div className="text-[11px] leading-snug text-status-neutral">{s.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-status-neutral">Which documents</h4>
            <div className="ml-auto flex gap-2 text-xs">
              <button onClick={() => setSel(new Set(cats.map((c) => c.key)))} className="rounded-md border border-black/15 bg-white px-2 py-1 font-medium text-navy hover:border-brand">Everything</button>
              <button onClick={() => setSel(new Set(cats.filter((c) => c.required).map((c) => c.key)))} className="rounded-md border border-black/15 bg-white px-2 py-1 font-medium text-navy hover:border-brand">Required only</button>
            </div>
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
        </div>

        <p className={clsx('rounded-lg px-3 py-2 text-[11px]', willList === 0 ? 'bg-status-critical/5 text-status-critical' : 'bg-canvas text-status-neutral')}>
          {chosen.length === 0 ? 'Choose at least one document to export.'
            : willList === 0 ? `No ${branchLabel} vehicle matches “${SCOPES.find((s) => s.key === scope)!.label}” for the chosen documents — nothing to export, which is good news.`
              : `${willList} of ${vehicles.length} ${branchLabel} vehicle${vehicles.length === 1 ? '' : 's'} will be listed, sorted by fleet number.`}
        </p>
      </div>
    </Modal>
  )
}
