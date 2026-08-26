// Daily attention digests — one email per KIND of thing, never one per item.
//
// Three groups, each sent only when it has something to say:
//   1. Vehicle licensing   — fitness, road tax, insurance, FQM inspection and
//                            any custom category: expired first, then expiring.
//   2. Driver credentials  — driving licences, PSV, and the Safety compliance
//                            and training certificates.
//   3. Contracts & company documents — employment contracts from the HR files,
//                            plus library documents that carry an expiry.
//
// Called two ways:
//   - by pg_cron every morning (header x-cron-secret must match CRON_SECRET);
//   - from the Admin page's "Send now" button (a signed-in admin's JWT).
//
// Recipients and the on/off switch live in app_config key 'reminder_config',
// edited on the Admin page — the same row the app reads, one source of truth.
//
// Deploy:   supabase functions deploy daily-reminders
// Secrets:  supabase secrets set CRON_SECRET=<long random string>
//           (email transport reuses the payslip settings: RESEND_API_KEY or
//            SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS, and REMINDER_FROM or
//            PAYSLIP_FROM as the sender)
// Schedule: migration 0008_daily_reminders.sql (pg_cron + Vault)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const ADMIN_ROLES = ['administrator', 'operations_manager', 'asst_operations_manager', 'hr_manager']
const WARN_DAYS = 30 // matches the app's EXPIRY_WARNING_DAYS and contract soonDays

// The four built-in licensing categories; custom ones come from licensing_config.
const LICENSING_LABELS: Record<string, string> = {
  road_tax: 'Road Tax', fitness: 'Fitness Certificate', insurance: 'Insurance', fqm_inspection: 'FQM Inspection',
}
const BRANCH_LABEL: Record<string, string> = { trident: 'Trident (Kalumbila)', kansanshi: 'Kansanshi (Solwezi)' }

interface Item {
  what: string      // e.g. "Fitness Certificate"
  who: string       // vehicle fleet no / person
  branch: string
  expiry: string    // yyyy-mm-dd
  days: number      // negative = days overdue
}
interface Group { key: string; title: string; items: Item[] }

