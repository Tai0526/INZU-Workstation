import { requireSupabase } from '@/lib/supabase/client'
import { isValidEmail } from '@/lib/reports/recipients'
import { payslipPdfBlob, blobToBase64, payslipFileName } from './payslipPdf'
import type { Payslip, PayslipTemplate } from './payslip'
import type { PayRow } from './run'

/**
 * Emailing payslips. One employee per message with their own attachment — never a
 * batch, never a CC, so nobody can receive someone else's pay details. Mail
 * credentials live only in the `send-payslips` Edge Function.
 *
 * A payslip is sendable only when we have somewhere to send it and, if password
 * protection is on, something to lock it with. `sendability()` is the single place
 * that decides, so the confirm dialog and the send loop can never disagree.
 */

export type Blocker = 'no-email' | 'bad-email' | 'no-nrc'
export const BLOCKER_LABEL: Record<Blocker, string> = {
  'no-email': 'No email address on file',
  'bad-email': 'Email address on file looks invalid',
  'no-nrc': 'No NRC on file to lock the PDF with',
}

export interface Sendability { ok: boolean; email: string; blocker: Blocker | null }
export function sendability(row: PayRow, protect: boolean): Sendability {
  const email = (row.file.email || '').trim()
  if (!email) return { ok: false, email, blocker: 'no-email' }
  if (!isValidEmail(email)) return { ok: false, email, blocker: 'bad-email' }
  if (protect && !(row.file.national_id || '').trim()) return { ok: false, email, blocker: 'no-nrc' }
  return { ok: true, email, blocker: null }
}

/** The PDF password for a person: their NRC. Empty means "send unprotected". */
export const payslipPassword = (row: PayRow, protect: boolean): string => (protect ? (row.file.national_id || '').trim() : '')

export interface SendResult { name: string; email: string; ok: boolean; error?: string }

/** Build one employee's PDF and email it. Throws only on a programming error. */
export async function sendOnePayslip(
  row: PayRow, slip: Payslip, template: PayslipTemplate,
  opts: { logo?: string; protect: boolean; message?: string },
): Promise<SendResult> {
  const { email } = sendability(row, opts.protect)
  const base = { name: slip.name, email }
  try {
    const password = payslipPassword(row, opts.protect)
    const blob = await payslipPdfBlob(slip, template, { logo: opts.logo, password })
    const { data, error } = await requireSupabase().functions.invoke('send-payslips', {
      body: {
        to: email,
        employee_name: slip.name,
        month_label: slip.monthLabel,
        subject: `Payslip — ${slip.monthLabel}`,
        message: opts.message ?? '',
        filename: payslipFileName(slip),
        pdf_base64: await blobToBase64(blob),
        // Never put the password itself in the covering email — that would defeat it.
        password_hint: password ? 'Enter your NRC number exactly as it appears on your records (including the slashes).' : '',
      },
    })
    if (error) return { ...base, ok: false, error: humanError(error) }
    if (data?.error) return { ...base, ok: false, error: String(data.error) }
    return { ...base, ok: true }
  } catch (e) {
    return { ...base, ok: false, error: e instanceof Error ? e.message : 'Could not build or send the payslip' }
  }
}

/** Supabase wraps a non-2xx as "Edge Function returned a non-2xx status code" — dig out the real reason. */
function humanError(error: unknown): string {
  const ctx = (error as { context?: { error?: string } })?.context
  if (ctx?.error) return ctx.error
  const msg = error instanceof Error ? error.message : String(error)
  return /non-2xx/i.test(msg)
    ? 'The send-payslips function rejected the request — check it is deployed and its mail secrets are set.'
    : msg
}
