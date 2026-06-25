import { Fragment, useMemo, useState } from 'react'
import { Plus, Upload, Download, Trash2, Pencil, Fuel as FuelIcon, Gauge, Settings, PackagePlus, CheckCircle2, AlertTriangle, UploadCloud, FileText, FileType, ChevronDown, Search, Paperclip, Zap, Users, Check, X } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import KpiCard from '@/components/ui/KpiCard'
import StatusBadge from '@/components/ui/StatusBadge'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useVehicles } from '@/lib/fleet/store'
import { useDrivers } from '@/lib/drivers/store'
import { useMileageRoutes } from '@/lib/mileage/store'
import { useEmployees } from '@/lib/hr/store'
import { FUEL_ATTENDANT_ROLE } from '@/lib/hr/types'
import {
  useIssuances, useReceipts, useGenFuel, useFuelConfig, setFuelConfig, useFuelRate, setFuelRate, fetchLiveUsdZmw, recordRefuel, editIssuance, authorizeDraw, issuancesStore, receiptsStore, genFuelStore,
} from '@/lib/fuel/store'
import { putFile, viewFile } from '@/lib/storage/fileStore'
import {
  type FuelIssuance, type IssuanceInput, type FuelConfig, type FuelRate, type FuelReceipt, type GenFuel, type DrawKind, type Currency, FUEL_LEVELS, DRAW_LABEL, isApprovedDraw, isOpen, kmMoved, kmPerLitre,
  computeStock, summariseByVehicle, pricePerLitre, money,
} from '@/lib/fuel/types'
import { parseIssuances, downloadIssuanceTemplate, exportIssuances, exportReceipts, type IssuanceImport } from '@/lib/fuel/excel'
import { exportReportPDF, exportReportWord, esc, type ReportInput } from '@/lib/reports/exporter'

// Monthly fuel report (PDF + editable Word) for management reporting.
function fuelReport(opts: { branchLabel: string; monthLbl: string; cur: Currency; rate: FuelRate; vehicleLitres: number; km: number; price: number; perVehicle: ReturnType<typeof summariseByVehicle>; draws: GenFuel[] }): ReportInput {
  const { branchLabel, monthLbl, cur, rate, vehicleLitres, km, price, perVehicle, draws } = opts
  const drawLitres = draws.reduce((s, g) => s + g.litres, 0)
  const totalLitres = vehicleLitres + drawLitres
  const totalCost = totalLitres * price
  const econ = vehicleLitres > 0 ? km / vehicleLitres : 0
  const rateLine = `<div class="kv"><span><b>Diesel (ERB):</b> K${rate.diesel_zmw.toFixed(2)}/L</span><span><b>USD→ZMW (BoZ):</b> K${rate.fx_zmw_per_usd.toFixed(2)}</span><span><b>Source:</b> ${esc(rate.source)}</span></div>`
  const summary = `<h2>Summary</h2><table><tbody>
    <tr><td>Vehicle fuel used</td><td class="num">${vehicleLitres.toLocaleString()} L</td></tr>
    <tr><td>Non-vehicle fuel (generator / visitor)</td><td class="num">${drawLitres.toLocaleString()} L</td></tr>
    <tr><td>Total fuel used</td><td class="num">${totalLitres.toLocaleString()} L</td></tr>
    <tr><td>Total distance moved (vehicles)</td><td class="num">${km.toLocaleString()} km</td></tr>
    <tr><td>Average economy</td><td class="num">${econ.toFixed(2)} km/L</td></tr>
    <tr><td>Price per litre</td><td class="num">${esc(money(price, cur))}</td></tr>
    <tr class="tot"><td>Total fuel cost</td><td class="num">${esc(money(totalCost, cur))}</td></tr>
  </tbody></table>`
  const rows = perVehicle.map((v, i) => `<tr><td class="num">${i + 1}</td><td>${esc(v.vehicle_reg)}</td><td>${esc(v.fleet_no)}</td><td class="num">${v.litres.toLocaleString()}</td><td class="num">${v.km.toLocaleString()}</td><td class="num">${v.kmPerL != null ? v.kmPerL.toFixed(2) : '—'}</td><td class="num">${esc(money(v.litres * price, cur))}</td></tr>`).join('')
  const totVehKm = perVehicle.reduce((s, v) => s + v.km, 0)
  const tbl = `<h2>Consumption by vehicle</h2><table><thead><tr><th class="num">#</th><th>Vehicle Reg</th><th>Fleet #</th><th class="num">Litres</th><th class="num">KM</th><th class="num">Avg km/L</th><th class="num">Cost</th></tr></thead><tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#6B7280">No issuances</td></tr>'}<tr class="tot"><td colspan="3">Total</td><td class="num">${vehicleLitres.toLocaleString()}</td><td class="num">${totVehKm.toLocaleString()}</td><td></td><td class="num">${esc(money(vehicleLitres * price, cur))}</td></tr></tbody></table>`
  const drawRows = draws.map((g) => `<tr><td>${esc(g.date)}</td><td>${esc(DRAW_LABEL[g.kind])}</td><td>${esc(g.recipient)}${g.vehicle_reg ? ` (${esc(g.vehicle_reg)})` : ''}</td><td class="num">${g.litres.toLocaleString()}</td><td class="num">${esc(money(g.litres * price, cur))}</td></tr>`).join('')
  const drawTbl = draws.length ? `<h2>Non-vehicle fuel (generator &amp; visitor)</h2><table><thead><tr><th>Date</th><th>Type</th><th>Recipient</th><th class="num">Litres</th><th class="num">Cost</th></tr></thead><tbody>${drawRows}<tr class="tot"><td colspan="3">Total</td><td class="num">${drawLitres.toLocaleString()}</td><td class="num">${esc(money(drawLitres * price, cur))}</td></tr></tbody></table>` : ''
  return {
    title: `Monthly Fuel Report — ${branchLabel}`,
    subtitle: `${monthLbl} · all amounts in ${cur}`,
    body: rateLine + summary + tbl + drawTbl,
    landscape: false,
    filenameBase: `Fuel Report - ${branchLabel} - ${monthLbl}`,
  }
}

const cellCls = 'w-full rounded-md border border-black/15 bg-white px-2 py-1 text-xs text-navy outline-none focus:border-brand'
const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const monthKey = (d: string) => d.slice(0, 7)
const monthLabel = (k: string) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short', year: 'numeric' }) }

type Tab = 'issuances' | 'stock' | 'deliveries' | 'summary'

