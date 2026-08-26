// Daily attention digests — one email per KIND of thing PER BRANCH, never one
// per item. Licensing is grouped item by item (Road Tax, then Fitness…), items
// with anything expired are tagged IMPORTANT, and an email containing anything
// overdue is sent high-priority with an "Important:" subject.
//
// What goes out is chosen on the Admin page (app_config 'reminder_config'):
// each category below can be switched on/off, and categories of the same
// nature travel together in ONE email:
//
//   Vehicles & workshop  — vehicle_licensing    licensing expiries (fitness, road tax…)
//                          vehicle_inspections  monthly inspections overdue / not scheduled
//                          vehicle_service      services (PM) due by date or km
//                          workshop_spares      critical spares below minimum
//   Driver credentials   — driver_licences      driving licence & PSV expiries
//                          safety_certs         safety compliance & training expiries
//   Contracts & documents— employee_contracts   employment contract expiries
//                          company_documents    library documents with an expiry
//   Operations snapshot  — fuel_summary         depot fuel stock: days left, burn rate
//
// A category key missing from the config means ON. An email is only sent when
// at least one of its enabled categories has something to say (the fuel
// snapshot always has something to say — it is a summary, not an alert).
//
// Called two ways:
//   - by pg_cron every morning (header x-cron-secret must match CRON_SECRET);
//   - from the Admin page's "Send now" button (a signed-in admin's JWT).
//
// Deploy:   supabase functions deploy daily-reminders   (or paste into the
//           dashboard's Edge Function editor with "Verify JWT" switched OFF —
//           this function does its own auth)
// Secrets:  CRON_SECRET, plus a transport: RESEND_API_KEY or
//           SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS; sender = REMINDER_FROM
//           (falls back to PAYSLIP_FROM, then SMTP_USER)
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
const PM_SOON_KM = 1000 // mirror lib/workshop/types.ts
const PM_SOON_DAYS = 14

// The four built-in licensing categories; custom ones come from licensing_config.
const LICENSING_LABELS: Record<string, string> = {
  road_tax: 'Road Tax', fitness: 'Fitness Certificate', insurance: 'Insurance', fqm_inspection: 'FQM Inspection',
}
const BRANCH_LABEL: Record<string, string> = { trident: 'Trident (Kalumbila)', kansanshi: 'Kansanshi (Solwezi)' }
const branchName = (b: string) => BRANCH_LABEL[b] ?? b

// One line in a digest table. `tone` decides which table it lands in:
// red = act now (overdue / out of stock), amber = coming up / needs scheduling.
// Every email covers ONE branch — rows are split by `branch` at send time.
interface Row { what: string; who: string; branch: string; when: string; status: string; tone: 'red' | 'amber'; sort: number }
// groupBy 'what' renders the section as one block per item (Road Tax, Fitness…),
// each with its own expired + expiring tables and an IMPORTANT tag when overdue.
interface Section { key: string; title: string; rows: Row[]; groupBy?: 'what' }

const DAY = 86_400_000
const daysUntil = (iso: string, today: string) =>
  Math.round((new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / DAY)

const fmtDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
const monthEndOf = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Turn an expiry date into a digest row, or null if it is fine (> WARN_DAYS out). */
function expiryRow(what: string, who: string, branch: string, expiry: string, today: string): Row | null {
  const days = daysUntil(expiry, today)
  if (!Number.isFinite(days) || days > WARN_DAYS) return null
  const status = days < 0 ? `${plural(-days, 'day')} overdue` : days === 0 ? 'expires today' : `${plural(days, 'day')} left`
  return { what, who, branch, when: fmtDate(expiry), status, tone: days < 0 ? 'red' : 'amber', sort: days }
}

// ── The email body ─────────────────────────────────────────────────────
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

function tableOf(rows: Row[], tone: 'red' | 'amber', showItem = true): string {
  const colour = tone === 'red' ? '#B3261E' : '#8a6d10'
  const body = rows.map((r) => `<tr>
    ${showItem ? `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(r.what)}</td>` : ''}
    <td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${esc(r.who)}</b></td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(r.when)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${colour};font-weight:bold">${esc(r.status)}</td>
  </tr>`).join('')
  return `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:6px 0 16px">
    <tr style="background:#0F1B33;color:#fff;text-align:left">
      ${showItem ? '<th style="padding:7px 10px">Item</th>' : ''}<th style="padding:7px 10px">For</th>
      <th style="padding:7px 10px">Due</th><th style="padding:7px 10px">Status</th>
    </tr>${body}</table>`
}

