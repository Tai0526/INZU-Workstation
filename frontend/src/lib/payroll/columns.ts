import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * Pay-run Excel export columns. HR chooses which columns appear and in what order
 * (e.g. put the bank name / branch code / account next to net pay for a bank
 * payment file). The chosen order is persisted in app_config.
 */
export const PAYRUN_COLUMNS: { key: string; label: string }[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'employee_no', label: 'Employee No' },
  { key: 'department', label: 'Department' },
  { key: 'dept_no', label: 'Dept no' },
  { key: 'job_title', label: 'Job title' },
  { key: 'grade', label: 'Grade' },
  { key: 'nrc', label: 'National ID' },
  { key: 'napsa_no', label: 'Social security no' },
  { key: 'tpin', label: 'TPIN' },
  { key: 'pay_method', label: 'Pay method' },
  { key: 'payment_type', label: 'Payment type' },
  { key: 'bank', label: 'Bank' },
  { key: 'bank_branch', label: 'Bank branch code' },
  { key: 'bank_account', label: 'Bank account' },
  { key: 'basic', label: 'Basic' },
  { key: 'gratuity', label: 'Gratuity' },
  { key: 'allowances', label: 'Allowances' },
  { key: 'leavePay', label: 'Leave paid out' },
  { key: 'gross', label: 'Gross' },
  { key: 'taxable', label: 'Taxable' },
  { key: 'paye', label: 'PAYE' },
  { key: 'napsa', label: 'NAPSA' },
  { key: 'nhima', label: 'NHIS' },
  { key: 'fines', label: 'Fines' },
  { key: 'net', label: 'Net' },
]
export const PAYRUN_COLUMN_LABEL: Record<string, string> = Object.fromEntries(PAYRUN_COLUMNS.map((c) => [c.key, c.label]))
export const PAYRUN_NUMERIC = new Set(['basic', 'gratuity', 'allowances', 'leavePay', 'gross', 'taxable', 'paye', 'napsa', 'nhima', 'fines', 'net'])
export const DEFAULT_PAYRUN_COLS = ['employee', 'employee_no', 'department', 'grade', 'bank', 'bank_branch', 'bank_account', 'basic', 'gratuity', 'allowances', 'leavePay', 'gross', 'paye', 'napsa', 'nhima', 'fines', 'net']

const cfg = createSyncConfig<string[]>({
  key: 'payroll_export_cols', lsKey: 'inzu_payroll_export_cols', default: DEFAULT_PAYRUN_COLS,
  merge: (s) => (Array.isArray(s) && s.length ? s.filter((k) => PAYRUN_COLUMN_LABEL[k]) : DEFAULT_PAYRUN_COLS),
})
export const payrunColsStore = {
  get: (): string[] => cfg.get(),
  set(cols: string[]) { cfg.set(cols) },
  reset() { cfg.set([...DEFAULT_PAYRUN_COLS]) },
  subscribe: cfg.subscribe,
}
export const usePayrunCols = () => useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