export default function Fuel() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'operations')
  const canAuthorize = role === 'operations_manager' || role === 'asst_operations_manager'

  const issuances = useIssuances().filter((i) => i.branch === branch)
  const receipts = useReceipts().filter((r) => r.branch === branch)
  const genFuel = useGenFuel().filter((g) => g.branch === branch)
  const cfg = useFuelConfig(branch)
  const vehicles = useVehicles().filter((v) => v.branch === branch)
  const drivers = useDrivers().filter((d) => d.branch === branch && d.status === 'active')
  const routes = useMileageRoutes().filter((r) => r.branch === branch)
  const attendants = useEmployees().filter((e) => e.branch === branch && e.status === 'active' && e.job_role === FUEL_ATTENDANT_ROLE)

  const [tab, setTab] = useState<Tab>('issuances')

  return (
    <div className="page space-y-5">
      <p className="max-w-2xl text-sm text-status-neutral">
        Fuel issued per trip, depot stock with a days-left estimate, and a costed monthly summary for {branchLabel}.
      </p>

      <div className="flex gap-1 border-b border-black/10">
        {([['issuances', 'Issuances'], ['stock', 'Stock'], ['deliveries', 'Deliveries'], ['summary', 'Summary']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={clsx('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === k ? 'border-brand text-navy' : 'border-transparent text-status-neutral hover:text-navy')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'issuances' && <IssuancesTab issuances={issuances} genFuel={genFuel} branch={branch} branchLabel={branchLabel} vehicles={vehicles} drivers={drivers} routes={routes} attendants={attendants} canManage={canManage} canAuthorize={canAuthorize} />}
      {tab === 'stock' && <StockTab issuances={issuances} receipts={receipts} genFuel={genFuel} cfg={cfg} branch={branch} canManage={canManage} />}
      {tab === 'deliveries' && <DeliveriesTab receipts={receipts} branch={branch} branchLabel={branchLabel} canManage={canManage} />}
      {tab === 'summary' && <SummaryTab issuances={issuances} genFuel={genFuel} branch={branch} canManage={canManage} />}

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
    </div>
  )
}

// ── Issuances tab ──────────────────────────────────────────────────────
function IssuancesTab({ issuances, genFuel, branch, branchLabel, vehicles, drivers, routes, attendants, canManage, canAuthorize }: { issuances: FuelIssuance[]; genFuel: GenFuel[]; branch: BranchCode; branchLabel: string; vehicles: any[]; drivers: any[]; routes: any[]; attendants: any[]; canManage: boolean; canAuthorize: boolean }) {
  const [vehicleFilter, setVehicleFilter] = useState('all')
  const [quickOpen, setQuickOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editing, setEditing] = useState<FuelIssuance | null>(null)
  const [genModal, setGenModal] = useState<{ open: boolean; editing: GenFuel | null; kind: DrawKind }>({ open: false, editing: null, kind: 'generator' })
  const onEdit = (i: FuelIssuance) => setEditing(i)
  const genRows = useMemo(() => [...genFuel].sort((a, b) => b.date.localeCompare(a.date)), [genFuel])
  const drawTone = (s: GenFuel['status']) => (s === 'approved' ? 'good' : s === 'pending' ? 'warning' : 'critical')
  const drawLabel = (s: GenFuel['status']) => (s === 'approved' ? 'Approved' : s === 'pending' ? 'Pending auth' : 'Rejected')

  const rows = useMemo(
    () => issuances.filter((i) => vehicleFilter === 'all' || i.fleet_no === vehicleFilter).sort((a, b) => b.date.localeCompare(a.date) || a.fleet_no.localeCompare(b.fleet_no)),
    [issuances, vehicleFilter],
  )
  const fleets = [...new Set(issuances.map((i) => i.fleet_no))].sort()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All vehicles</option>
          {fleets.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => exportIssuances(rows, branchLabel)}><Download size={15} /> Export</Button>
          {canManage && <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Bulk upload</Button>}
          {canManage && <Button variant="secondary" onClick={() => setGenModal({ open: true, editing: null, kind: 'generator' })}><Zap size={15} /> Generator fuel</Button>}
          {canManage && <Button variant="secondary" onClick={() => setGenModal({ open: true, editing: null, kind: 'visitor' })}><Users size={15} /> Authorised vehicle</Button>}
          {canManage && <Button variant="secondary" onClick={() => setAddOpen(true)}><Plus size={15} /> Bulk refuels</Button>}
          {canManage && <Button onClick={() => setQuickOpen(true)}><FuelIcon size={15} /> Refuel</Button>}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-3 py-2.5 font-medium">Date</th><th className="px-3 py-2.5 font-medium">Fleet</th>
                <th className="px-3 py-2.5 font-medium">Trips</th><th className="px-3 py-2.5 font-medium">Route</th>
                <th className="px-3 py-2.5 font-medium">Driver</th><th className="px-3 py-2.5 font-medium">Level before</th>
                <th className="px-3 py-2.5 font-medium">Level after</th><th className="px-3 py-2.5 font-medium">Open mile</th>
                <th className="px-3 py-2.5 font-medium">Close mile</th><th className="px-3 py-2.5 font-medium">Litres</th>
                <th className="px-3 py-2.5 font-medium">KM moved</th><th className="px-3 py-2.5 font-medium">KM/L</th>
                {canManage && <th className="px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((i, idx) => {
                const open = isOpen(i)
                return (
                  <tr key={i.id} className={idx % 2 ? 'bg-canvas/40' : ''}>
                    <td className="px-3 py-2 text-navy">
                      <div className="flex items-center gap-1.5">
                        {i.date}
                        {i.edited_at && <span title={`Edited by ${i.edited_by} on ${new Date(i.edited_at).toLocaleString()}`} className="rounded-full bg-status-warning/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#8a6d10]">edited</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium text-navy">{i.fleet_no}</td>
                    <td className="px-3 py-2 text-status-neutral">{i.trip_number ?? '—'}</td>
                    <td className="px-3 py-2 text-navy">{i.route}</td>
                    <td className="px-3 py-2 text-status-neutral">{i.driver}</td>
                    <td className="px-3 py-2 text-status-neutral">{i.opening_fuel_level || '—'}</td>
                    <td className="px-3 py-2 text-status-neutral">{i.closing_fuel_level || '—'}</td>
                    <td className="px-3 py-2 text-status-neutral">{i.opening_mileage.toLocaleString()}</td>
                    <td className="px-3 py-2 text-status-neutral">{open ? <span className="text-[#8a6d10]">open</span> : i.closing_mileage.toLocaleString()}</td>
                    <td className="px-3 py-2 text-navy">{i.liters_given}</td>
                    <td className="px-3 py-2 text-status-neutral">{open ? '—' : kmMoved(i)}</td>
                    <td className="px-3 py-2 font-medium text-navy">{kmPerLitre(i)?.toFixed(2) ?? (open ? '—' : '—')}</td>
                    {canManage && (
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => onEdit(i)} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => confirm('Remove this issuance?') && issuancesStore.remove(i.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={canManage ? 13 : 12} className="px-4 py-12 text-center text-sm text-status-neutral">No fuel issuances. {canManage && 'Record a refuel or bulk-upload a vehicle sheet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Non-vehicle fuel draws — generators (auto) and visitor fuel (authorised) */}
      {genRows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><Zap size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Generator &amp; visitor fuel</h3><span className="text-xs text-status-neutral">non-vehicle draws — visitor fuel needs Ops authorisation</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-status-neutral"><tr>
                <th className="px-5 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 font-medium">Recipient</th><th className="px-4 py-2 text-right font-medium">Litres</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Authorised by</th>{(canManage || canAuthorize) && <th className="px-4 py-2" />}
              </tr></thead>
              <tbody>
                {genRows.map((g) => (
                  <tr key={g.id} className="border-t border-black/5">
                    <td className="px-5 py-2 text-navy">{g.date}</td>
                    <td className="px-4 py-2 text-status-neutral">{DRAW_LABEL[g.kind]}</td>
                    <td className="px-4 py-2 font-medium text-navy">{g.recipient}{g.vehicle_reg && <span className="ml-1 font-normal text-status-neutral">({g.vehicle_reg})</span>}{g.notes && <span className="ml-1 text-[11px] font-normal text-status-neutral">· {g.notes}</span>}</td>
                    <td className="px-4 py-2 text-right text-navy">{g.litres.toLocaleString()} L</td>
                    <td className="px-4 py-2"><StatusBadge tone={drawTone(g.status)}>{drawLabel(g.status)}</StatusBadge></td>
                    <td className="px-4 py-2 text-[11px] text-status-neutral">{g.authorized_by || '—'}</td>
                    {(canManage || canAuthorize) && (
                      <td className="px-4 py-2"><div className="flex justify-end gap-1">
                        {canAuthorize && g.status === 'pending' && <>
                          <button onClick={() => authorizeDraw(g.id, true)} className="rounded-md p-1.5 text-status-good hover:bg-status-good/10" title="Authorise"><Check size={15} /></button>
                          <button onClick={() => authorizeDraw(g.id, false)} className="rounded-md p-1.5 text-status-critical hover:bg-status-critical/10" title="Reject"><X size={15} /></button>
                        </>}
                        {canManage && <button onClick={() => setGenModal({ open: true, editing: g, kind: g.kind })} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Edit"><Pencil size={14} /></button>}
                        {canManage && <button onClick={() => confirm('Remove this fuel draw?') && genFuelStore.remove(g.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button>}
                      </div></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <QuickRefuelModal open={quickOpen} onClose={() => setQuickOpen(false)} branch={branch} vehicles={vehicles} drivers={drivers} routes={routes} attendants={attendants} />
      <AddIssuancesModal open={addOpen} onClose={() => setAddOpen(false)} branch={branch} vehicles={vehicles} drivers={drivers} routes={routes} attendants={attendants} />
      <EditIssuanceModal editing={editing} onClose={() => setEditing(null)} vehicles={vehicles} drivers={drivers} routes={routes} attendants={attendants} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} branch={branch} vehicles={vehicles} attendants={attendants} />
      <OtherDrawModal state={genModal} onClose={() => setGenModal({ open: false, editing: null, kind: 'generator' })} branch={branch} />
    </div>
  )
}

function OtherDrawModal({ state, onClose, branch }: { state: { open: boolean; editing: GenFuel | null; kind: DrawKind }; onClose: () => void; branch: BranchCode }) {
  const e = state.editing
  const kind = e?.kind ?? state.kind
  const isVehicle = kind === 'visitor' // non-fleet authorised vehicle
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [recipient, setRecipient] = useState(''); const [vehReg, setVehReg] = useState(''); const [litres, setLitres] = useState(0); const [notes, setNotes] = useState('')
  const [key, setKey] = useState('')
  const k = (e?.id ?? 'new') + kind + String(state.open)
  if (state.open && k !== key) { setKey(k); setDate(e?.date ?? '2026-06-19'); setRecipient(e?.recipient ?? (isVehicle ? '' : 'Generator 1')); setVehReg(e?.vehicle_reg ?? ''); setLitres(e?.litres ?? 0); setNotes(e?.notes ?? '') }
  function save() {
    if (!litres || !recipient.trim()) return
    if (e) {
      genFuelStore.update(e.id, { date, kind, recipient: recipient.trim(), vehicle_reg: vehReg.trim(), litres: Number(litres), notes: notes.trim() })
    } else {
      // Generators are auto-approved; authorised non-fleet vehicles start pending until Ops signs off.
      genFuelStore.add({ branch, date, kind, recipient: recipient.trim(), vehicle_reg: vehReg.trim(), litres: Number(litres), notes: notes.trim(), status: isVehicle ? 'pending' : 'approved', authorized_by: '', authorized_at: '' })
    }
    onClose()
  }
  return (
    <Modal open={state.open} onClose={onClose} title={`${e ? 'Edit' : 'Record'} ${isVehicle ? 'authorised-vehicle' : 'generator'} fuel`}
      subtitle={isVehicle ? 'Fuel for a non-fleet vehicle (director, police, community, etc.) — requires authorisation by the Operations / Asst Operations Manager before it counts.' : 'Fuel drawn from the depot for a generator — reduces stock, kept separate from vehicle economy.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Date</span><input type="date" className={inputCls} value={date} onChange={(ev) => setDate(ev.target.value)} /></label>
        {isVehicle ? (
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Who / authority</span><input list="dl-vehicle-who" className={inputCls} placeholder="Director's car / Police / Community" value={recipient} onChange={(ev) => setRecipient(ev.target.value)} /><datalist id="dl-vehicle-who"><option value="Director's car" /><option value="Police" /><option value="Community" /><option value="Contractor" /></datalist></label>
        ) : (
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Generator</span><input list="dl-generators" className={inputCls} placeholder="Generator 1" value={recipient} onChange={(ev) => setRecipient(ev.target.value)} /><datalist id="dl-generators"><option value="Generator 1" /><option value="Generator 2" /></datalist></label>
        )}
        {isVehicle && <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Vehicle reg</span><input className={inputCls} placeholder="e.g. ABZ 1234" value={vehReg} onChange={(ev) => setVehReg(ev.target.value)} /></label>}
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Litres given</span><input type="number" className={inputCls} value={litres || ''} onChange={(ev) => setLitres(Number(ev.target.value))} /></label>
        <label className={clsx('block', isVehicle ? 'col-span-2' : '')}><span className="mb-1 block text-xs font-medium text-navy">Notes / reason (optional)</span><input className={inputCls} value={notes} onChange={(ev) => setNotes(ev.target.value)} /></label>
      </div>
      {isVehicle && !e && <p className="mt-3 rounded-lg bg-status-warning/10 px-3 py-2 text-[11px] text-[#8a6d10]">This will be logged as <b>Pending authorisation</b> and won't affect stock until the Ops / Asst Ops Manager approves it.</p>}
    </Modal>
  )
}

// ── Record refuels (multi-row, per vehicle — opening only) ─────────────
interface Draft { date: string; trip_number: string; route: string; opening_fuel_level: string; closing_fuel_level: string; opening_mileage: string; liters_given: string }
const draft = (date = ''): Draft => ({ date, trip_number: '', route: '', opening_fuel_level: '', closing_fuel_level: '', opening_mileage: '', liters_given: '' })

function PeopleHeader({ fleet, reg, driver, attendant, onFleet, setReg, setDriver, setAttendant, vehicles, drivers, attendants }: any) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Vehicle (fleet)</span>
        <SearchableSelect className={inputCls} value={fleet} onChange={onFleet} placeholder="Select bus…"
          options={vehicles.map((v: any) => ({ value: v.fleet_no, label: v.fleet_no, sub: v.reg_plate }))} /></label>
      <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reg No</span><input className={inputCls} placeholder="BCG 4270" value={reg} onChange={(e) => setReg(e.target.value)} /></label>
      <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Driver</span>
        <SearchableSelect className={inputCls} value={driver} onChange={setDriver} placeholder="Select driver…"
          options={drivers.map((d: any) => ({ value: d.full_name, label: d.full_name, sub: d.section }))} /></label>
      <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Fuel attendant</span>
        <SearchableSelect className={inputCls} value={attendant} onChange={setAttendant} placeholder="Select attendant…"
          options={attendants.map((a: any) => ({ value: a.full_name, label: a.full_name }))} />
        {attendants.length === 0 && <span className="mt-1 block text-[11px] text-status-neutral">No Fuel Attendants in HR for this branch.</span>}
      </label>
    </div>
  )
}

function AddIssuancesModal({ open, onClose, branch, vehicles, drivers, routes, attendants }: { open: boolean; onClose: () => void; branch: BranchCode; vehicles: any[]; drivers: any[]; routes: any[]; attendants: any[] }) {
  const [fleet, setFleet] = useState(''); const [reg, setReg] = useState(''); const [driver, setDriver] = useState(''); const [attendant, setAttendant] = useState('')
  const [rows, setRows] = useState<Draft[]>([draft('2026-06-19'), draft(), draft()])
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setFleet(''); setReg(''); setDriver(''); setAttendant(''); setRows([draft('2026-06-19'), draft(), draft()]) }
  if (!open && wasOpen) setWasOpen(false)

  function onFleet(v: string) { setFleet(v); const veh = vehicles.find((x: any) => x.fleet_no.toLowerCase() === v.toLowerCase()); if (veh) setReg(veh.reg_plate) }
  function setRow(i: number, patch: Partial<Draft>) { setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r))) }
  const ready = rows.filter((r) => r.date && Number(r.opening_mileage) > 0 && Number(r.liters_given) > 0)

  function save() {
    const valid = ready.slice().sort((a, b) => Number(a.opening_mileage) - Number(b.opening_mileage))
    valid.forEach((r) => recordRefuel({
      branch, date: r.date, fleet_no: fleet.trim(), vehicle_reg: reg.trim(), driver: driver.trim(), fuel_attendant: attendant.trim(),
      trip_number: r.trip_number ? Number(r.trip_number) : null, route: r.route.trim(),
      opening_fuel_level: r.opening_fuel_level, closing_fuel_level: r.closing_fuel_level, opening_mileage: Number(r.opening_mileage), closing_mileage: 0,
      liters_given: Number(r.liters_given), notes: '',
    }))
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Record refuels"
      subtitle="Enter the odometer at each refuel — you don't enter a closing. The next refuel for the bus closes the previous one automatically."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={ready.length === 0 || !fleet.trim()}>Save {ready.length} refuel{ready.length === 1 ? '' : 's'}</Button></>}>
      <PeopleHeader {...{ fleet, reg, driver, attendant, onFleet, setReg, setDriver, setAttendant, vehicles, drivers, attendants }} />

      <div className="overflow-x-auto rounded-lg border border-black/10">
        <table className="w-full text-left">
          <thead className="bg-canvas text-[10px] uppercase tracking-wide text-status-neutral">
            <tr>
              <th className="px-2 py-1.5 font-medium">Date</th><th className="px-2 py-1.5 font-medium">Trips</th><th className="px-2 py-1.5 font-medium">Route</th>
              <th className="px-2 py-1.5 font-medium">Level before</th><th className="px-2 py-1.5 font-medium">Level after</th>
              <th className="px-2 py-1.5 font-medium">Odometer now</th><th className="px-2 py-1.5 font-medium">Litres given</th><th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-black/5">
                <td className="px-1.5 py-1"><input type="date" className={cellCls} value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} /></td>
                <td className="px-1.5 py-1"><input className={cellCls} value={r.trip_number} onChange={(e) => setRow(i, { trip_number: e.target.value })} /></td>
                <td className="px-1.5 py-1"><select className={cellCls} value={r.route} onChange={(e) => setRow(i, { route: e.target.value })}><option value="">Route…</option>{routes.map((x: any) => <option key={x.id} value={x.name}>{x.name}</option>)}</select></td>
                <td className="px-1.5 py-1"><select className={cellCls} value={r.opening_fuel_level} onChange={(e) => setRow(i, { opening_fuel_level: e.target.value })}><option value="">—</option>{FUEL_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select></td>
                <td className="px-1.5 py-1"><select className={cellCls} value={r.closing_fuel_level} onChange={(e) => setRow(i, { closing_fuel_level: e.target.value })}><option value="">—</option>{FUEL_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select></td>
                <td className="px-1.5 py-1"><input type="number" className={cellCls} value={r.opening_mileage} onChange={(e) => setRow(i, { opening_mileage: e.target.value })} /></td>
                <td className="px-1.5 py-1"><input type="number" className={cellCls} value={r.liters_given} onChange={(e) => setRow(i, { liters_given: e.target.value })} /></td>
                <td className="px-1.5 py-1"><button onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => setRows((rs) => [...rs, draft(rs[rs.length - 1]?.date ?? '')])} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs font-medium text-brand hover:border-brand"><Plus size={14} /> Add row</button>
      <p className="mt-1 text-[11px] text-status-neutral">Both tank levels (before &amp; after fuelling) are recorded now. Only the closing odometer &amp; KM/L are filled in at the next refuel. Routes come from the Mileage route catalogue.</p>
      {routes.length === 0 && <p className="mt-1 rounded-lg bg-brand-tint/40 px-3 py-2 text-[11px] text-[#8a4513]">No routes for this branch yet — add them in Mileage → Setup → Route catalogue.</p>}
    </Modal>
  )
}

// ── Quick refuel (mobile-first, one bus) — for the attendant at the pump ─
function QuickRefuelModal({ open, onClose, branch, vehicles, drivers, routes, attendants }: { open: boolean; onClose: () => void; branch: BranchCode; vehicles: any[]; drivers: any[]; routes: any[]; attendants: any[] }) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(todayStr)
  const [fleet, setFleet] = useState(''); const [reg, setReg] = useState(''); const [driver, setDriver] = useState(''); const [attendant, setAttendant] = useState('')
  const [odo, setOdo] = useState(''); const [litres, setLitres] = useState('')
  const [before, setBefore] = useState(''); const [after, setAfter] = useState('Full')
  const [route, setRoute] = useState(''); const [trips, setTrips] = useState('')
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setDate(todayStr); setFleet(''); setReg(''); setDriver(''); setAttendant(''); setOdo(''); setLitres(''); setBefore(''); setAfter('Full'); setRoute(''); setTrips('') }
  if (!open && wasOpen) setWasOpen(false)

  function onFleet(v: string) { setFleet(v); const veh = vehicles.find((x: any) => x.fleet_no.toLowerCase() === v.toLowerCase()); if (veh) setReg(veh.reg_plate) }
  const ready = !!fleet.trim() && Number(odo) > 0 && Number(litres) > 0
  function save() {
    if (!ready) return
    recordRefuel({
      branch, date, fleet_no: fleet.trim(), vehicle_reg: reg.trim(), driver: driver.trim(), fuel_attendant: attendant.trim(),
      trip_number: trips ? Number(trips) : null, route: route.trim(), opening_fuel_level: before, closing_fuel_level: after,
      opening_mileage: Number(odo), closing_mileage: 0, liters_given: Number(litres), notes: '',
    })
    onClose()
  }
  const bigCls = 'h-12 w-full rounded-lg border border-black/15 bg-white px-3 text-lg font-semibold text-navy outline-none focus:border-brand'

  return (
    <Modal open={open} onClose={onClose} title="Refuel" subtitle="Enter it as you fuel — finish fuelling, finish entering."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}><Check size={15} /> Save refuel</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Vehicle (fleet)</span>
            <SearchableSelect className={inputCls} value={fleet} onChange={onFleet} placeholder="Select bus…"
              options={vehicles.map((v: any) => ({ value: v.fleet_no, label: v.fleet_no, sub: v.reg_plate }))} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reg No</span><input className={inputCls} placeholder="BCG 4270" value={reg} onChange={(e) => setReg(e.target.value)} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Odometer now</span><input type="number" inputMode="numeric" className={bigCls} placeholder="km" value={odo} onChange={(e) => setOdo(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Litres given</span><input type="number" inputMode="decimal" className={bigCls} placeholder="L" value={litres} onChange={(e) => setLitres(e.target.value)} /></label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Tank before</span><select className={inputCls} value={before} onChange={(e) => setBefore(e.target.value)}><option value="">—</option>{FUEL_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Tank after</span><select className={inputCls} value={after} onChange={(e) => setAfter(e.target.value)}>{FUEL_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Driver</span>
            <SearchableSelect className={inputCls} value={driver} onChange={setDriver} placeholder="Select driver…"
              options={drivers.map((d: any) => ({ value: d.full_name, label: d.full_name, sub: d.section }))} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Attendant</span>
            <SearchableSelect className={inputCls} value={attendant} onChange={setAttendant} placeholder="Select attendant…"
              options={attendants.map((a: any) => ({ value: a.full_name, label: a.full_name }))} /></label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Date</span><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Route</span><select className={inputCls} value={route} onChange={(e) => setRoute(e.target.value)}><option value="">—</option>{routes.map((x: any) => <option key={x.id} value={x.name}>{x.name}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Trips</span><input type="number" className={inputCls} value={trips} onChange={(e) => setTrips(e.target.value)} /></label>
        </div>
        <datalist id="dl-fuel-fleet">{vehicles.map((v: any) => <option key={v.id} value={v.fleet_no} />)}</datalist>
        <p className="text-[11px] text-status-neutral">You only enter the odometer now — the next refuel for this bus closes this one automatically and computes km/L.</p>
      </div>
    </Modal>
  )
}

// ── Edit a single issuance (full fields, incl. closing) ────────────────
function EditIssuanceModal({ editing, onClose, vehicles, drivers, routes, attendants }: { editing: FuelIssuance | null; onClose: () => void; vehicles: any[]; drivers: any[]; routes: any[]; attendants: any[] }) {
  const [f, setF] = useState<FuelIssuance | null>(null)
  const [lastKey, setLastKey] = useState('')
  const key = editing?.id ?? ''
  if (key !== lastKey) { setLastKey(key); setF(editing ? { ...editing } : null) }
  if (!editing || !f) return null

  function set<K extends keyof FuelIssuance>(k: K, v: FuelIssuance[K]) { setF((p) => (p ? { ...p, [k]: v } : p)) }
  function onFleet(v: string) { const veh = vehicles.find((x: any) => x.fleet_no.toLowerCase() === v.toLowerCase()); setF((p) => (p ? { ...p, fleet_no: v, vehicle_reg: veh ? veh.reg_plate : p.vehicle_reg } : p)) }
  function save() {
    editIssuance(editing!.id, {
      date: f!.date, fleet_no: f!.fleet_no.trim(), vehicle_reg: f!.vehicle_reg.trim(), driver: f!.driver, fuel_attendant: f!.fuel_attendant,
      trip_number: f!.trip_number, route: f!.route, opening_fuel_level: f!.opening_fuel_level, closing_fuel_level: f!.closing_fuel_level,
      opening_mileage: Number(f!.opening_mileage) || 0, closing_mileage: Number(f!.closing_mileage) || 0, liters_given: Number(f!.liters_given) || 0, notes: f!.notes,
    })
    onClose()
  }
  return (
    <Modal open={!!editing} onClose={onClose} size="lg" title={`Edit fuel issuance — ${f.fleet_no}`} subtitle="Changes are stamped with who edited and when."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save changes</Button></>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Date</span><input type="date" className={inputCls} value={f.date} onChange={(e) => set('date', e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Fleet No</span><input list="dl-fuel-fleet-e" className={inputCls} value={f.fleet_no} onChange={(e) => onFleet(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reg No</span><input className={inputCls} value={f.vehicle_reg} onChange={(e) => set('vehicle_reg', e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Driver</span><select className={inputCls} value={f.driver} onChange={(e) => set('driver', e.target.value)}><option value="">—</option>{drivers.map((d: any) => <option key={d.id} value={d.full_name}>{d.full_name}</option>)}{f.driver && !drivers.some((d: any) => d.full_name === f.driver) && <option value={f.driver}>{f.driver}</option>}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Attendant</span><select className={inputCls} value={f.fuel_attendant} onChange={(e) => set('fuel_attendant', e.target.value)}><option value="">—</option>{attendants.map((a: any) => <option key={a.id} value={a.full_name}>{a.full_name}</option>)}{f.fuel_attendant && !attendants.some((a: any) => a.full_name === f.fuel_attendant) && <option value={f.fuel_attendant}>{f.fuel_attendant}</option>}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Trips</span><input type="number" className={inputCls} value={f.trip_number ?? ''} onChange={(e) => set('trip_number', e.target.value ? Number(e.target.value) : null)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Route</span><select className={inputCls} value={f.route} onChange={(e) => set('route', e.target.value)}><option value="">—</option>{routes.map((x: any) => <option key={x.id} value={x.name}>{x.name}</option>)}{f.route && !routes.some((x: any) => x.name === f.route) && <option value={f.route}>{f.route}</option>}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Litres</span><input type="number" className={inputCls} value={f.liters_given || ''} onChange={(e) => set('liters_given', Number(e.target.value))} /></label>
        <div />
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Level before refuel</span><select className={inputCls} value={f.opening_fuel_level} onChange={(e) => set('opening_fuel_level', e.target.value)}><option value="">—</option>{FUEL_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Level after refuel</span><select className={inputCls} value={f.closing_fuel_level} onChange={(e) => set('closing_fuel_level', e.target.value)}><option value="">—</option>{FUEL_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
        <div />
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Opening mileage</span><input type="number" className={inputCls} value={f.opening_mileage || ''} onChange={(e) => set('opening_mileage', Number(e.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Closing mileage <span className="text-status-neutral">(0 = open, set at next refuel)</span></span><input type="number" className={inputCls} value={f.closing_mileage || ''} onChange={(e) => set('closing_mileage', Number(e.target.value))} /></label>
      </div>
      <datalist id="dl-fuel-fleet-e">{vehicles.map((v: any) => <option key={v.id} value={v.fleet_no} />)}</datalist>
      {f.edited_at && <p className="mt-3 text-[11px] text-status-neutral">Last edited by {f.edited_by} on {new Date(f.edited_at).toLocaleString()}</p>}
    </Modal>
  )
}

// ── Bulk import ────────────────────────────────────────────────────────
function ImportModal({ open, onClose, branch, vehicles, attendants }: { open: boolean; onClose: () => void; branch: BranchCode; vehicles: any[]; attendants: any[] }) {
  const [fleet, setFleet] = useState(''); const [reg, setReg] = useState(''); const [attendant, setAttendant] = useState('')
  const [parsed, setParsed] = useState<IssuanceImport | null>(null)
  const [done, setDone] = useState<number | null>(null)
  function close() { setFleet(''); setReg(''); setAttendant(''); setParsed(null); setDone(null); onClose() }
  function onFleet(v: string) { setFleet(v); const veh = vehicles.find((x) => x.fleet_no.toLowerCase() === v.toLowerCase()); if (veh) setReg(veh.reg_plate) }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    try { setParsed(await parseIssuances(file, branch, { fleet_no: fleet, vehicle_reg: reg, fuel_attendant: attendant })) } catch { setParsed({ valid: [], errors: [{ row: 0, reason: 'Could not read file. Use the template.' }] }) }
    e.target.value = ''
  }
  function commit() { if (!parsed) return; issuancesStore.bulkAdd(parsed.valid); setDone(parsed.valid.length); setParsed(null) }

  return (
    <Modal open={open} onClose={close} title="Bulk upload fuel issuances" subtitle="Upload a vehicle's fuel sheet. Set defaults below for any columns the sheet omits."
      footer={done !== null ? <Button onClick={close}>Done</Button> : <><Button variant="secondary" onClick={close}>Cancel</Button><Button onClick={commit} disabled={!parsed || parsed.valid.length === 0}>Import {parsed?.valid.length ?? 0}</Button></>}>
      <div className="mb-3 grid grid-cols-3 gap-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Default Fleet No</span><input list="dl-fuel-fleet2" className={inputCls} value={fleet} onChange={(e) => onFleet(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Default Reg</span><input className={inputCls} value={reg} onChange={(e) => setReg(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Default attendant</span>
          <select className={inputCls} value={attendant} onChange={(e) => setAttendant(e.target.value)}>
            <option value="">Select…</option>
            {attendants.map((a) => <option key={a.id} value={a.full_name}>{a.full_name}</option>)}
          </select></label>
      </div>
      <datalist id="dl-fuel-fleet2">{vehicles.map((v) => <option key={v.id} value={v.fleet_no} />)}</datalist>
      <div className="mb-3 flex items-center justify-between rounded-lg bg-canvas px-4 py-3">
        <div className="text-sm text-navy"><div className="font-medium">Template matches your per-vehicle sheet</div><div className="text-xs text-status-neutral">Date, Trips, Route, Driver, fuel levels, mileages, litres.</div></div>
        <Button variant="secondary" onClick={downloadIssuanceTemplate}><Download size={15} /> Template</Button>
      </div>
      {done === null && (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-navy/20 bg-white px-6 py-8 text-center hover:border-brand">
          <UploadCloud size={26} className="text-brand" /><span className="text-sm font-medium text-navy">Choose an .xlsx file</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
        </label>
      )}
      {parsed && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-status-good/30 bg-status-good/5 px-3 py-2 text-sm text-status-good"><CheckCircle2 size={16} /> {parsed.valid.length} issuance(s) ready</div>
          {parsed.errors.length > 0 && <div className="rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-xs text-status-critical"><AlertTriangle size={14} className="mr-1 inline" />{parsed.errors.length} row(s) skipped</div>}
        </div>
      )}
      {done !== null && <div className="mt-4 flex flex-col items-center gap-2 rounded-xl bg-canvas px-6 py-8 text-center"><CheckCircle2 size={26} className="text-status-good" /><div className="font-display text-base font-semibold text-navy">Imported {done}</div></div>}
    </Modal>
  )
}

// ── Stock tab ──────────────────────────────────────────────────────────
function StockTab({ issuances, receipts, genFuel, cfg, branch, canManage }: { issuances: FuelIssuance[]; receipts: any[]; genFuel: GenFuel[]; cfg: FuelConfig; branch: BranchCode; canManage: boolean }) {
  const genTotal = useMemo(() => genFuel.filter(isApprovedDraw).reduce((s, g) => s + g.litres, 0), [genFuel])
  const stock = useMemo(() => computeStock(issuances, receipts, cfg, genTotal), [issuances, receipts, cfg, genTotal])
  const [delivery, setDelivery] = useState<{ open: boolean; editing: FuelReceipt | null }>({ open: false, editing: null })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')

  // Stock ledger rolled up by DAY (so a fleet of 30+ daily fills stays readable):
  // each day shows received, total issued (with fill count) and the running balance.
  const days = useMemo(() => {
    type Day = { date: string; received: number; issued: number; fills: { fleet: string; attendant: string; litres: number }[]; receiptList: { supplier: string; litres: number }[] }
    const map = new Map<string, Day>()
    const get = (date: string) => { let d = map.get(date); if (!d) { d = { date, received: 0, issued: 0, fills: [], receiptList: [] }; map.set(date, d) } return d }
    for (const r of receipts) { const d = get(r.date); d.received += r.litres; d.receiptList.push({ supplier: r.supplier || 'Fuel received', litres: r.litres }) }
    for (const i of issuances) { const d = get(i.date); d.issued += i.liters_given; d.fills.push({ fleet: i.fleet_no, attendant: i.fuel_attendant, litres: i.liters_given }) }
    for (const g of genFuel) { if (!isApprovedDraw(g)) continue; const d = get(g.date); d.issued += g.litres; d.fills.push({ fleet: g.recipient, attendant: DRAW_LABEL[g.kind], litres: g.litres }) }
    const sorted = [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
    let bal = cfg.opening_stock
    const withBal = sorted.map((d) => { const opening = bal; bal += d.received - d.issued; return { ...d, opening, closing: bal } })
    return withBal.reverse() // newest first
  }, [issuances, receipts, genFuel, cfg])

  // Search drills straight to individual fills (by fleet, attendant or date).
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return []
    return issuances
      .filter((i) => i.fleet_no.toLowerCase().includes(term) || (i.fuel_attendant || '').toLowerCase().includes(term) || i.date.includes(term))
      .sort((a, b) => b.date.localeCompare(a.date) || a.fleet_no.localeCompare(b.fleet_no, undefined, { numeric: true }))
  }, [issuances, q])
  const toggle = (date: string) => setExpanded((s) => { const n = new Set(s); n.has(date) ? n.delete(date) : n.add(date); return n })

  const daysTone = stock.daysLeft == null ? 'neutral' : stock.daysLeft < 7 ? 'critical' : stock.daysLeft < 14 ? 'warning' : 'good'

  // Tank gauge: bar = capacity; dead stock (grey) + usable (green) fill it, the rest
  // is empty/consumed — so the level drops as fuel is issued.
  const capacity = cfg.capacity && cfg.capacity > 0 ? cfg.capacity : cfg.opening_stock + stock.totalReceived
  const cap = Math.max(capacity, stock.current, 1)
  const deadL = Math.min(cfg.dead_stock, cap)
  const usableL = Math.max(0, Math.min(stock.current - cfg.dead_stock, cap - deadL))
  const emptyL = Math.max(0, cap - deadL - usableL)
  const fullPct = Math.round((stock.current / cap) * 100)
  const pct = (n: number) => (n / cap) * 100

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canManage && <Button variant="secondary" onClick={() => setSettingsOpen(true)}><Settings size={15} /> Settings</Button>}
        {canManage && <Button onClick={() => setDelivery({ open: true, editing: null })}><PackagePlus size={15} /> Record delivery</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <KpiCard label="Available fuel" value={`${Math.round(stock.usable).toLocaleString()} L`} highlight info="Real usable fuel — what's in the tank minus the dead-stock reserve." sub="excludes dead stock" />
        <KpiCard label="Days left" value={stock.daysLeft == null ? '—' : Math.floor(stock.daysLeft)} tone={daysTone} info="Available fuel ÷ rolling 30-day average usage." sub="rolling 30-day" />
        <KpiCard label="Avg daily use" value={`${Math.round(stock.avgDailyUsage).toLocaleString()} L`} sub="last 30 days" />
        <KpiCard label="Tank total" value={`${Math.round(stock.current).toLocaleString()} L`} info="Everything in the tank, including dead stock." />
        <KpiCard label="Dead stock" value={`${cfg.dead_stock.toLocaleString()} L`} sub="reserve, not usable" />
        <KpiCard label="Received" value={`${Math.round(stock.totalReceived).toLocaleString()} L`} tone="good" />
      </div>

      {/* Tank gauge — fills against capacity, drops as fuel is used */}
      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-navy">Tank level <span className="text-status-neutral">· {fullPct}% full</span></span>
          <span className="text-status-neutral">{Math.round(stock.usable).toLocaleString()} L usable + {cfg.dead_stock.toLocaleString()} L dead = {Math.round(stock.current).toLocaleString()} L of {Math.round(cap).toLocaleString()} L</span>
        </div>
        <div className="flex h-5 w-full overflow-hidden rounded-full bg-canvas ring-1 ring-inset ring-black/10">
          <div className="h-full bg-status-neutral/40" style={{ width: `${pct(deadL)}%` }} title={`Dead stock ${Math.round(deadL).toLocaleString()} L`} />
          <div className="h-full bg-status-good transition-[width] duration-500" style={{ width: `${pct(usableL)}%` }} title={`Usable ${Math.round(usableL).toLocaleString()} L`} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-4 text-[11px] text-status-neutral">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-status-good" /> Usable {Math.round(usableL).toLocaleString()} L</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-status-neutral/40" /> Dead stock {Math.round(deadL).toLocaleString()} L</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-canvas ring-1 ring-inset ring-black/15" /> Empty {Math.round(emptyL).toLocaleString()} L</span>
        </div>
      </div>

      {stock.daysLeft != null && stock.daysLeft < 14 && (
        <div className={clsx('flex items-center gap-2 rounded-xl border px-4 py-3 text-sm', daysTone === 'critical' ? 'border-status-critical/30 bg-status-critical/5 text-status-critical' : 'border-status-warning/40 bg-status-warning/10 text-[#8a6d10]')}>
          <AlertTriangle size={16} /> Usable stock will last about <b className="mx-1">{Math.floor(stock.daysLeft)} days</b> at current usage — plan a delivery.
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <h3 className="font-display text-sm font-bold text-navy">Stock ledger</h3>
          <span className="text-xs text-status-neutral">{q ? `${matches.length} fill(s) matching` : 'by day — click a day to see its fills'}</span>
          <div className="relative ml-auto">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-status-neutral" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fleet, attendant or date…" className="w-64 rounded-lg border border-black/15 bg-white py-1.5 pl-8 pr-3 text-sm text-navy outline-none focus:border-brand" />
          </div>
        </div>
        <div className="overflow-x-auto">
          {q ? (
            /* Search results — individual fills */
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-status-neutral"><tr>
                <th className="px-5 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Fleet</th><th className="px-4 py-2 font-medium">Attendant</th><th className="px-4 py-2 text-right font-medium">Litres</th>
              </tr></thead>
              <tbody>
                {matches.map((i) => (
                  <tr key={i.id} className="border-t border-black/5">
                    <td className="px-5 py-2 text-navy">{i.date}</td>
                    <td className="px-4 py-2 font-medium text-navy">{i.fleet_no}</td>
                    <td className="px-4 py-2 text-status-neutral">{i.fuel_attendant || '—'}</td>
                    <td className="px-4 py-2 text-right text-navy">{i.liters_given.toLocaleString()} L</td>
                  </tr>
                ))}
                {matches.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-status-neutral">No fills match “{q}”.</td></tr>}
              </tbody>
            </table>
          ) : (
            /* Daily roll-up */
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-status-neutral"><tr>
                <th className="px-5 py-2 font-medium">Date</th><th className="px-4 py-2 text-right font-medium">Fills</th>
                <th className="px-4 py-2 text-right font-medium">Received</th><th className="px-4 py-2 text-right font-medium">Issued</th>
                <th className="px-4 py-2 text-right font-medium">Opening</th><th className="px-4 py-2 text-right font-medium">Closing</th>
              </tr></thead>
              <tbody>
                {days.map((d) => {
                  const open = expanded.has(d.date)
                  return (
                    <Fragment key={d.date}>
                      <tr className="cursor-pointer border-t border-black/5 hover:bg-canvas/60" onClick={() => toggle(d.date)}>
                        <td className="px-5 py-2 font-medium text-navy">
                          <span className="inline-flex items-center gap-1.5"><ChevronDown size={14} className={clsx('text-status-neutral transition-transform', !open && '-rotate-90')} />{d.date}</span>
                        </td>
                        <td className="px-4 py-2 text-right text-status-neutral">{d.fills.length || '—'}</td>
                        <td className={clsx('px-4 py-2 text-right font-medium', d.received ? 'text-status-good' : 'text-status-neutral')}>{d.received ? `+${d.received.toLocaleString()}` : '—'}</td>
                        <td className="px-4 py-2 text-right text-navy">{d.issued ? `-${d.issued.toLocaleString()}` : '—'}</td>
                        <td className="px-4 py-2 text-right text-status-neutral">{Math.round(d.opening).toLocaleString()}</td>
                        <td className="px-4 py-2 text-right font-medium text-navy">{Math.round(d.closing).toLocaleString()}</td>
                      </tr>
                      {open && (
                        <tr className="border-t border-black/5 bg-canvas/40">
                          <td colSpan={6} className="px-5 py-3">
                            {d.receiptList.map((r, k) => (
                              <div key={`r${k}`} className="flex items-center justify-between py-0.5 text-xs"><span className="font-medium text-status-good">Received · {r.supplier}</span><span className="text-status-good">+{r.litres.toLocaleString()} L</span></div>
                            ))}
                            <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                              {d.fills.map((f, k) => (
                                <div key={`f${k}`} className="flex items-center justify-between py-0.5 text-xs">
                                  <span className="text-navy"><b className="font-medium">{f.fleet}</b> <span className="text-status-neutral">· {f.attendant || '—'}</span></span>
                                  <span className="text-status-neutral">{f.litres.toLocaleString()} L</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {days.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-status-neutral">No stock movements yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <DeliveryModal state={delivery} onClose={() => setDelivery({ open: false, editing: null })} branch={branch} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} branch={branch} cfg={cfg} />
    </div>
  )
}

function SettingsModal({ open, onClose, branch, cfg }: { open: boolean; onClose: () => void; branch: BranchCode; cfg: FuelConfig }) {
  const [f, setF] = useState<FuelConfig>(cfg)
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setF(cfg) }
  if (!open && wasOpen) setWasOpen(false)
  function save() { setFuelConfig(branch, { opening_stock: Number(f.opening_stock) || 0, dead_stock: Number(f.dead_stock) || 0, capacity: Number(f.capacity) || 0 }); onClose() }
  return (
    <Modal open={open} onClose={onClose} title="Fuel settings" subtitle="Depot baseline, dead-stock reserve and tank capacity for this branch." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-3 gap-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Opening stock (L)</span><input type="number" className={inputCls} value={f.opening_stock} onChange={(e) => setF({ ...f, opening_stock: Number(e.target.value) })} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Dead stock (L)</span><input type="number" className={inputCls} value={f.dead_stock} onChange={(e) => setF({ ...f, dead_stock: Number(e.target.value) })} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Tank capacity (L)</span><input type="number" className={inputCls} value={f.capacity ?? 0} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} /></label>
      </div>
      <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-[11px] text-status-neutral">The tank gauge fills against <b>capacity</b> and drops as fuel is issued. Set 0 for auto (opening stock + everything received). Dead stock is the unpumpable reserve — excluded from "available fuel". Diesel price and the USD↔ZMW rate are set per month in the Summary tab.</p>
    </Modal>
  )
}

// ── Deliveries tab (fuel received register) ────────────────────────────
function deliveriesReport(branchLabel: string, rows: FuelReceipt[]): ReportInput {
  const totalLitres = rows.reduce((s, r) => s + r.litres, 0)
  const totalSpend = rows.reduce((s, r) => s + (r.unit_cost_usd != null ? r.litres * r.unit_cost_usd : 0), 0)
  const body = rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.supplier || '—')}</td><td class="num">${r.litres.toLocaleString()}</td><td class="num">${r.unit_cost_usd != null ? esc(money(r.unit_cost_usd, 'USD')) : '—'}</td><td class="num">${r.unit_cost_usd != null ? esc(money(r.litres * r.unit_cost_usd, 'USD')) : '—'}</td><td>${esc(r.created_by)}</td></tr>`).join('')
  return {
    title: `Fuel Deliveries Register — ${branchLabel}`,
    subtitle: `${rows.length} deliveries · ${totalLitres.toLocaleString()} L · ${money(totalSpend, 'USD')} total`,
    body: `<table><thead><tr><th>Date</th><th>Supplier</th><th class="num">Litres</th><th class="num">Unit cost</th><th class="num">Total cost</th><th>Recorded by</th></tr></thead><tbody>${body || '<tr><td colspan="6" style="text-align:center;color:#6B7280">No deliveries</td></tr>'}<tr class="tot"><td colspan="2">Total</td><td class="num">${totalLitres.toLocaleString()}</td><td></td><td class="num">${money(totalSpend, 'USD')}</td><td></td></tr></tbody></table>`,
    landscape: false,
    filenameBase: `Fuel Deliveries - ${branchLabel}`,
  }
}

function DeliveriesTab({ receipts, branch, branchLabel, canManage }: { receipts: FuelReceipt[]; branch: BranchCode; branchLabel: string; canManage: boolean }) {
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<{ open: boolean; editing: FuelReceipt | null }>({ open: false, editing: null })

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return receipts
      .filter((r) => !term || (r.supplier || '').toLowerCase().includes(term) || r.date.includes(term))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [receipts, q])

  const totalLitres = receipts.reduce((s, r) => s + r.litres, 0)
  const withCost = receipts.filter((r) => r.unit_cost_usd != null)
  const costLitres = withCost.reduce((s, r) => s + r.litres, 0)
  const totalSpend = withCost.reduce((s, r) => s + r.litres * (r.unit_cost_usd as number), 0)
  const avgUnit = costLitres > 0 ? totalSpend / costLitres : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Deliveries" value={receipts.length} sub="on record" />
        <KpiCard label="Litres received" value={`${totalLitres.toLocaleString()} L`} tone="good" />
        <KpiCard label="Total spend" value={money(totalSpend, 'USD')} info="Sum of litres × unit cost, for deliveries with a recorded cost." />
        <KpiCard label="Avg unit cost" value={avgUnit != null ? money(avgUnit, 'USD') : '—'} sub="per litre (USD)" />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <h3 className="font-display text-sm font-bold text-navy">Deliveries register</h3>
          <span className="text-xs text-status-neutral">every fuel receipt into the depot</span>
          <div className="relative ml-auto">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-status-neutral" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search supplier or date…" className="w-56 rounded-lg border border-black/15 bg-white py-1.5 pl-8 pr-3 text-sm text-navy outline-none focus:border-brand" />
          </div>
          <Button variant="secondary" onClick={() => exportReceipts(rows, branchLabel)}><Download size={15} /> Excel</Button>
          <Button variant="secondary" onClick={() => exportReportPDF(deliveriesReport(branchLabel, rows))}><FileText size={15} /> PDF</Button>
          {canManage && <Button onClick={() => setModal({ open: true, editing: null })}><PackagePlus size={15} /> Record delivery</Button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white"><tr>
              <th className="px-5 py-2.5 font-medium">Date</th><th className="px-4 py-2.5 font-medium">Supplier</th>
              <th className="px-4 py-2.5 text-right font-medium">Litres</th><th className="px-4 py-2.5 text-right font-medium">Unit cost</th>
              <th className="px-4 py-2.5 text-right font-medium">Total cost</th><th className="px-4 py-2.5 font-medium">Note</th><th className="px-4 py-2.5 font-medium">Recorded by</th>
              {canManage && <th className="px-4 py-2.5" />}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-5 py-2 text-navy">{r.date}</td>
                  <td className="px-4 py-2 font-medium text-navy">{r.supplier || '—'}</td>
                  <td className="px-4 py-2 text-right text-navy">{r.litres.toLocaleString()} L</td>
                  <td className="px-4 py-2 text-right text-status-neutral">{r.unit_cost_usd != null ? money(r.unit_cost_usd, 'USD') : '—'}</td>
                  <td className="px-4 py-2 text-right text-navy">{r.unit_cost_usd != null ? money(r.litres * r.unit_cost_usd, 'USD') : '—'}</td>
                  <td className="px-4 py-2">{r.delivery_note_file ? <button onClick={() => viewFile(r.delivery_note_file!, 'delivery-note')} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Paperclip size={13} /> View</button> : <span className="text-status-neutral">—</span>}</td>
                  <td className="px-4 py-2 text-[11px] text-status-neutral">{r.created_by}<div>{new Date(r.created_at).toLocaleDateString()}</div></td>
                  {canManage && (
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setModal({ open: true, editing: r })} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Edit"><Pencil size={14} /></button>
                        <button onClick={() => confirm('Remove this delivery record?') && receiptsStore.remove(r.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={canManage ? 8 : 7} className="px-4 py-12 text-center text-sm text-status-neutral">{q ? `No deliveries match “${q}”.` : 'No deliveries recorded yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <DeliveryModal state={modal} onClose={() => setModal({ open: false, editing: null })} branch={branch} />
    </div>
  )
}

function DeliveryModal({ state, onClose, branch }: { state: { open: boolean; editing: FuelReceipt | null }; onClose: () => void; branch: BranchCode }) {
  const e = state.editing
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [litres, setLitres] = useState(0); const [supplier, setSupplier] = useState(''); const [cost, setCost] = useState(''); const [notes, setNotes] = useState('')
  const [noteFile, setNoteFile] = useState<string | undefined>(undefined); const [noteName, setNoteName] = useState('')
  const [key, setKey] = useState('')
  const k = (e?.id ?? 'new') + String(state.open)
  if (state.open && k !== key) {
    setKey(k)
    setDate(e?.date ?? '2026-06-01'); setLitres(e?.litres ?? 0); setSupplier(e?.supplier ?? ''); setCost(e?.unit_cost_usd != null ? String(e.unit_cost_usd) : ''); setNotes(e?.notes ?? '')
    setNoteFile(e?.delivery_note_file); setNoteName(e?.delivery_note_file ? 'Attached document' : '')
  }
  async function onFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]; if (!file) return
    const id = noteFile || `dn_${Date.now()}_${Math.round(Math.random() * 1e6)}`
    await putFile(id, file)
    setNoteFile(id); setNoteName(file.name)
    ev.target.value = ''
  }
  function save() {
    if (!litres) return
    const data = { branch, date, litres: Number(litres), supplier: supplier.trim(), unit_cost_usd: cost ? Number(cost) : null, notes: notes.trim(), delivery_note_file: noteFile }
    if (e) receiptsStore.update(e.id, data); else receiptsStore.add(data)
    onClose()
  }
  return (
    <Modal open={state.open} onClose={onClose} title={e ? 'Edit delivery' : 'Record fuel delivery'} subtitle="A dated record of fuel received into the depot — supplier, quantity, cost and the delivery note." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Date</span><input type="date" className={inputCls} value={date} onChange={(ev) => setDate(ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Litres received</span><input type="number" className={inputCls} value={litres || ''} onChange={(ev) => setLitres(Number(ev.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Supplier / company</span><input className={inputCls} placeholder="Puma Energy" value={supplier} onChange={(ev) => setSupplier(ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Unit cost (USD/L, optional)</span><input type="number" step="0.01" className={inputCls} value={cost} onChange={(ev) => setCost(ev.target.value)} /></label>
        <label className="col-span-2 block"><span className="mb-1 block text-xs font-medium text-navy">Notes (optional)</span><input className={inputCls} placeholder="Order ref / remarks" value={notes} onChange={(ev) => setNotes(ev.target.value)} /></label>
      </div>

      <div className="mt-3">
        <span className="mb-1 block text-xs font-medium text-navy">Delivery note (PDF or image)</span>
        {noteFile ? (
          <div className="flex items-center gap-2 rounded-lg border border-status-good/30 bg-status-good/5 px-3 py-2 text-sm">
            <Paperclip size={15} className="text-status-good" />
            <span className="flex-1 truncate text-navy">{noteName || 'Delivery note attached'}</span>
            <button onClick={() => viewFile(noteFile!, 'delivery-note')} className="text-xs font-medium text-brand hover:underline">View</button>
            <button onClick={() => { setNoteFile(undefined); setNoteName('') }} className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={13} /></button>
          </div>
        ) : (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed border-navy/20 px-3 py-2.5 text-sm text-status-neutral hover:border-brand">
            <UploadCloud size={16} className="text-brand" /> Choose a file to attach
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={onFile} />
          </label>
        )}
      </div>

      {cost && litres ? <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-xs text-status-neutral">Total cost: <b className="text-navy">{money(Number(litres) * Number(cost), 'USD')}</b></p> : null}
    </Modal>
  )
}

// ── Summary tab ────────────────────────────────────────────────────────
function SummaryTab({ issuances, genFuel, branch, canManage }: { issuances: FuelIssuance[]; genFuel: GenFuel[]; branch: BranchCode; canManage: boolean }) {
  const curMonth = new Date().toISOString().slice(0, 7)
  const months = useMemo(() => { const s = new Set([curMonth, ...issuances.map((i) => monthKey(i.date)), ...genFuel.map((g) => monthKey(g.date))]); return [...s].sort().reverse() }, [issuances, genFuel])
  const [month, setMonth] = useState('')
  const effMonth = months.includes(month) ? month : curMonth
  const [cur, setCur] = useState<Currency>('USD')
  const [editRate, setEditRate] = useState(false)

  const rate = useFuelRate(branch, effMonth)
  const monthIssuances = issuances.filter((i) => monthKey(i.date) === effMonth)
  const vehicleLitres = monthIssuances.reduce((s, i) => s + i.liters_given, 0)
  const totalKm = monthIssuances.reduce((s, i) => s + kmMoved(i), 0)
  const price = pricePerLitre(rate, cur)
  const perVehicle = summariseByVehicle(monthIssuances)
  // Approved non-vehicle draws (generator + authorised visitor fuel) for the month.
  const monthDraws = genFuel.filter((g) => isApprovedDraw(g) && monthKey(g.date) === effMonth).sort((a, b) => b.date.localeCompare(a.date))
  const drawLitres = monthDraws.reduce((s, g) => s + g.litres, 0)
  const totalLitres = vehicleLitres + drawLitres
  const totalCost = totalLitres * price
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const report = () => fuelReport({ branchLabel, monthLbl: monthLabel(effMonth), cur, rate, vehicleLitres, km: totalKm, price, perVehicle, draws: monthDraws })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-status-neutral">Month
          <select value={effMonth} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-navy outline-none focus:border-brand">
            {months.length === 0 && <option value="">—</option>}
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
            {(['USD', 'ZMW'] as Currency[]).map((c) => (
              <button key={c} onClick={() => setCur(c)} className={clsx('px-3 py-2 text-sm font-medium', cur === c ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas')}>{c === 'USD' ? 'USD ($)' : 'ZMW (K)'}</button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => exportReportPDF(report())} disabled={!effMonth}><FileText size={15} /> PDF</Button>
          <Button variant="secondary" onClick={() => exportReportWord(report())} disabled={!effMonth}><FileType size={15} /> Word</Button>
        </div>
      </div>

      {/* Monthly rates (ERB diesel + BoZ FX) */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-black/10 bg-canvas/50 px-4 py-3 text-sm">
        <span className="text-navy"><b>Diesel</b> K{rate.diesel_zmw.toFixed(2)}/L <span className="text-status-neutral">(ERB)</span></span>
        <span className="text-navy"><b>USD→ZMW</b> K{rate.fx_zmw_per_usd.toFixed(2)} <span className="text-status-neutral">(Bank of Zambia)</span></span>
        <span className="text-[11px] text-status-neutral">{rate.source} · updated {new Date(rate.updated_at).toLocaleDateString()}</span>
        {canManage && <Button variant="secondary" className="ml-auto" onClick={() => setEditRate(true)} disabled={!effMonth}>Update rates</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KpiCard label="Total fuel used" value={`${totalLitres.toLocaleString()} L`} highlight sub={drawLitres ? `${vehicleLitres.toLocaleString()} vehicles + ${drawLitres.toLocaleString()} other` : 'vehicles'} info="Vehicle issuances plus approved generator / visitor draws." />
        <KpiCard label="Price / litre" value={money(price, cur)} info="From Fuel settings. Switch currency with the toggle above." />
        <KpiCard label="Total fuel cost" value={money(totalCost, cur)} tone="warning" />
        <KpiCard label="Non-vehicle fuel" value={`${drawLitres.toLocaleString()} L`} sub="generator + visitor" />
        <KpiCard label="Total km moved" value={totalKm.toLocaleString()} sub="vehicles" />
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">Consumption by vehicle — {effMonth ? monthLabel(effMonth) : '—'}</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white"><tr>
              <th className="px-4 py-2.5 font-medium">No.</th><th className="px-4 py-2.5 font-medium">Vehicle Reg</th><th className="px-4 py-2.5 font-medium">Fleet #</th>
              <th className="px-4 py-2.5 font-medium">Litres used</th><th className="px-4 py-2.5 font-medium">KM moved</th><th className="px-4 py-2.5 font-medium">Avg KM/L</th><th className="px-4 py-2.5 font-medium">Cost</th>
            </tr></thead>
            <tbody>
              {perVehicle.map((v, i) => (
                <tr key={v.fleet_no + v.vehicle_reg} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-4 py-2 text-status-neutral">{i + 1}</td>
                  <td className="px-4 py-2 font-medium text-navy">{v.vehicle_reg}</td>
                  <td className="px-4 py-2 text-navy">{v.fleet_no}</td>
                  <td className="px-4 py-2 text-status-neutral">{v.litres.toLocaleString()} ltr</td>
                  <td className="px-4 py-2 text-status-neutral">{v.km.toLocaleString()}</td>
                  <td className="px-4 py-2 font-medium text-navy">{v.kmPerL?.toFixed(2) ?? '—'}</td>
                  <td className="px-4 py-2 text-status-neutral">{money(v.litres * price, cur)}</td>
                </tr>
              ))}
              {perVehicle.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-status-neutral">No issuances for this month.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Non-vehicle fuel — generator & approved visitor draws */}
      {monthDraws.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">Non-vehicle fuel — {effMonth ? monthLabel(effMonth) : '—'}</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-navy text-white"><tr>
                <th className="px-4 py-2.5 font-medium">Date</th><th className="px-4 py-2.5 font-medium">Type</th><th className="px-4 py-2.5 font-medium">Recipient</th>
                <th className="px-4 py-2.5 font-medium">Litres</th><th className="px-4 py-2.5 font-medium">Cost</th>
              </tr></thead>
              <tbody>
                {monthDraws.map((g, i) => (
                  <tr key={g.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                    <td className="px-4 py-2 text-navy">{g.date}</td>
                    <td className="px-4 py-2 text-status-neutral">{DRAW_LABEL[g.kind]}</td>
                    <td className="px-4 py-2 font-medium text-navy">{g.recipient}{g.vehicle_reg && <span className="ml-1 font-normal text-status-neutral">({g.vehicle_reg})</span>}</td>
                    <td className="px-4 py-2 text-status-neutral">{g.litres.toLocaleString()} ltr</td>
                    <td className="px-4 py-2 text-status-neutral">{money(g.litres * price, cur)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-navy/20 bg-canvas font-medium text-navy">
                  <td className="px-4 py-2" colSpan={3}>Total non-vehicle fuel</td>
                  <td className="px-4 py-2">{drawLitres.toLocaleString()} ltr</td>
                  <td className="px-4 py-2">{money(drawLitres * price, cur)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editRate && <RateModal branch={branch} ym={effMonth} rate={rate} onClose={() => setEditRate(false)} />}
    </div>
  )
}

// ── Monthly rates editor: ERB diesel (manual) + USD→ZMW (live fetch or manual) ──
function RateModal({ branch, ym, rate, onClose }: { branch: BranchCode; ym: string; rate: FuelRate; onClose: () => void }) {
  const [diesel, setDiesel] = useState(String(rate.diesel_zmw))
  const [fx, setFx] = useState(String(rate.fx_zmw_per_usd))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  async function fetchFx() {
    setBusy(true); setErr(''); setNote('')
    try {
      const v = await fetchLiveUsdZmw()
      setFx(String(v))
      setNote(`Live market rate K${v.toFixed(2)} — confirm against the Bank of Zambia figure and adjust if needed.`)
    } catch (e) {
      setErr((e as Error).message || 'Could not reach the rate service. Enter it manually.')
    } finally { setBusy(false) }
  }
  function save() {
    const d = Number(diesel), f = Number(fx)
    if (!isFinite(d) || d <= 0) return setErr('Enter a valid diesel price (K / litre).')
    if (!isFinite(f) || f <= 0) return setErr('Enter a valid USD → ZMW rate.')
    setFuelRate(branch, ym, { diesel_zmw: +d.toFixed(2), fx_zmw_per_usd: +f.toFixed(2), source: 'ERB diesel · BoZ FX (entered)', updated_at: new Date().toISOString() })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={`Rates — ${monthLabel(ym)}`} subtitle="ERB diesel price and the USD → ZMW rate used to cost this month"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>Save rates</Button></>}>
      {err && <div className="mb-3 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{err}</div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Diesel price — ERB (K / litre)</span>
          <input type="number" step="0.01" min="0" className={inputCls} value={diesel} onChange={(e) => setDiesel(e.target.value)} />
          <span className="mt-1 block text-[11px] text-status-neutral">From the ERB monthly pump-price notice — there's no public feed to pull, so enter it here.</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">USD → ZMW (Bank of Zambia)</span>
          <input type="number" step="0.01" min="0" className={inputCls} value={fx} onChange={(e) => setFx(e.target.value)} />
          <Button variant="secondary" type="button" className="mt-2" onClick={fetchFx} disabled={busy}>{busy ? 'Fetching…' : 'Fetch live USD → ZMW'}</Button>
        </label>
      </div>
      {note && <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-xs text-status-neutral">{note}</p>}
      <p className="mt-3 text-[11px] text-status-neutral">Saved for {monthLabel(ym)} only — each month keeps its own figures and the summary uses the selected month's.</p>
    </Modal>
  )
}
