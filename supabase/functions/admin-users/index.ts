// ===========================================================================
// admin-users — privileged user management, run on Supabase's servers.
//
// This is the ONLY place the service_role key is used. The browser never sees
// it. Every call is verified to come from an active administrator before any
// action runs.
//
// Actions (POST JSON body { action, ... }):
//   create        { email, full_name, role, branch, username?, extra_branches?,
//                   perm_overrides?, hidden_pages?, is_employee?, employee_id?, password? }
//                 → creates the auth user with a temp password + must_change flag,
//                   returns { user_id, temp_password }
//   reset_password{ user_id, password? } → sets a temp password + must_change flag,
//                   returns { temp_password }
//   set_active    { user_id, active } → bans/unbans + flips profile.active
//   delete        { user_id } → deletes the auth user (cascades to profile)
//
// Deploy:  supabase functions deploy admin-users
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
//          injected automatically for deployed functions.
// ===========================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// Readable but strong temporary password.
function tempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digit = '23456789'
  const sym = '!@#$%&*?'
  const all = upper + lower + digit + sym
  const pick = (set: string, n: number) => {
    const out: string[] = []
    const r = new Uint32Array(n)
    crypto.getRandomValues(r)
    for (let i = 0; i < n; i++) out.push(set[r[i] % set.length])
    return out
  }
  const chars = [...pick(upper, 2), ...pick(lower, 4), ...pick(digit, 3), ...pick(sym, 1), ...pick(all, 4)]
  // shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * (i + 1))
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
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

  // 2) Verify the caller is an active administrator (using the service client).
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: prof } = await admin.from('profiles').select('role, active').eq('id', user.id).single()
  if (!prof || prof.role !== 'administrator' || !prof.active) return json({ error: 'Administrator access required' }, 403)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const action = String(body.action ?? '')

  try {
    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase()
      if (!email) return json({ error: 'Email is required' }, 400)
      const pw = (body.password as string) || tempPassword()
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: pw,
        email_confirm: true,
        user_metadata: {
          full_name: body.full_name ?? '',
          role: body.role ?? 'viewer',
          branch: body.branch ?? 'trident',
          username: body.username ?? email.split('@')[0],
          must_change_password: true,
          created_by: user.email,
        },
      })
      if (error) return json({ error: error.message }, 400)
      const id = data.user!.id
      // Apply the richer fields the trigger doesn't set.
      await admin.from('profiles').update({
        extra_branches: body.extra_branches ?? [],
        perm_overrides: body.perm_overrides ?? {},
        hidden_pages: body.hidden_pages ?? [],
        is_employee: !!body.is_employee,
        employee_id: body.employee_id ?? '',
      }).eq('id', id)
      return json({ user_id: id, temp_password: pw })
    }

    if (action === 'reset_password') {
      const userId = String(body.user_id ?? '')
      if (!userId) return json({ error: 'user_id is required' }, 400)
      const pw = (body.password as string) || tempPassword()
      const { error } = await admin.auth.admin.updateUserById(userId, { password: pw })
      if (error) return json({ error: error.message }, 400)
      await admin.from('profiles').update({ must_change_password: true }).eq('id', userId)
      return json({ temp_password: pw })
    }

    if (action === 'set_active') {
      const userId = String(body.user_id ?? '')
      const active = !!body.active
      if (!userId) return json({ error: 'user_id is required' }, 400)
      // Ban the auth account when deactivating so they can't sign in at all.
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '87600h' })
      if (error) return json({ error: error.message }, 400)
      await admin.from('profiles').update({ active }).eq('id', userId)
      return json({ ok: true })
    }

    if (action === 'delete') {
      const userId = String(body.user_id ?? '')
      if (!userId) return json({ error: 'user_id is required' }, 400)
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
