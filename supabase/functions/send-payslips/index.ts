// ===========================================================================
// send-payslips — emails a payslip PDF to one employee, run on Supabase's
// servers so the mail credentials never reach the browser.
//
// One call = one employee = one attachment. Payslips are personal: they are
// never batched into a single message, and there is no CC/BCC path, so one
// person's pay can't land in another's inbox. The caller loops for "send all".
//
// Transport — whichever is configured wins, so you can pick either without a
// code change. Set the secrets with `supabase secrets set KEY=value`:
//
//   Resend (email API):
//     RESEND_API_KEY   re_xxx
//     PAYSLIP_FROM     "INZU Payroll <payroll@yourdomain.com>"   (verified domain)
//
//   or SMTP (INZU's own mailbox — Google Workspace, M365, cPanel…):
//     SMTP_HOST        smtp.gmail.com
//     SMTP_PORT        465            (465 = TLS, 587 = STARTTLS)
//     SMTP_USER        payroll@inzumcs.com
//     SMTP_PASS        an app password, NOT the account password
//     PAYSLIP_FROM     "INZU Payroll <payroll@inzumcs.com>"
//
// Optional:
//     PAYSLIP_BCC      an archive address that gets a copy of every payslip
//
// Deploy:  supabase functions deploy send-payslips
//
// Body (POST JSON):
//   { to, employee_name, month_label, subject?, message?, filename, pdf_base64,
//     password_hint? }
// → { ok: true, id? }
// ===========================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Mirrors canEdit(role, 'payroll') in the app — keep the two in step.
const PAYROLL_ROLES = ['administrator', 'payroll_officer', 'hr_manager', 'operations_manager', 'managing_director']

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function bodyHtml(name: string, monthLabel: string, message: string, hint: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#0F1B33;font-size:14px;line-height:1.5">
    <p>Dear ${esc(name)},</p>
    <p>${message ? esc(message) : `Please find attached your pay statement for the month ending <b>${esc(monthLabel)}</b>.`}</p>
    ${hint ? `<p style="background:#F1F3F7;padding:10px 12px;border-radius:6px;font-size:13px"><b>Opening the attachment:</b> it is password protected. ${esc(hint)}</p>` : ''}
    <p>If any detail looks wrong, please contact the HR office.</p>
    <p style="color:#6B7280;font-size:12px;margin-top:22px">INZU Mining Construction and Suppliers Limited<br>
      This message is confidential and intended only for ${esc(name)}. If you received it in error, please delete it and let us know.</p>
  </div>`
}

async function sendViaResend(opts: { from: string; to: string; bcc: string; subject: string; html: string; filename: string; pdf: string }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      ...(opts.bcc ? { bcc: [opts.bcc] } : {}),
      subject: opts.subject,
      html: opts.html,
      attachments: [{ filename: opts.filename, content: opts.pdf }],
    }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out?.message || `Resend returned ${res.status}`)
  return out?.id as string | undefined
}

async function sendViaSmtp(opts: { from: string; to: string; bcc: string; subject: string; html: string; filename: string; pdf: string }) {
  const port = Number(Deno.env.get('SMTP_PORT') || 465)
  const client = new SMTPClient({
    connection: {
      hostname: Deno.env.get('SMTP_HOST')!,
      port,
      tls: port === 465, // 587 negotiates STARTTLS after connecting
      auth: { username: Deno.env.get('SMTP_USER')!, password: Deno.env.get('SMTP_PASS')! },
    },
  })
  try {
    await client.send({
      from: opts.from,
      to: opts.to,
      ...(opts.bcc ? { bcc: [opts.bcc] } : {}),
      subject: opts.subject,
      html: opts.html,
      attachments: [{ filename: opts.filename, encoding: 'base64', content: opts.pdf, contentType: 'application/pdf' }],
    })
  } finally {
    await client.close()
  }
  return undefined
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1) Identify the caller from their JWT.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ error: 'Missing authorization' }, 401)
  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user }, error: userErr } = await caller.auth.getUser()
  if (userErr || !user) return json({ error: 'Not authenticated' }, 401)

  // 2) Only an active payroll role may send someone's pay details.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: prof } = await admin.from('profiles').select('role, active').eq('id', user.id).single()
  if (!prof || !prof.active || !PAYROLL_ROLES.includes(prof.role)) return json({ error: 'Payroll access required' }, 403)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const to = String(body.to ?? '').trim()
  const pdf = String(body.pdf_base64 ?? '')
  const filename = String(body.filename ?? 'payslip.pdf')
  const name = String(body.employee_name ?? '')
  const monthLabel = String(body.month_label ?? '')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: 'A valid recipient address is required' }, 400)
  if (!pdf) return json({ error: 'No payslip attached' }, 400)

  const from = Deno.env.get('PAYSLIP_FROM') || Deno.env.get('SMTP_USER') || ''
  if (!from) return json({ error: 'PAYSLIP_FROM is not configured on the server' }, 500)
  const useResend = !!Deno.env.get('RESEND_API_KEY')
  const useSmtp = !!(Deno.env.get('SMTP_HOST') && Deno.env.get('SMTP_USER') && Deno.env.get('SMTP_PASS'))
  if (!useResend && !useSmtp) return json({ error: 'No email transport configured — set RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS.' }, 500)

  const opts = {
    from, to,
    bcc: Deno.env.get('PAYSLIP_BCC') || '',
    subject: String(body.subject ?? '') || `Payslip — ${monthLabel}`,
    html: bodyHtml(name, monthLabel, String(body.message ?? ''), String(body.password_hint ?? '')),
    filename, pdf,
  }

  try {
    const id = useResend ? await sendViaResend(opts) : await sendViaSmtp(opts)
    return json({ ok: true, id })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Send failed' }, 502)
  }
})
