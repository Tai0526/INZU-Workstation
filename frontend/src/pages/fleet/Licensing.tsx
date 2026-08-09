import { useMemo, useState } from 'react'
import {
  Search, Eye, Wrench, Download, Settings, Plus, Trash2, FileSpreadsheet, ArrowUpDown,
  AlertOctagon, Clock, FileWarning, CalendarCheck, CalendarPlus, ShieldCheck, X, Check,
} from 'lucide-react'
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
import {
  useBookings, bookingsStore, bookingKey, bookingState, autoSchedule, bookingPriority,
  type Booking, type BookingStatus, type BookingState,
} from '@/lib/fleet/inspectionBookings'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const todayIso = () => new Date().toISOString().slice(0, 10)

/** Days-left chip styling — the same colour language as the exported sheet. */
const TONE: Record<CellTone, { chip: string; bar: string }> = {
  valid: { chip: 'bg-status-good/10 text-status-good ring-status-good/20', bar: 'border-status-good' },
  expiring: { chip: 'bg-status-warning/20 text-[#8a6d10] font-semibold ring-status-warning/30', bar: 'border-status-warning' },
  today: { chip: 'bg-status-critical/15 text-status-critical font-bold ring-status-critical/30', bar: 'border-status-critical' },
  expired: { chip: 'bg-status-critical/15 text-status-critical font-bold ring-status-critical/30', bar: 'border-status-critical' },
  missing: { chip: 'bg-[#7f1d1d]/10 text-[#7f1d1d] font-semibold ring-[#7f1d1d]/20', bar: 'border-[#7f1d1d]' },
  quiet: { chip: 'bg-navy/5 text-status-neutral ring-black/5', bar: 'border-black/10' },
  nodate: { chip: 'bg-navy/5 text-status-neutral ring-black/5', bar: 'border-black/10' },
}