const IMPORTANT_TAG = '<span style="background:#B3261E;color:#fff;font-size:10px;font-weight:bold;letter-spacing:.5px;padding:2px 8px;border-radius:99px;vertical-align:middle;margin-left:8px">IMPORTANT</span>'

function pairOf(rows: Row[], showItem: boolean): string {
  const red = rows.filter((r) => r.tone === 'red').sort((a, b) => a.sort - b.sort)
  const amber = rows.filter((r) => r.tone === 'amber').sort((a, b) => a.sort - b.sort)
  return `${red.length ? `<div style="font-weight:bold;color:#B3261E;font-size:12px;margin:4px 0 2px">Needs action now (${red.length})</div>${tableOf(red, 'red', showItem)}` : ''}
    ${amber.length ? `<div style="font-weight:bold;color:#8a6d10;font-size:12px;margin:4px 0 2px">Coming up (${amber.length})</div>${tableOf(amber, 'amber', showItem)}` : ''}`
}

function sectionHtml(s: Section): string {
  if (!s.rows.length) return ''
  const head = `<div style="font-size:14px;font-weight:bold;margin:14px 0 2px">${esc(s.title)}</div>`
  if (s.groupBy !== 'what') return head + pairOf(s.rows, true)
  // One block per item — Road Tax on its own, then Fitness, and so on — the
  // items with anything already expired first, tagged IMPORTANT.
  const byItem = new Map<string, Row[]>()
  for (const r of s.rows) {
    const list = byItem.get(r.what) ?? []
    if (!list.length) byItem.set(r.what, list)
    list.push(r)
  }
  const blocks = [...byItem.entries()].sort((a, b) => {
    const ia = a[1].some((r) => r.tone === 'red') ? 0 : 1
    const ib = b[1].some((r) => r.tone === 'red') ? 0 : 1
    return ia - ib || Math.min(...a[1].map((r) => r.sort)) - Math.min(...b[1].map((r) => r.sort))
  })
  return head + blocks.map(([what, rows]) =>
    `<div style="font-size:13px;font-weight:bold;margin:10px 0 2px">${esc(what)} (${rows.length})${rows.some((r) => r.tone === 'red') ? IMPORTANT_TAG : ''}</div>${pairOf(rows, false)}`
  ).join('')
}

