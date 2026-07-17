import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * Statutory payroll config + the pay computation. Gross (basic + allowances) comes
 * from each employee's file (the master salary source); the statutory deductions —
 * PAYE, NAPSA, NHIMA — are configured HERE and applied on the run, plus any pending
 * incident fines. Rates default to Zambian figures and are editable in Payroll →
 * Taxes; changes apply to the next computed run (nothing is stored retroactively).
 */
export interface PayeBand { upTo: number | null; rate: number } // upTo = upper bound of the band (null = top band); rate %
export interface TaxConfig {
  currency: string
  paye_bands: PayeBand[]
  napsa_rate: number    // % of gross
  napsa_ceiling: number // max monthly employee NAPSA contribution
  nhima_rate: number    // % of basic
}

// Zambian defaults (2024-ish) — editable in Payroll → Taxes.
export const DEFAULT_TAX: TaxConfig = {
  currency: 'ZMW',
  paye_bands: [
    { upTo: 5100, rate: 0 },
    { upTo: 7100, rate: 20 },
    { upTo: 9200, rate: 30 },
    { upTo: null, rate: 37.5 },
  ],
  napsa_rate: 5,
  napsa_ceiling: 1342.4,
  nhima_rate: 1,
}

const cfg = createSyncConfig<TaxConfig>({
  key: 'payroll_tax', lsKey: 'inzu_payroll_tax', default: DEFAULT_TAX,
  merge: (s) => ({ ...DEFAULT_TAX, ...(s || {}), paye_bands: s?.paye_bands?.length ? s.paye_bands : DEFAULT_TAX.paye_bands }),
})
export const taxStore = {
  get: (): TaxConfig => cfg.get(),
  set(patch: Partial<TaxConfig>) { cfg.set({ ...cfg.get(), ...patch }) },
  reset() { cfg.set({ ...DEFAULT_TAX }) },
  subscribe: cfg.subscribe,
}
export const useTaxConfig = () => useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)

/** Progressive PAYE over the bands (each band's `upTo` is its cumulative upper bound). */
export function computePaye(gross: number, bands: PayeBand[]): number {
  let tax = 0, prev = 0
  for (const b of bands) {
    const upper = b.upTo ?? Infinity
    if (gross <= prev) break
    const slice = Math.min(gross, upper) - prev
    tax += (slice * (b.rate || 0)) / 100
    prev = upper
  }
  return Math.round(tax)
}

export interface PayLine {
  basic: number
  allowances: number
  gross: number
  paye: number
  napsa: number
  nhima: number
  fines: number
  statutory: number   // paye + napsa + nhima
  totalDeductions: number
  net: number
}

/** Compute a person's pay from their file salary + statutory config + pending fines. */
export function computePay(basic: number, allowances: number, fines: number, t: TaxConfig): PayLine {
  const gross = Math.max(0, (basic || 0) + (allowances || 0))
  const paye = computePaye(gross, t.paye_bands)
  const napsa = Math.round(Math.min(gross * (t.napsa_rate || 0) / 100, t.napsa_ceiling || Infinity))
  const nhima = Math.round((basic || 0) * (t.nhima_rate || 0) / 100)
  const statutory = paye + napsa + nhima
  const totalDeductions = statutory + (fines || 0)
  return { basic: basic || 0, allowances: allowances || 0, gross, paye, napsa, nhima, fines: fines || 0, statutory, totalDeductions, net: gross - totalDeductions }
}