const daysUntil = (iso: string, today: string) =>
  Math.round((new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000)

const fmtDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// ── The email body: expired table, then expiring table ─────────────────
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

function tableOf(items: Item[], tone: 'expired' | 'expiring'): string {
  const colour = tone === 'expired' ? '#B3261E' : '#8a6d10'
  const rows = items.map((i) => `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(i.what)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${esc(i.who)}</b></td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(BRANCH_LABEL[i.branch] ?? i.branch)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(fmtDate(i.expiry))}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${colour};font-weight:bold">
      ${tone === 'expired' ? `${Math.abs(i.days)} day${Math.abs(i.days) === 1 ? '' : 's'} overdue` : `${i.days} day${i.days === 1 ? '' : 's'} left`}</td>
  </tr>`).join('')
  return `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:6px 0 18px">
    <tr style="background:#0F1B33;color:#fff;text-align:left">
      <th style="padding:7px 10px">Item</th><th style="padding:7px 10px">For</th>
      <th style="padding:7px 10px">Branch</th><th style="padding:7px 10px">Expiry</th><th style="padding:7px 10px">Status</th>
    </tr>${rows}</table>`
}

function emailHtml(g: Group, today: string): string {
  const expired = g.items.filter((i) => i.days < 0).sort((a, b) => a.days - b.days)
  const expiring = g.items.filter((i) => i.days >= 0).sort((a, b) => a.days - b.days)
  return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#0F1B33;max-width:720px">
  <div style="background:#0F1B33;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0">
    <div style="font-size:16px;font-weight:bold">${esc(g.title)}</div>
    <div style="font-size:12px;opacity:.75">INZU Workstation daily reminder · ${esc(fmtDate(today))}</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:16px 18px;border-radius:0 0 8px 8px">
    ${expired.length ? `<div style="font-weight:bold;color:#B3261E;margin-bottom:4px">Expired — needs action now (${expired.length})</div>${tableOf(expired, 'expired')}` : ''}
    ${expiring.length ? `<div style="font-weight:bold;color:#8a6d10;margin-bottom:4px">Expiring within ${WARN_DAYS} days (${expiring.length})</div>${tableOf(expiring, 'expiring')}` : ''}
    <div style="font-size:11px;color:#6b7280;margin-top:6px">Sent automatically every morning while anything here needs attention. Update the item in the Workstation and it drops off tomorrow's email. Recipients are managed on the Admin page.</div>
  </div></div>`
}

// ── Transport (same settings as payslips) ──────────────────────────────
async function sendEmail(to: string[], subject: string, html: string): Promise<void> {
  const from = Deno.env.get('REMINDER_FROM') || Deno.env.get('PAYSLIP_FROM') || Deno.env.get('SMTP_USER') || ''
  if (!from) throw new Error('No sender configured — set REMINDER_FROM (or PAYSLIP_FROM).')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    })
    if (!res.ok) throw new Error(`Resend refused: ${res.status} ${await res.text()}`)
    return
  }
  const host = Deno.env.get('SMTP_HOST'), user = Deno.env.get('SMTP_USER'), pass = Deno.env.get('SMTP_PASS')
  if (!host || !user || !pass) throw new Error('No email transport — set RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS.')
  const client = new SMTPClient({
    connection: {
      hostname: host, port: Number(Deno.env.get('SMTP_PORT') || 465), tls: true,
      auth: { username: user, password: pass },
    },
  })
  try {
    await client.send({ from, to: to.join(', '), subject, content: 'auto', html })
  } finally {
    await client.close()
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // ── Who is asking: the cron job, or an admin pressing "Send now"? ────
  const cronSecret = Deno.env.get('CRON_SECRET') ?? ''
  const fromCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
  if (!fromCron) {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: 'Missing authorization' }, 401)
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error } = await caller.auth.getUser()
    if (error || !user) return json({ error: 'Not authenticated' }, 401)
    const { data: prof } = await admin.from('profiles').select('role, active').eq('id', user.id).single()
    if (!prof || !prof.active || !ADMIN_ROLES.includes(prof.role)) return json({ error: 'Admin access required' }, 403)
  }

  // ── Settings ─────────────────────────────────────────────────────────
  const conf = async <T>(key: string, fallback: T): Promise<T> => {
    const { data } = await admin.from('app_config').select('value').eq('key', key).maybeSingle()
    return (data?.value as T) ?? fallback
  }
  const rc = await conf<{ enabled?: boolean; recipients?: string[] }>('reminder_config', {})
  const recipients = (rc.recipients ?? []).map((r) => String(r).trim()).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))
  if (!recipients.length) return json({ sent: [], note: 'No recipients configured — set them on the Admin page.' })
  if (rc.enabled === false && fromCron) return json({ sent: [], note: 'Reminders are switched off.' })

  const today = new Date().toISOString().slice(0, 10)
  const licCfg = await conf<{ custom?: { key: string; label: string }[] }>('licensing_config', {})
  const catLabel = (k: string) => LICENSING_LABELS[k] ?? licCfg.custom?.find((c) => c.key === k)?.label ?? k

  // ── Group 1: vehicle licensing ───────────────────────────────────────
  const groups: Group[] = []
  {
    const { data } = await admin.from('documents')
      .select('category, entity_type, entity_label, branch, expiry_date, superseded')
      .eq('superseded', false).neq('expiry_date', '')
    const items: Item[] = []
    const library: Item[] = []
    for (const d of data ?? []) {
      const days = daysUntil(d.expiry_date, today)
      if (!Number.isFinite(days) || days > WARN_DAYS) continue
      const item = { what: catLabel(d.category), who: d.entity_label || '—', branch: d.branch, expiry: d.expiry_date, days }
      if (d.entity_type === 'vehicle') items.push(item)
      else if (d.entity_type !== 'driver') library.push(item) // driver docs ride with group 2's data below
    }
    groups.push({ key: 'vehicles', title: 'Vehicle licensing — expired & expiring', items })
    groups.push({ key: 'library', title: 'Contracts & company documents — expired & expiring', items: library })
  }

  // ── Group 2: driver credentials ──────────────────────────────────────
  {
    const items: Item[] = []
    const { data: drivers } = await admin.from('drivers')
      .select('full_name, branch, licence_expiry, psv_expiry, status').eq('status', 'active')
    for (const d of drivers ?? []) {
      for (const [what, exp] of [['Driving licence', d.licence_expiry], ['PSV licence', d.psv_expiry]] as const) {
        if (!exp) continue
        const days = daysUntil(exp, today)
        if (Number.isFinite(days) && days <= WARN_DAYS) items.push({ what, who: d.full_name, branch: d.branch, expiry: exp, days })
      }
    }
    for (const table of ['safety_compliance', 'safety_training'] as const) {
      const { data } = await admin.from(table).select('driver_name, branch, category, expiry').neq('expiry', '')
      for (const c of data ?? []) {
        const days = daysUntil(c.expiry, today)
        if (Number.isFinite(days) && days <= WARN_DAYS) {
          items.push({ what: `${c.category || (table === 'safety_training' ? 'Training' : 'Compliance')}`, who: c.driver_name, branch: c.branch, expiry: c.expiry, days })
        }
      }
    }
    groups.push({ key: 'drivers', title: 'Driver credentials — expired & expiring', items })
  }

  // ── Group 3 addition: employment contracts (HR files in app_config) ──
  {
    const files = await conf<Record<string, { contracts?: { person_name: string; name: string; branch: string; expiry: string }[] }>>('employee_files', {})
    const lib = groups.find((g) => g.key === 'library')!
    for (const f of Object.values(files)) {
      for (const c of f.contracts ?? []) {
        if (!c.expiry) continue
        const days = daysUntil(c.expiry, today)
        if (Number.isFinite(days) && days <= WARN_DAYS) {
          lib.items.push({ what: `Contract — ${c.name || 'employment'}`, who: c.person_name, branch: c.branch, expiry: c.expiry, days })
        }
      }
    }
  }

  // ── Send: one email per group that has anything to say ───────────────
  const sent: { group: string; expired: number; expiring: number }[] = []
  const errors: string[] = []
  for (const g of groups) {
    if (!g.items.length) continue
    const expired = g.items.filter((i) => i.days < 0).length
    const expiring = g.items.length - expired
    const subject = `${g.title.split(' — ')[0]}: ${expired ? `${expired} expired` : ''}${expired && expiring ? ', ' : ''}${expiring ? `${expiring} expiring` : ''} — INZU Workstation`
    try {
      await sendEmail(recipients, subject, emailHtml(g, today))
      sent.push({ group: g.key, expired, expiring })
    } catch (e) {
      errors.push(`${g.key}: ${(e as Error).message}`)
    }
  }
  return json({ sent, recipients: recipients.length, ...(errors.length ? { errors } : {}), note: sent.length ? undefined : 'Nothing needs attention today — no email sent.' })
})
