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
  napsa_rate: number     // % of gross (gratuity included)
  napsa_ceiling: number  // max monthly employee NAPSA contribution
  nhima_rate: number     // % of basic
  gratuity_rate: number  // % of basic — paid every month, mandatory
  gratuity_taxable: boolean // INZU practice: gratuity is outside monthly PAYE
}

/**
 * Zambian defaults — editable in Payroll → Taxes. The PAYE bands and the gratuity
 * rule below are the ones that reproduce INZU's own payslips to the ngwee
 * (checked against the November 2024 statement): 25% gratuity on basic, excluded
 * from taxable pay but inside the NAPSA base, and a 37% top PAYE rate.
 */
export const DEFAULT_TAX: TaxConfig = {
  currency: 'ZMW',
  paye_bands: [
    { upTo: 5100, rate: 0 },
    { upTo: 7100, rate: 20 },
    { upTo: 9200, rate: 30 },
    { upTo: null, rate: 37 },
  ],
  napsa_rate: 5,
  napsa_ceiling: 1342.4,
  nhima_rate: 1,
  gratuity_rate: 25,
  gratuity_taxable: false,
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

/** Money rounding — payslips are stated to the ngwee, so never round to whole units. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Progressive PAYE over the bands (each band's `upTo` is its cumulative upper bound). */
export function computePaye(taxable: number, bands: PayeBand[]): number {
  let tax = 0, prev = 0
  for (const b of bands) {
    const upper = b.upTo ?? Infinity
    if (taxable <= prev) break
    const slice = Math.min(taxable, upper) - prev
    tax += (slice * (b.rate || 0)) / 100
    prev = upper
  }
  return round2(tax)
}

/**
 * "Free pay" — the slice of gross that falls in the 0%-rated band (the tax-free
 * threshold). Printed on payslips as Freepay; the rest of gross is what PAYE bites.
 */
export function freepay(gross: number, bands: PayeBand[]): number {
  const first = bands[0]
  if (!first || (first.rate || 0) !== 0) return 0
  return Math.min(gross, first.upTo ?? Infinity)
}

export interface PayLine {
  basic: number
  gratuity: number    // mandatory, % of basic
  allowances: number
  leavePay: number    // leave days paid out this month × the grade's leave-day rate
  gross: number       // everything paid — basic + gratuity + allowances + leave pay
  taxable: number     // the slice PAYE is charged on (gross less untaxed gratuity)
  paye: number
  napsa: number
  nhima: number
  fines: number
  statutory: number   // paye + napsa + nhima
  totalDeductions: number
  net: number
}

/**
 * A person's pay for one month, from their file salary + the statutory config +
 * pending fines. `leavePay` is any leave days paid out in the month.
 *
 * The order matters and is INZU's, verified against a real payslip:
 *   gross    = basic + gratuity + allowances + leave pay
 *   taxable  = gross − gratuity            (gratuity sits outside monthly PAYE)
 *   PAYE     = progressive bands on taxable
 *   NAPSA    = % of FULL gross (gratuity included), capped
 *   NHIS     = % of basic only
 */
export function computePay(basic: number, allowances: number, fines: number, t: TaxConfig, leavePay = 0): PayLine {
  const b = Math.max(0, basic || 0)
  const gratuity = round2(b * (t.gratuity_rate || 0) / 100)
  const gross = round2(b + gratuity + (allowances || 0) + (leavePay || 0))
  const taxable = round2(t.gratuity_taxable ? gross : gross - gratuity)
  const paye = computePaye(taxable, t.paye_bands)
  const napsa = round2(Math.min(gross * (t.napsa_rate || 0) / 100, t.napsa_ceiling || Infinity))
  const nhima = round2(b * (t.nhima_rate || 0) / 100)
  const statutory = round2(paye + napsa + nhima)
  const totalDeductions = round2(statutory + (fines || 0))
  return { basic: b, gratuity, allowances: allowances || 0, leavePay: leavePay || 0, gross, taxable, paye, napsa, nhima, fines: fines || 0, statutory, totalDeductions, net: round2(gross - totalDeductions) }
}
