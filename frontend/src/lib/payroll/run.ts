import { useMemo } from 'react'
import type { BranchCode } from '@/lib/roles'
import { useHrPeople, type HrPerson } from '@/lib/hr/directory'
import { employeeFileStore, useEmployeeFiles, type EmployeeFile } from '@/lib/hr/employeeFile'
import { useLeaveLedger, leaveBalance, leavePayoutDays, leaveStats } from '@/lib/hr/leaveLedger'
import { useSalaryBands, leaveRateFor } from '@/lib/hr/salaryBands'
import { leaveStore } from '@/lib/drivers/leave'
import { empLeaveStore } from '@/lib/hr/leave'
import { useDeductions } from './deductions'
import { useTaxConfig, computePay, type PayLine, type TaxConfig } from './tax'

/**
 * The month's pay run, computed live and shared by the Pay Runs table, its Excel
 * export and the payslips — so all three always agree. Each row joins:
 *   employee file  → basic + allowances, bank & identity  (the master salary source)
 *   leave ledger   → days due / taken, and any days PAID OUT this month (taxable pay)
 *   deductions     → pending incident fines recovered this month
 *   Payroll→Taxes  → PAYE bands, NAPSA, NHIS
 * Only people with a basic pay set in their file are in the run.
 */

export interface PayRow {
  p: HrPerson
  file: EmployeeFile
  grade: string
  /** This month's actual pay — includes any leave pay-out and fines. */
  line: PayLine
  /** A plain month at the same salary (no pay-out, no fines) — the basis for prior-month YTD. */
  recurring: PayLine
  leave: { rate: number; due: number; taken: number; paidDays: number; paidDaysYtd: number }
  fines: { detail: string; amount: number }[]
  finesRecoveredYtd: number
}

export interface PayRun { rows: PayRow[]; tax: TaxConfig; unpriced: number }

export function usePayRun(branch: BranchCode, month: string): PayRun {
  const people = useHrPeople(branch)
  const files = useEmployeeFiles()
  const ledger = useLeaveLedger().filter((e) => e.branch === branch)
  const bands = useSalaryBands()
  const allDeductions = useDeductions().filter((d) => d.branch === branch)
  const tax = useTaxConfig()

  return useMemo(() => {
    const active = people.filter((p) => p.status === 'active')
    const year = Number(month.slice(0, 4))
    const asOf = `${month}-28` // balances as at the month being paid
    const mine = (id: string, name: string) => allDeductions.filter((d) => (d.driver_id ? d.driver_id === id : d.driver_name === name))

    const rows: PayRow[] = []
    for (const p of active) {
      const file = employeeFileStore.for(p.id)
      const sal = file.salary
      if (!sal || !(sal.basic > 0)) continue

      const allowances = (sal.allowances ?? []).reduce((t, a) => t + (a.amount || 0), 0)
      const rate = leaveRateFor(sal, bands)
      const paidDays = leavePayoutDays(ledger, p.id, { month })
      const paidDaysYtd = leavePayoutDays(ledger, p.id, { year })
      const leavePay = paidDays * rate

      const ded = mine(p.id, p.full_name)
      const fines = ded.filter((d) => d.status === 'pending').map((d) => ({ detail: d.reason || 'Incident fine', amount: d.amount }))
      const fineTotal = fines.reduce((s, f) => s + f.amount, 0)
      const finesRecoveredYtd = ded.filter((d) => d.status === 'applied' && d.date.slice(0, 4) === String(year)).reduce((s, d) => s + d.amount, 0)

      const cl = leaveStore.for(p.id) || empLeaveStore.for(p.id)
      const bal = leaveBalance(ledger, p.id, { openingBalance: file.leave_opening, openingAt: file.leave_opening_at, asOf, currentLeave: cl })

      rows.push({
        p, file, grade: sal.grade,
        line: computePay(sal.basic, allowances, fineTotal, tax, leavePay),
        recurring: computePay(sal.basic, allowances, 0, tax, 0),
        leave: { rate, due: bal.balance, taken: bal.annualTaken || leaveStats(ledger, p.id, year).days, paidDays, paidDaysYtd },
        fines, finesRecoveredYtd,
      })
    }
    const unpriced = active.length - rows.length
    return { rows, tax, unpriced }
    // `files` is the reactivity trigger for employeeFileStore.for(…) reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, files, ledger, bands, allDeductions, tax, month])
}
