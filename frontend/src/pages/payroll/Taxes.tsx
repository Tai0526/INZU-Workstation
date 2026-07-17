import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, RotateCcw, Save, Percent, Coins } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { canEdit } from '@/lib/permissions'
import Button from '@/components/ui/Button'
import { useTaxConfig, taxStore, DEFAULT_TAX, type TaxConfig, type PayeBand } from '@/lib/payroll/tax'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand disabled:bg-canvas disabled:text-status-neutral'

export default function PayrollTaxes() {
  const { user } = useAuth()
  const canManage = canEdit(user!.role, 'payroll')
  const stored = useTaxConfig()
  const [f, setF] = useState<TaxConfig>(stored)
  const [key, setKey] = useState('')
  if (key !== JSON.stringify(stored) && key === '') { setKey(JSON.stringify(stored)); setF(stored) }
  const set = <K extends keyof TaxConfig>(k: K, v: TaxConfig[K]) => setF((p) => ({ ...p, [k]: v }))
  const setBand = (i: number, patch: Partial<PayeBand>) => setF((p) => ({ ...p, paye_bands: p.paye_bands.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) }))
  const dirty = JSON.stringify(f) !== JSON.stringify(stored)

  function save() {
    // Order bands by threshold (a single null = top band, kept last).
    const bands = [...f.paye_bands].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity))
    taxStore.set({ ...f, paye_bands: bands })
    setKey(''); // re-sync on next render
  }
  function reset() { if (confirm('Reset all rates to the Zambian defaults?')) { taxStore.reset(); setKey('') } }

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="max-w-2xl text-sm text-status-neutral">
          Statutory rates applied on the <Link to="/payroll/runs" className="font-medium text-brand hover:underline">pay run</Link>. Changes apply to the next computed run, not retroactively. Gross (basic + allowances) comes from each employee's file.
        </p>
        {canManage && <div className="ml-auto flex gap-2"><Button variant="secondary" onClick={reset}><RotateCcw size={15} /> Defaults</Button><Button onClick={save} disabled={!dirty}><Save size={15} /> Save rates</Button></div>}
      </div>

      {/* PAYE bands */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><Percent size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">PAYE bands (monthly {f.currency})</h3></div>
        <div className="p-4">
          <div className="mb-1 grid grid-cols-[1fr_1fr_auto] gap-2 text-[11px] font-medium uppercase tracking-wide text-status-neutral">
            <span>Up to (blank = and above)</span><span>Rate %</span><span />
          </div>
          <div className="space-y-1.5">
            {f.paye_bands.map((b, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <input type="number" disabled={!canManage} className={inputCls} placeholder="and above" value={b.upTo ?? ''} onChange={(e) => setBand(i, { upTo: e.target.value === '' ? null : Number(e.target.value) })} />
                <input type="number" step="0.5" disabled={!canManage} className={inputCls} value={b.rate} onChange={(e) => setBand(i, { rate: Number(e.target.value) })} />
                {canManage && <button onClick={() => set('paye_bands', f.paye_bands.filter((_, idx) => idx !== i))} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={15} /></button>}
              </div>
            ))}
          </div>
          {canManage && <button onClick={() => set('paye_bands', [...f.paye_bands, { upTo: null, rate: 0 }])} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs font-medium text-brand hover:border-brand"><Plus size={14} /> Add band</button>}
          <p className="mt-2 text-[11px] text-status-neutral">Progressive: each band's rate applies only to the portion of gross within it. Leave one band's "Up to" blank for the top (and-above) band.</p>
        </div>
      </div>

      {/* Gratuity — a pay component, but a mandatory rule rather than a per-person figure. */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><Coins size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Gratuity</h3></div>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Gratuity rate (% of basic)</span><input type="number" step="0.5" disabled={!canManage} className={inputCls} value={f.gratuity_rate} onChange={(e) => set('gratuity_rate', Number(e.target.value))} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Taxable?</span>
            <select disabled={!canManage} className={inputCls} value={f.gratuity_taxable ? 'yes' : 'no'} onChange={(e) => set('gratuity_taxable', e.target.value === 'yes')}>
              <option value="no">No — outside monthly PAYE</option>
              <option value="yes">Yes — include in taxable pay</option>
            </select></label>
        </div>
        <p className="px-4 pb-4 text-[11px] text-status-neutral">Gratuity is mandatory and paid every month on top of basic — it never needs entering on an employee's file. NAPSA is charged on the full gross <i>including</i> gratuity; PAYE is not, unless you switch it on above.</p>
      </div>

      {/* NAPSA / NHIS / currency */}
      <div className="card overflow-hidden">
        <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">Contributions &amp; currency</h3></div>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">NAPSA rate (% of gross)</span><input type="number" step="0.5" disabled={!canManage} className={inputCls} value={f.napsa_rate} onChange={(e) => set('napsa_rate', Number(e.target.value))} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">NAPSA monthly ceiling ({f.currency})</span><input type="number" step="0.01" disabled={!canManage} className={inputCls} value={f.napsa_ceiling} onChange={(e) => set('napsa_ceiling', Number(e.target.value))} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">NHIS rate (% of basic)</span><input type="number" step="0.5" disabled={!canManage} className={inputCls} value={f.nhima_rate} onChange={(e) => set('nhima_rate', Number(e.target.value))} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Currency</span><input disabled={!canManage} className={inputCls} value={f.currency} onChange={(e) => set('currency', e.target.value)} /></label>
        </div>
      </div>

      <p className="text-[11px] text-status-neutral">Defaults are the figures that reproduce INZU's own payslips: PAYE bands 0 / 20 / 30 / {DEFAULT_TAX.paye_bands[DEFAULT_TAX.paye_bands.length - 1].rate}%, gratuity {DEFAULT_TAX.gratuity_rate}% of basic (untaxed), NAPSA {DEFAULT_TAX.napsa_rate}% capped at {DEFAULT_TAX.currency} {DEFAULT_TAX.napsa_ceiling.toLocaleString()}, NHIS {DEFAULT_TAX.nhima_rate}%. Verify against the current ZRA / NAPSA / NHIMA rates before running payroll.</p>
    </div>
  )
}
