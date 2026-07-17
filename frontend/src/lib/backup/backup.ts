import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'

/**
 * Whole-database backup — a single JSON file holding every record the app stores,
 * so there is always a copy that does not depend on Supabase, this browser, or us.
 *
 * This is a SECOND line of defence, not the first: the data already lives in
 * Postgres, which Supabase backs up itself (and Point-in-Time Recovery covers the
 * gaps). This exists so the data can be taken elsewhere, kept off-site, or
 * restored into a fresh project.
 *
 * NOT included: uploaded files (certificates, contracts, payslip attachments).
 * Those live in the private `documents` storage bucket and are far too large to
 * inline; Supabase backs the bucket up separately. The JSON records reference them
 * by id, so a restore re-links them as long as the bucket is intact.
 */

/**
 * Every table the app persists to. `app_config` is one jsonb row per settings key
 * and carries a lot of real work (job cards, checklists, monthly inspections,
 * employee files, the leave ledger, messaging), so it matters most of all.
 *
 * Keep in step with the stores: anything passed to createSyncTable, plus the
 * tables Supabase manages for us. A table missing here is a table missing from
 * every backup, so the exporter reports what it actually read.
 */
export const BACKUP_TABLES = [
  'app_config',
  'vehicles', 'operated_vehicles', 'drivers', 'employees',
  'speed_events', 'disciplinary_cases', 'documents',
  'payroll_deductions', 'report_recipients',
  'fuel_issuances', 'fuel_receipts', 'fuel_generator',
  'mileage_trips', 'mileage_routes',
  'op_routes', 'op_allocations', 'op_mileage', 'op_daily_plan', 'op_weekly_assign',
  'safety_compliance', 'safety_training', 'safety_hazards', 'safety_cap', 'safety_loto', 'safety_tools',
  'petty_cash_requisitions', 'petty_cash_ledger',
  'profiles', 'login_events',
] as const

/**
 * Restoring these would fight Supabase Auth — a profile row without its matching
 * auth.users record is a ghost account that can't sign in. They're exported (so a
 * backup shows who had access and with what permissions) but never written back.
 */
const NEVER_RESTORE = new Set<string>(['profiles', 'login_events'])

export interface BackupFile {
  format: 'inzu-workstation-backup'
  version: 1
  created_at: string
  created_by: string
  project_url: string
  tables: Record<string, unknown[]>
}
export interface TableCount { table: string; rows: number; error?: string }

/** Read every row of a table, paging past PostgREST's 1000-row response cap. */
async function readAll(table: string): Promise<{ rows: unknown[]; error?: string }> {
  const db = supabase!
  const PAGE = 1000
  const all: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select('*').range(from, from + PAGE - 1)
    if (error) return { rows: all, error: error.message }
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return { rows: all }
}

/**
 * Read the whole database. `onProgress` fires per table so a slow export shows
 * movement rather than looking frozen.
 */
export async function buildBackup(createdBy: string, onProgress?: (done: number, total: number, table: string) => void): Promise<{ file: BackupFile; counts: TableCount[] }> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured, so there is nothing in the database to back up. This device\'s data lives only in this browser.')
  const tables: Record<string, unknown[]> = {}
  const counts: TableCount[] = []
  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const t = BACKUP_TABLES[i]
    onProgress?.(i, BACKUP_TABLES.length, t)
    const { rows, error } = await readAll(t)
    tables[t] = rows
    counts.push({ table: t, rows: rows.length, ...(error ? { error } : {}) })
  }
  onProgress?.(BACKUP_TABLES.length, BACKUP_TABLES.length, 'done')
  return {
    file: {
      format: 'inzu-workstation-backup', version: 1,
      created_at: new Date().toISOString(), created_by: createdBy,
      project_url: import.meta.env.VITE_SUPABASE_URL ?? '',
      tables,
    },
    counts,
  }
}

export function downloadBackup(file: BackupFile) {
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `INZU_backup_${file.created_at.slice(0, 10)}.json`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
}

/** Reject anything that isn't one of our backups before it gets near the database. */
export function parseBackup(text: string): BackupFile {
  let parsed: any
  try { parsed = JSON.parse(text) } catch { throw new Error('That file isn\'t valid JSON.') }
  if (parsed?.format !== 'inzu-workstation-backup') throw new Error('That isn\'t an INZU backup file.')
  if (parsed.version !== 1) throw new Error(`That backup is version ${parsed.version}, which this build doesn't understand.`)
  if (!parsed.tables || typeof parsed.tables !== 'object') throw new Error('That backup has no tables in it.')
  return parsed as BackupFile
}

export const backupSummary = (f: BackupFile): TableCount[] =>
  Object.entries(f.tables).map(([table, rows]) => ({ table, rows: Array.isArray(rows) ? rows.length : 0 })).filter((c) => c.rows > 0)

/**
 * Write a backup back into the database.
 *
 * Upsert-only, by design: it adds and overwrites the rows in the file and never
 * deletes anything. So it fully rebuilds an empty project, and it can't silently
 * destroy work that happened after the backup was taken. It is NOT an "undo" —
 * rows created since the backup stay.
 */
export async function restoreBackup(file: BackupFile, onProgress?: (done: number, total: number, table: string) => void): Promise<TableCount[]> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured, so there is nowhere to restore to.')
  const db = supabase
  const entries = Object.entries(file.tables).filter(([t, rows]) => !NEVER_RESTORE.has(t) && Array.isArray(rows) && rows.length > 0)
  const out: TableCount[] = []
  for (let i = 0; i < entries.length; i++) {
    const [table, rows] = entries[i]
    onProgress?.(i, entries.length, table)
    // Chunked — a single upsert of several thousand rows times out.
    const CHUNK = 500
    let written = 0
    let err: string | undefined
    for (let j = 0; j < rows.length; j += CHUNK) {
      const { error } = await db.from(table).upsert(rows.slice(j, j + CHUNK) as any)
      if (error) { err = error.message; break }
      written += Math.min(CHUNK, rows.length - j)
    }
    out.push({ table, rows: written, ...(err ? { error: err } : {}) })
  }
  onProgress?.(entries.length, entries.length, 'done')
  return out
}