function wrapEmail(title: string, today: string, inner: string, siteUrl: string): string {
  const open = siteUrl
    ? `<div style="margin-top:14px"><a href="${esc(siteUrl)}" style="display:inline-block;background:#0F1B33;color:#fff;text-decoration:none;font-size:13px;font-weight:bold;padding:9px 16px;border-radius:8px">Open INZU Workstation</a>
       <div style="font-size:11px;color:#6b7280;margin-top:6px">Log in to see the full details and who is responsible for each item.</div></div>`
    : ''
  return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#0F1B33;max-width:720px">
  <div style="background:#0F1B33;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0">
    <div style="font-size:16px;font-weight:bold">${esc(title)}</div>
    <div style="font-size:12px;opacity:.75">INZU Workstation daily reminder · ${esc(fmtDate(today))}</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:8px 18px 16px;border-radius:0 0 8px 8px">
    ${inner}${open}
    <div style="font-size:11px;color:#6b7280;margin-top:10px">Sent automatically every morning. Update the item in the Workstation and it drops off tomorrow's email. What is included, and who receives it, is managed on the Admin page (Scheduling tab).</div>
  </div></div>`
}

// ── Transport ──────────────────────────────────────────────────────────
// `important` marks the email high-priority (the "!" in Outlook/Gmail) — used
// whenever anything in it is already overdue, or fuel is critically low.
async function sendEmail(to: string[], subject: string, html: string, important = false): Promise<void> {
  const from = Deno.env.get('REMINDER_FROM') || Deno.env.get('PAYSLIP_FROM') || Deno.env.get('SMTP_USER') || ''
  if (!from) throw new Error('No sender configured — set REMINDER_FROM (or SMTP_USER).')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, ...(important ? { headers: { 'X-Priority': '1', Importance: 'high' } } : {}) }),
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
    await client.send({ from, to: to.join(', '), subject, content: 'auto', html, ...(important ? { priority: 'high' as const } : {}) })
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
  const rc = await conf<{ enabled?: boolean; user_ids?: string[]; recipients?: string[]; categories?: Record<string, boolean>; site_url?: string }>('reminder_config', {})
  // The mailing list is Workstation users (resolved to their account email at
  // send time, so address changes follow automatically) plus any extra typed
  // addresses for people without an account. Emails are BRANCH-SCOPED: a user
  // receives only the digests for the branches they belong to (their branch +
  // any extra branches), while cross-branch roles — MD, directors, board,
  // administrator, HR manager — receive every branch. Typed extras receive all.
  const CROSS_BRANCH_ROLES = new Set(['administrator', 'board_chairman', 'board_member', 'managing_director', 'finance_director', 'hr_manager'])
  const isEmail = (r: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)
  const extras = [...new Set((rc.recipients ?? []).map((r) => String(r).trim().toLowerCase()).filter(isEmail))]
  const scoped: { email: string; all: boolean; branches: string[] }[] = []
  if (rc.user_ids?.length) {
    const { data: users } = await admin.from('profiles').select('email, active, role, branch, extra_branches').in('id', rc.user_ids)
    for (const u of users ?? []) {
      const e = String(u.email ?? '').trim().toLowerCase()
      if (!u.active || !isEmail(e)) continue
      scoped.push({ email: e, all: CROSS_BRANCH_ROLES.has(u.role), branches: [u.branch, ...(u.extra_branches ?? [])].filter(Boolean) })
    }
  }
  const recipientsFor = (branch: string): string[] =>
    [...new Set([...extras, ...scoped.filter((u) => u.all || u.branches.includes(branch)).map((u) => u.email)])]
  const everyone = [...new Set([...extras, ...scoped.map((u) => u.email)])]
  if (!everyone.length) return json({ sent: [], note: 'No recipients configured — pick users on the Admin page.' })
  if (rc.enabled === false && fromCron) return json({ sent: [], note: 'Reminders are switched off.' })
  const siteUrl = String(rc.site_url ?? '').replace(/\/+$/, '')
  const on = (key: string) => rc.categories?.[key] !== false // missing = on

  const today = new Date().toISOString().slice(0, 10)
  const thisMonth = today.slice(0, 7)
  const errors: string[] = []
  const guard = async (label: string, fn: () => Promise<void>) => {
    try { await fn() } catch (e) { errors.push(`${label}: ${(e as Error).message}`) }
  }
  // Supabase caps a select at 1000 rows — page through anything that can grow.
  async function pageAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await query(from, from + 999)
      if (error) throw new Error(error.message)
      out.push(...(data ?? []))
      if (!data || data.length < 1000) return out
    }
  }

  const licCfg = await conf<{ custom?: { key: string; label: string }[] }>('licensing_config', {})
  const catLabel = (k: string) => LICENSING_LABELS[k] ?? licCfg.custom?.find((c) => c.key === k)?.label ?? k

  // Shared lookups, fetched once and only when an enabled category needs them.
  interface Veh { fleet_no: string; reg_plate: string; branch: string; status: string }
  let vehicles: Veh[] = []
  if (on('vehicle_inspections') || on('vehicle_service')) {
    const { data, error } = await admin.from('vehicles').select('fleet_no, reg_plate, branch, status')
    if (error) errors.push(`vehicles: ${error.message}`)
    vehicles = ((data ?? []) as Veh[]).filter((v) => v.status !== 'grounded') // grounded buses sit out, like the app
  }
  interface Iss { branch: string; date: string; fleet_no: string; liters_given: number; opening_mileage: number; closing_mileage: number }
  let issuances: Iss[] = []
  if (on('fuel_summary') || on('vehicle_service')) {
    await guard('fuel_issuances', async () => {
      issuances = await pageAll<Iss>((a, b) =>
        admin.from('fuel_issuances').select('branch, date, fleet_no, liters_given, opening_mileage, closing_mileage').range(a, b))
    })
  }

  // ── Sections, grouped into emails by nature ──────────────────────────
  const sections: Record<string, Section> = {}
  const put = (key: string, title: string, rows: Row[], groupBy?: 'what') => { sections[key] = { key, title, rows, groupBy } }

  // Licensing + library documents (one table read covers both categories).
  if (on('vehicle_licensing') || on('company_documents')) {
    await guard('documents', async () => {
      const docs = await pageAll<{ category: string; entity_type: string; entity_label: string; branch: string; expiry_date: string }>((a, b) =>
        admin.from('documents').select('category, entity_type, entity_label, branch, expiry_date')
          .eq('superseded', false).neq('expiry_date', '').range(a, b))
      const lic: Row[] = [], lib: Row[] = []
      for (const d of docs) {
        const row = expiryRow(catLabel(d.category), d.entity_label || '—', d.branch, d.expiry_date, today)
        if (!row) continue
        if (d.entity_type === 'vehicle') lic.push(row)
        else if (d.entity_type !== 'driver') lib.push(row) // driver docs are covered by the drivers group
      }
      if (on('vehicle_licensing')) put('vehicle_licensing', 'Licensing — expired & expiring', lic, 'what')
      if (on('company_documents')) put('company_documents', 'Company & library documents', lib)
    })
  }

  // Monthly workshop inspections — every non-grounded bus, once a calendar month.
  if (on('vehicle_inspections')) {
    await guard('inspections', async () => {
      const insps = await conf<{ branch: string; month: string; fleet_no: string; scheduled_date: string; status: string }[]>('workshop_inspections', [])
      const byFleet = new Map<string, { scheduled_date: string; status: string }>()
      for (const i of insps) {
        if (i.month !== thisMonth) continue
        const cur = byFleet.get(`${i.branch}|${i.fleet_no}`)
        if (!cur || i.status === 'done') byFleet.set(`${i.branch}|${i.fleet_no}`, i)
      }
      const rows: Row[] = []
      const monthEnd = monthEndOf(thisMonth)
      for (const v of vehicles) {
        const insp = byFleet.get(`${v.branch}|${v.fleet_no}`)
        if (insp?.status === 'done') continue
        const due = insp?.scheduled_date || monthEnd
        const days = daysUntil(due, today)
        if (days < 0) rows.push({ what: 'Monthly inspection', who: v.fleet_no, branch: v.branch, when: fmtDate(due), status: `${plural(-days, 'day')} overdue`, tone: 'red', sort: days })
        else if (insp && days === 0) rows.push({ what: 'Monthly inspection', who: v.fleet_no, branch: v.branch, when: fmtDate(due), status: 'due today', tone: 'amber', sort: 0 })
        else if (!insp) rows.push({ what: 'Monthly inspection', who: v.fleet_no, branch: v.branch, when: fmtDate(due), status: `not scheduled · ${plural(days, 'day')} left in the month`, tone: 'amber', sort: days })
        // scheduled for a future date = the plan is working; nothing to say
      }
      put('vehicle_inspections', 'Monthly inspections — not done', rows)
    })
  }

  // Services (PM) — due by time OR distance, whichever is closer (mirrors the app).
  if (on('vehicle_service')) {
    await guard('services', async () => {
      interface PmCfg { interval_days: number; interval_km: number; last_service_date: string; last_service_odo: number }
      const pm = await conf<Record<string, PmCfg>>('workshop_pm', {})
      const latestOdo = new Map<string, number>()
      for (const i of issuances) {
        const o = Math.max(i.opening_mileage || 0, i.closing_mileage || 0)
        if (o > (latestOdo.get(i.fleet_no) ?? 0)) latestOdo.set(i.fleet_no, o)
      }
      const rows: Row[] = []
      for (const v of vehicles) {
        const cfg = pm[v.fleet_no]
        if (!cfg) continue
        const odo = latestOdo.get(v.fleet_no) ?? null
        const hasKm = (cfg.interval_km || 0) > 0 && (cfg.last_service_odo || 0) > 0 && odo != null
        const hasDays = (cfg.interval_days || 0) > 0 && !!cfg.last_service_date
        if (!hasKm && !hasDays) continue
        let kmLeft: number | null = null, dueOdo = 0
        if (hasKm) { dueOdo = cfg.last_service_odo + cfg.interval_km; kmLeft = dueOdo - (odo as number) }
        let daysLeft: number | null = null, dueDate = ''
        if (hasDays) {
          const due = new Date(`${cfg.last_service_date.slice(0, 10)}T00:00:00Z`).getTime() + cfg.interval_days * DAY
          dueDate = new Date(due).toISOString().slice(0, 10)
          daysLeft = Math.round((due - new Date(`${today}T00:00:00Z`).getTime()) / DAY)
        }
        const overdue = (kmLeft != null && kmLeft < 0) || (daysLeft != null && daysLeft < 0)
        const soon = (kmLeft != null && kmLeft <= PM_SOON_KM) || (daysLeft != null && daysLeft <= PM_SOON_DAYS)
        if (!overdue && !soon) continue
        const parts: string[] = []
        if (daysLeft != null && (overdue ? daysLeft < 0 : daysLeft <= PM_SOON_DAYS)) {
          parts.push(daysLeft < 0 ? `${plural(-daysLeft, 'day')} overdue` : daysLeft === 0 ? 'due today' : `${plural(daysLeft, 'day')} left`)
        }
        if (kmLeft != null && (overdue ? kmLeft < 0 : kmLeft <= PM_SOON_KM)) {
          parts.push(kmLeft < 0 ? `${(-kmLeft).toLocaleString()} km over` : `${kmLeft.toLocaleString()} km left`)
        }
        const when = dueDate ? fmtDate(dueDate) : `at ${dueOdo.toLocaleString()} km`
        rows.push({ what: 'Service (PM)', who: v.fleet_no, branch: v.branch, when, status: parts.join(' · '), tone: overdue ? 'red' : 'amber', sort: daysLeft ?? (kmLeft as number) })
      }
      put('vehicle_service', 'Services (PM) — due & overdue', rows)
    })
  }

  // Critical spares at or below their minimum stock.
  if (on('workshop_spares')) {
    await guard('spares', async () => {
      const spares = await conf<{ branch: string; name: string; part_no: string; qty: number; min_qty: number; unit: string }[]>('workshop_spares', [])
      const rows: Row[] = spares
        .filter((s) => (s.qty ?? 0) <= (s.min_qty ?? 0))
        .map((s) => ({
          what: s.name, who: s.part_no || '—', branch: s.branch, when: '—',
          status: `${s.qty}${s.unit ? ` ${s.unit}` : ''} left · minimum ${s.min_qty}`,
          tone: (s.qty ?? 0) <= 0 ? 'red' as const : 'amber' as const, sort: (s.qty ?? 0) - (s.min_qty ?? 0),
        }))
      put('workshop_spares', 'Critical spares below minimum', rows)
    })
  }

  // Driver licences & PSV.
  if (on('driver_licences')) {
    await guard('drivers', async () => {
      const { data, error } = await admin.from('drivers')
        .select('full_name, branch, licence_expiry, psv_expiry, status').eq('status', 'active')
      if (error) throw new Error(error.message)
      const rows: Row[] = []
      for (const d of data ?? []) {
        for (const [what, exp] of [['Driving licence', d.licence_expiry], ['PSV licence', d.psv_expiry]] as const) {
          if (!exp) continue
          const row = expiryRow(what, d.full_name, d.branch, exp, today)
          if (row) rows.push(row)
        }
      }
      put('driver_licences', 'Driving licences & PSV', rows)
    })
  }

  // Safety compliance & training certificates.
  if (on('safety_certs')) {
    await guard('safety certificates', async () => {
      const rows: Row[] = []
      for (const table of ['safety_compliance', 'safety_training'] as const) {
        const { data, error } = await admin.from(table).select('driver_name, branch, category, expiry').neq('expiry', '')
        if (error) throw new Error(error.message)
        for (const c of data ?? []) {
          const row = expiryRow(c.category || (table === 'safety_training' ? 'Training' : 'Compliance'), c.driver_name, c.branch, c.expiry, today)
          if (row) rows.push(row)
        }
      }
      put('safety_certs', 'Safety compliance & training', rows)
    })
  }

  // Employment contracts (HR files live in app_config).
  if (on('employee_contracts')) {
    await guard('contracts', async () => {
      const files = await conf<Record<string, { contracts?: { person_name: string; name: string; branch: string; expiry: string }[] }>>('employee_files', {})
      const rows: Row[] = []
      for (const f of Object.values(files)) {
        for (const c of f.contracts ?? []) {
          if (!c.expiry) continue
          const row = expiryRow(`Contract — ${c.name || 'employment'}`, c.person_name, c.branch, c.expiry, today)
          if (row) rows.push(row)
        }
      }
      put('employee_contracts', 'Employment contracts', rows)
    })
  }

  // ── Fuel stock snapshot (one summary email per branch, not an expiry table) ──
  const fuelCards: { branch: string; html: string; daysLeft: number | null }[] = []
  if (on('fuel_summary')) {
    await guard('fuel', async () => {
      interface Rec { branch: string; date: string; litres: number }
      const receipts = await pageAll<Rec>((a, b) => admin.from('fuel_receipts').select('branch, date, litres').range(a, b))
      const { data: draws } = await admin.from('fuel_generator').select('branch, date, litres, status')
      const fuelCfg = await conf<Record<string, { opening_stock: number; dead_stock: number }>>('fuel_config', {})
      const branches = [...new Set([...issuances.map((i) => i.branch), ...receipts.map((r) => r.branch)])].sort()
      for (const b of branches) {
        const iss = issuances.filter((i) => i.branch === b)
        const rec = receipts.filter((r) => r.branch === b)
        const drw = (draws ?? []).filter((g) => g.branch === b && g.status === 'approved')
        const cfg = fuelCfg[b] ?? { opening_stock: 46000, dead_stock: 2000 } // DEFAULT_FUEL_CONFIG
        // Same maths as the app's computeStock: all-time balance, burn rate over
        // the real span of issuance days, days left = usable / burn.
        const issued = iss.reduce((s, i) => s + (i.liters_given || 0), 0) + drw.reduce((s, g) => s + (g.litres || 0), 0)
        const received = rec.reduce((s, r) => s + (r.litres || 0), 0)
        const usable = cfg.opening_stock + received - issued - cfg.dead_stock
        const times = iss.map((i) => new Date(`${i.date}T00:00:00Z`).getTime()).filter((t) => !isNaN(t))
        const span = times.length ? Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / DAY) + 1) : 0
        const burn = span ? issued / span : 0
        const daysLeft = burn > 0 ? Math.max(0, Math.floor(usable / burn)) : null
        const usedThisMonth = iss.filter((i) => i.date.slice(0, 7) === thisMonth).reduce((s, i) => s + (i.liters_given || 0), 0)
          + drw.filter((g) => (g.date || '').slice(0, 7) === thisMonth).reduce((s, g) => s + (g.litres || 0), 0)
        const recvThisMonth = rec.filter((r) => r.date.slice(0, 7) === thisMonth).reduce((s, r) => s + (r.litres || 0), 0)
        const lastRec = rec.slice().sort((x, y) => x.date.localeCompare(y.date)).pop()
        const dColour = daysLeft == null ? '#0F1B33' : daysLeft < 7 ? '#B3261E' : daysLeft < 14 ? '#8a6d10' : '#1b7a3d'
        const cell = (label: string, value: string) =>
          `<td style="padding:8px 12px;border:1px solid #e5e7eb"><div style="font-size:11px;color:#6b7280">${label}</div><div style="font-size:14px;font-weight:bold">${value}</div></td>`
        fuelCards.push({
          branch: b, daysLeft,
          html: `<table style="border-collapse:collapse;font-size:13px;margin-top:12px"><tr>
            <td style="padding:8px 14px;border:1px solid #e5e7eb;text-align:center"><div style="font-size:26px;font-weight:bold;color:${dColour}">${daysLeft == null ? '—' : daysLeft}</div><div style="font-size:11px;color:#6b7280">days of fuel left</div></td>
            ${cell('Usable stock', `${Math.round(usable).toLocaleString()} L`)}
            ${cell('Average burn', burn ? `${Math.round(burn).toLocaleString()} L/day` : '—')}
            ${cell('Used this month', `${Math.round(usedThisMonth).toLocaleString()} L`)}
            ${cell('Received this month', `${Math.round(recvThisMonth).toLocaleString()} L`)}
            ${cell('Last delivery', lastRec ? `${Math.round(lastRec.litres).toLocaleString()} L · ${fmtDate(lastRec.date)}` : '—')}
          </tr></table>`,
        })
      }
    })
  }

  // ── One email per nature PER BRANCH that has anything to say ─────────
  const GROUPS: { key: string; title: string; sections: string[] }[] = [
    { key: 'vehicles', title: 'Vehicles & workshop', sections: ['vehicle_licensing', 'vehicle_inspections', 'vehicle_service', 'workshop_spares'] },
    { key: 'drivers', title: 'Driver credentials', sections: ['driver_licences', 'safety_certs'] },
    { key: 'library', title: 'Contracts & company documents', sections: ['employee_contracts', 'company_documents'] },
  ]
  const sent: { group: string; title: string; red: number; amber: number }[] = []
  for (const g of GROUPS) {
    const secs = g.sections.map((k) => sections[k]).filter((s) => s && s.rows.length) as Section[]
    if (!secs.length) continue
    const branches = [...new Set(secs.flatMap((s) => s.rows.map((r) => r.branch || '—')))].sort()
    for (const b of branches) {
      const bSecs = secs
        .map((s) => ({ ...s, rows: s.rows.filter((r) => (r.branch || '—') === b) }))
        .filter((s) => s.rows.length)
      const red = bSecs.reduce((n, s) => n + s.rows.filter((r) => r.tone === 'red').length, 0)
      const amber = bSecs.reduce((n, s) => n + s.rows.filter((r) => r.tone === 'amber').length, 0)
      const to = recipientsFor(b)
      if (!to.length) continue // nobody on the list belongs to this branch
      const title = `${g.title} — ${branchName(b)}`
      const subject = `${red ? 'Important: ' : ''}${title}: ${red ? `${red} overdue` : ''}${red && amber ? ', ' : ''}${amber ? `${amber} coming up` : ''} — INZU Workstation`
      try {
        await sendEmail(to, subject, wrapEmail(title, today, bSecs.map(sectionHtml).join(''), siteUrl), red > 0)
        sent.push({ group: g.key, title, red, amber })
      } catch (e) {
        errors.push(`${g.key} (${b}): ${(e as Error).message}`)
      }
    }
  }
  for (const f of fuelCards) {
    const to = recipientsFor(f.branch)
    if (!to.length) continue
    const low = f.daysLeft != null && f.daysLeft < 7
    const title = `Fuel stock — ${branchName(f.branch)}`
    const subject = `${low ? 'Important: ' : ''}${title}: ${f.daysLeft == null ? 'no burn rate yet' : plural(f.daysLeft, 'day')} left — INZU Workstation`
    try {
      await sendEmail(to, subject, wrapEmail(title, today, f.html, siteUrl), low)
      sent.push({ group: 'operations', title, red: 0, amber: 0 })
    } catch (e) {
      errors.push(`fuel (${f.branch}): ${(e as Error).message}`)
    }
  }
  return json({
    sent, recipients: everyone.length,
    ...(errors.length ? { errors } : {}),
    note: sent.length ? undefined : 'Nothing needs attention today — no email sent.',
  })
})