const BOOKING_CHIP: Record<Exclude<BookingState, 'none'>, string> = {
  proposed: 'bg-brand/10 text-brand ring-brand/20',
  confirmed: 'bg-status-good/10 text-status-good ring-status-good/20',
  overdue: 'bg-status-critical/10 text-status-critical ring-status-critical/25',
  done: 'bg-navy/5 text-status-neutral ring-black/5',
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}
function dayMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
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
  const bookings = useBookings()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<LicFilter>('all')
  useDeepLink(['filter'], (p) => setFilter(normaliseFilter(p.get('filter'))))
  const [sort, setSort] = useState<'urgency' | 'fleet'>('urgency')
  const [picked, setPicked] = useState<Vehicle | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [bookOpen, setBookOpen] = useState(false)

  const branchVehicles = useMemo(() => vehicles.filter((v) => v.branch === branch), [vehicles, branch])
  const today = todayIso()

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

  // Document-level totals — "how many renewals", not "how many buses" — plus a
  // headline score: the share of required paperwork that is actually in order.
  const health = useMemo(() => {
    let expired = 0, expiring = 0, missing = 0, requiredSlots = 0, ok = 0, booked = 0
    for (const f of fleet) f.row.cells.forEach((c, i) => {
      const isRequired = cats[i]?.required
      if (isRequired) requiredSlots++
      if (c.tone === 'expired') { expired++; return }
      if (c.tone === 'missing') { missing++; return }
      if (c.tone === 'expiring' || c.tone === 'today') expiring++
      if (isRequired) ok++
    })
    for (const f of fleet) for (const c of cats) {
      const b = bookings[bookingKey(f.v.id, c.key)]
      const cellIdx = cats.indexOf(c)
      if (bookingState(b, f.row.cells[cellIdx]?.expiry || undefined, today) !== 'none') booked++
    }
    return { expired, expiring, missing, booked, score: requiredSlots > 0 ? Math.round((ok / requiredSlots) * 100) : 100 }
  }, [fleet, cats, bookings, today])

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
  const scoreTone = health.score >= 95 ? 'good' : health.score >= 80 ? 'warning' : 'critical'

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
        <div className="flex flex-wrap items-center gap-2">
          {!editable && <span className="inline-flex items-center gap-1.5 rounded-full bg-navy/5 px-3 py-1 text-xs font-medium text-navy"><Eye size={13} /> View only</span>}
          {editable && <Button onClick={() => setBookOpen(true)}><CalendarPlus size={15} /> Book inspections</Button>}
          <Button variant="secondary" onClick={() => setExportOpen(true)}><Download size={15} /> Export</Button>
          {editable && <Button variant="secondary" onClick={() => setManageOpen(true)}><Settings size={15} /> Manage</Button>}
        </div>
      </div>

      {/* Health strip: one score, then what needs doing — each tile filters */}
      <div className="card grid gap-px overflow-hidden bg-black/5 sm:grid-cols-2 lg:grid-cols-5">
        <div className="bg-surface p-4 sm:col-span-2">
          <div className="flex items-baseline gap-2">
            <ShieldCheck size={16} className={clsx(scoreTone === 'good' ? 'text-status-good' : scoreTone === 'warning' ? 'text-status-warning' : 'text-status-critical')} />
            <span className="text-xs font-semibold uppercase tracking-wide text-status-neutral">Fleet compliance</span>
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className={clsx('font-display text-3xl font-bold leading-none', scoreTone === 'good' ? 'text-status-good' : scoreTone === 'warning' ? 'text-[#8a6d10]' : 'text-status-critical')}>{health.score}%</span>
            <span className="pb-0.5 text-[11px] text-status-neutral">of required documents valid</span>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-canvas ring-1 ring-inset ring-black/5">
            <div className={clsx('h-full rounded-full transition-[width] duration-500', scoreTone === 'good' ? 'bg-status-good' : scoreTone === 'warning' ? 'bg-status-warning' : 'bg-status-critical')}
              style={{ width: `${health.score}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-status-neutral">{counts.compliant} of {counts.all} vehicles fully in order</p>
        </div>

        <HealthTile icon={AlertOctagon} tone="critical" value={health.expired} label="Expired" hint="already out of date" onClick={() => setFilter('expired')} />
        <HealthTile icon={Clock} tone="warning" value={health.expiring} label={`Due in ${EXPIRING_WINDOW_DAYS} days`} hint="renew before they lapse" onClick={() => setFilter('expiring')} />
        <HealthTile icon={FileWarning} tone="critical" value={health.missing} label="Not on file" hint="required, never uploaded" onClick={() => setFilter('missing')} />
      </div>

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
        {health.booked > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint/50 px-2.5 py-1 text-[11px] font-medium text-navy">
            <CalendarCheck size={12} className="text-brand" /> {health.booked} inspection{health.booked === 1 ? '' : 's'} booked
          </span>
        )}
      </div>

      {/* The grid — the same shape as the exported sheet */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-navy text-white">
                <th className="sticky left-0 z-10 bg-navy px-4 py-3 font-medium">Vehicle</th>
                {cats.map((c, i) => (
                  <th key={c.key} className={clsx('whitespace-nowrap px-4 py-3 text-center font-medium', i > 0 && 'border-l border-white/10')}>
                    <div>{c.label}</div>
                    <div className="text-[10px] font-normal text-white/50">{c.required ? 'required' : 'optional'}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, v, flags }) => (
                <tr key={v.id} onClick={() => setPicked(v)}
                  className="group cursor-pointer border-t border-black/5 transition-colors hover:bg-brand-tint/20">
                  {/* Solid background: this column stays put while the rest scrolls under it. */}
                  <td className={clsx('sticky left-0 z-10 border-l-4 bg-surface px-4 py-2.5 group-hover:bg-brand-tint/20', TONE[worstTone(flags)].bar)}>
                    <div className="font-semibold text-navy">{row.fleet}</div>
                    <div className="text-[11px] text-status-neutral">{row.reg}</div>
                    {flags.noneOnFile && <div className="mt-0.5 text-[10px] font-medium text-[#7f1d1d]">nothing on file</div>}
                  </td>
                  {row.cells.map((cell, ci) => (
                    <DocCell key={cats[ci].key} cell={cell} first={ci === 0}
                      booking={bookings[bookingKey(v.id, cats[ci].key)]} today={today} />
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={cats.length + 1} className="px-4 py-14 text-center">
                  <ShieldCheck size={26} className="mx-auto mb-2 text-status-neutral/50" />
                  <p className="text-sm text-status-neutral">{filter === 'all' ? 'No vehicles match.' : 'Nothing in this group — good news.'}</p>
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
      <BookingModal open={bookOpen} onClose={() => setBookOpen(false)} vehicles={branchVehicles} docs={docs}
        cats={cats} branchLabel={branchLabel} preparedBy={user!.fullName} />
    </div>
  )
}

function HealthTile({ icon: Icon, tone, value, label, hint, onClick }: {
  icon: typeof AlertOctagon; tone: 'critical' | 'warning'; value: number; label: string; hint: string; onClick: () => void
}) {
  const quiet = value === 0
  return (
    <button onClick={onClick} className="bg-surface p-4 text-left transition-colors hover:bg-canvas">
      <div className="flex items-center gap-1.5">
        <Icon size={14} className={clsx(quiet ? 'text-status-neutral/50' : tone === 'critical' ? 'text-status-critical' : 'text-status-warning')} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-status-neutral">{label}</span>
      </div>
      <div className={clsx('mt-1 font-display text-2xl font-bold leading-none', quiet ? 'text-status-neutral/60' : tone === 'critical' ? 'text-status-critical' : 'text-[#8a6d10]')}>{value}</div>
      <div className="mt-0.5 text-[11px] text-status-neutral">{quiet ? 'nothing outstanding' : hint}</div>
    </button>
  )
}

/** One document's days-left chip, its expiry date, and any booking. */
function DocCell({ cell, booking, today, first }: { cell: LicCell; booking?: Booking; today: string; first: boolean }) {
  const tone = TONE[cell.tone]
  const state = bookingState(booking, cell.expiry || undefined, today)
  return (
    <td className={clsx('px-4 py-2.5 text-center align-middle', !first && 'border-l border-black/5')} title={cell.status}>
      <div className="flex flex-col items-center gap-1">
        <span className={clsx('rounded-full px-2 py-0.5 text-[11px] leading-none ring-1 ring-inset', tone.chip)}>
          {cell.tone === 'missing' ? 'missing' : daysChip(cell)}
        </span>
        <span className={clsx('text-[10px]', cell.expiry ? 'text-status-neutral' : 'text-status-neutral/60')}>
          {cell.expiry ? shortDate(cell.expiry) : 'no document'}
        </span>
        {state !== 'none' && (
          <span className={clsx('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none ring-1 ring-inset', BOOKING_CHIP[state])}
            title={`${state === 'done' ? 'Inspected — renewed since' : state === 'overdue' ? 'Booked date has passed' : state === 'confirmed' ? 'Confirmed with FQM' : 'Proposed'} · ${booking!.date}${booking!.note ? ` · ${booking!.note}` : ''}`}>
            <CalendarCheck size={10} /> {dayMonth(booking!.date)}
          </span>
        )}
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

// ── Booking ────────────────────────────────────────────────────────────────
interface Edit { date: string; status: BookingStatus; note: string }

/**
 * Book vehicles in for an inspection and hand the result to the other party.
 * Everything for the arrangement in one place: who is due, the date we propose,
 * whether they have confirmed it, and the sheet to email them.
 */
function BookingModal({ open, onClose, vehicles, docs, cats, branchLabel, preparedBy }: {
  open: boolean; onClose: () => void; vehicles: Vehicle[]; docs: DocumentRecord[]; cats: LicCat[]; branchLabel: string; preparedBy: string
}) {
  const bookings = useBookings()
  const fqm = cats.find((c) => c.key === 'fqm_inspection') ?? cats[0]
  const [catKey, setCatKey] = useState(fqm?.key ?? '')
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [showAll, setShowAll] = useState(false)
  const [bulkDate, setBulkDate] = useState('')
  const [perDay, setPerDay] = useState(4)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [seen, setSeen] = useState(false)
  // Off by default: the sheet is what we are booking. Cancel a vehicle and it
  // leaves the sheet — it does not quietly return as "not yet booked".
  const [includeDue, setIncludeDue] = useState(false)
  const today = todayIso()

  if (open && !seen) { setSeen(true); setCatKey(fqm?.key ?? ''); setEdits({}); setShowAll(false); setBulkDate(''); setSaved(false); setIncludeDue(false) }
  if (!open && seen) setSeen(false)

  const cat = cats.find((c) => c.key === catKey) ?? cats[0]

  // Everyone due for this document, plus anyone already booked, most urgent first.
  const candidates = useMemo(() => {
    if (!cat) return []
    const rows = buildLicensingRows(vehicles, docs, [cat])
    const byFleet = new Map(vehicles.map((v) => [v.fleet_no, v]))
    return rows
      .map((r) => {
        const v = byFleet.get(r.fleet)!
        const cell = r.cells[0]
        const b = bookings[bookingKey(v.id, cat.key)]
        const due = cell.tone === 'expired' || cell.tone === 'today' || cell.tone === 'expiring' || cell.tone === 'missing'
        return { v, cell, booking: b, due, state: bookingState(b, cell.expiry || undefined, today) }
      })
      .filter((x) => showAll || x.due || x.booking)
      // Same order the auto-scheduler works in: about to lapse (a deadline we
      // can still beat) → already expired → never uploaded → still valid.
      .sort((a, b) =>
        bookingPriority(a.cell.tone) - bookingPriority(b.cell.tone)
        || (a.cell.days ?? 9999) - (b.cell.days ?? 9999)
        || a.v.fleet_no.localeCompare(b.v.fleet_no, undefined, { numeric: true }))
  }, [vehicles, docs, cat, bookings, showAll, today])

  const valueFor = (vid: string): Edit => {
    const e = edits[vid]
    if (e) return e
    const b = bookings[bookingKey(vid, cat?.key ?? '')]
    return { date: b?.date ?? '', status: b?.status ?? 'proposed', note: b?.note ?? '' }
  }
  const patch = (vid: string, p: Partial<Edit>) => setEdits((s) => ({ ...s, [vid]: { ...valueFor(vid), ...p } }))

  /**
   * Fill every date by deadline, not by list position: each vehicle gets the
   * working day before its document lapses (earlier if that day is full), and
   * anything already expired or missing takes the earliest free day.
   */
  function autoFill() {
    if (!bulkDate) return
    const plan = autoSchedule(
      candidates.map((c) => ({ id: c.v.id, expiry: c.cell.expiry, tone: c.cell.tone, days: c.cell.days })),
      { start: bulkDate, perDay },
    )
    const next: Record<string, Edit> = { ...edits }
    for (const [vid, date] of Object.entries(plan)) next[vid] = { ...valueFor(vid), date }
    setEdits(next)
  }
  function setAll() {
    if (!bulkDate) return
    const next: Record<string, Edit> = { ...edits }
    for (const c of candidates) next[c.v.id] = { ...valueFor(c.v.id), date: bulkDate }
    setEdits(next)
  }

  const dirty = Object.keys(edits).length > 0
  const bookedCount = candidates.filter((c) => valueFor(c.v.id).date).length

  function save() {
    if (!cat) return
    bookingsStore.setMany(Object.entries(edits).map(([vehicleId, e]) => ({ vehicleId, cat: cat.key, date: e.date, status: e.status, note: e.note })))
    setEdits({})
    setSaved(true)
  }

  async function exportSheet(mode: 'with-expiry' | 'schedule-only') {
    if (!cat || busy) return
    setBusy(true)
    try {
      const { exportBookingXlsx } = await import('@/lib/fleet/licensingExport')
      await exportBookingXlsx({ vehicles, docs, cat, bookings, branchLabel, mode, includeUnbooked: includeDue, preparedBy })
    } finally { setBusy(false) }
  }

  // What the sheet will actually contain, from what is SAVED (not the unsaved
  // edits) — the export reads the store, so this must too.
  const exportCount = useMemo(() => {
    if (!cat) return 0
    const bookedIds = new Set(Object.keys(bookings).filter((k) => k.endsWith(`:${cat.key}`)).map((k) => k.slice(0, -(cat.key.length + 1))))
    const dueUnbooked = includeDue ? candidates.filter((c) => c.due && !bookedIds.has(c.v.id)).length : 0
    return candidates.filter((c) => bookedIds.has(c.v.id)).length + dueUnbooked
  }, [bookings, cat, candidates, includeDue])

  if (!cat) return null

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Book inspections"
      subtitle="Set the dates you intend to present each vehicle, then export the sheet to send to the inspecting department so both sides work to the same plan."
      footer={<>
        <span className="mr-auto text-xs text-status-neutral">
          {bookedCount} of {candidates.length} listed vehicle{candidates.length === 1 ? '' : 's'} have a date{dirty ? ' · unsaved changes' : ''}
        </span>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button onClick={save} disabled={!dirty}><Check size={15} /> Save dates</Button>
      </>}>
      <div className="space-y-4">
        {/* Which document */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-status-neutral">Document</span>
          {cats.map((c) => (
            <button key={c.key} onClick={() => { setCatKey(c.key); setEdits({}) }}
              className={clsx('rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                c.key === cat.key ? 'border-brand bg-brand-tint/50 text-navy' : 'border-black/10 bg-white text-status-neutral hover:bg-canvas')}>
              {c.short}
            </button>
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-status-neutral">
            <input type="checkbox" className="h-3.5 w-3.5 accent-[#0F1B33]" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show every vehicle
          </label>
        </div>

        {/* Bulk fill */}
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-navy/20 bg-canvas/40 p-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-navy">Start date</span>
            <input type="date" className="rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-brand" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-navy">Per day</span>
            <input type="number" min={1} className="w-20 rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-brand" value={perDay} onChange={(e) => setPerDay(Number(e.target.value) || 1)} />
          </label>
          <Button onClick={autoFill} disabled={!bulkDate}><CalendarCheck size={15} /> Auto-schedule</Button>
          <Button variant="secondary" onClick={setAll} disabled={!bulkDate}>Set all to this date</Button>
          <p className="w-full text-[11px] leading-relaxed text-status-neutral">
            Auto-schedule books each vehicle the working day <b className="text-navy">before its document expires</b> — so nothing lapses — moving earlier when a day is full ({perDay} a day, weekends skipped).
            Anything already expired or never uploaded has no deadline left to protect, so it takes the earliest free day. Every date stays editable below.
          </p>
        </div>

        {/* The list */}
        <div className="max-h-[46vh] overflow-y-auto rounded-xl border border-black/10">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-canvas text-status-neutral">
              <tr>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Current {cat.short}</th>
                <th className="px-3 py-2 font-medium">Inspect on</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Note</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {candidates.map(({ v, cell, state }) => {
                const e = valueFor(v.id)
                return (
                  <tr key={v.id} className="border-t border-black/5">
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-navy">{v.fleet_no}</div>
                      <div className="text-[10px] text-status-neutral">{v.reg_plate}</div>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={clsx('rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset', TONE[cell.tone].chip)}>
                        {cell.tone === 'missing' ? 'missing' : daysChip(cell)}
                      </span>
                      <span className="ml-1.5 text-[10px] text-status-neutral">{cell.expiry ? shortDate(cell.expiry) : ''}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="date" value={e.date} onChange={(ev) => patch(v.id, { date: ev.target.value })}
                        className={clsx('rounded-md border px-2 py-1 text-xs outline-none focus:border-brand', e.date ? 'border-brand/40 bg-brand-tint/20 font-medium text-navy' : 'border-black/15 bg-white text-status-neutral')} />
                    </td>
                    <td className="px-3 py-1.5">
                      <select value={e.status} onChange={(ev) => patch(v.id, { status: ev.target.value as BookingStatus })} disabled={!e.date}
                        className="rounded-md border border-black/15 bg-white px-2 py-1 text-xs text-navy outline-none focus:border-brand disabled:opacity-50">
                        <option value="proposed">Proposed</option>
                        <option value="confirmed">Confirmed</option>
                      </select>
                      {state === 'done' && <span className="ml-1 text-[10px] text-status-good">renewed</span>}
                      {state === 'overdue' && <span className="ml-1 text-[10px] text-status-critical">date passed</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={e.note} onChange={(ev) => patch(v.id, { note: ev.target.value })} placeholder="optional"
                        className="w-full min-w-[120px] rounded-md border border-black/15 bg-white px-2 py-1 text-xs text-navy outline-none focus:border-brand" />
                    </td>
                    <td className="px-2 py-1.5">
                      {e.date && (
                        <button onClick={() => patch(v.id, { date: '', note: '' })}
                          title="Cancel this booking — once saved, the vehicle leaves the sheet"
                          className="rounded-md p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><X size={13} /></button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {candidates.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-status-neutral">
                  Nothing due for {cat.label} — tick “Show every vehicle” to book ahead anyway.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Send it */}
        <div className="rounded-xl border border-black/10 bg-canvas/50 p-3">
          <div className="mb-1 text-xs font-semibold text-navy">Send to the inspecting department</div>
          <p className="mb-2.5 text-[11px] leading-relaxed text-status-neutral">
            {dirty && <span className="font-medium text-[#8a6d10]">Save your dates first — the sheet exports what is saved. </span>}
            Only vehicles with a booked date are sent. Clear a date above and that vehicle leaves the sheet.
          </p>

          <label className="mb-2.5 flex cursor-pointer items-start gap-2 rounded-lg border border-black/10 bg-white px-3 py-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#0F1B33]" checked={includeDue} onChange={(e) => setIncludeDue(e.target.checked)} />
            <span className="text-[11px] leading-relaxed text-navy">
              <b>Also list vehicles falling due that aren't booked yet</b>
              <span className="block text-status-neutral">Marked “Not yet booked”, so they can see what is coming. Leave off to send only what you are committing to.</span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => exportSheet('with-expiry')} disabled={busy || exportCount === 0}>
              <FileSpreadsheet size={15} /> {busy ? 'Building…' : 'Export with expiry dates'}
            </Button>
            <Button variant="secondary" onClick={() => exportSheet('schedule-only')} disabled={busy || exportCount === 0}>
              <FileSpreadsheet size={15} /> Export schedule only
            </Button>
            <span className={clsx('text-[11px]', exportCount === 0 ? 'text-status-critical' : 'text-status-neutral')}>
              {exportCount === 0 ? 'Nothing booked to send yet.' : `${exportCount} vehicle${exportCount === 1 ? '' : 's'} in the sheet`}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-status-neutral">
            <b className="text-navy">With expiry dates</b> shows each vehicle's current expiry beside the date we propose, so both sides align. <b className="text-navy">Schedule only</b> lists just the dates.
          </p>
          {saved && <p className="mt-2 text-[11px] text-status-good">Dates saved — they now show on the licensing grid and in the export.</p>}
        </div>
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
