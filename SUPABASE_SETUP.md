# Supabase setup — INZU Workstation

This is the one-time setup that turns the app's storage from "in your browser" into
a real, secure, shared backend: passwords hashed by Supabase Auth, access enforced
by the database (Row-Level Security), and files kept in durable cloud storage.

Do these steps once. They unblock the app wiring (auth → files → data) that follows.

---

## 1. Create the project
1. Go to <https://supabase.com> → **New project**.
2. Pick the **region closest to Zambia** (e.g. `eu-central` or `af-south` if offered) for speed.
3. Save the database password somewhere safe.

## 2. Point the app at it
1. In the dashboard: **Project Settings → API**. Copy:
   - **Project URL**
   - **anon / public** key  ← safe for the frontend
2. In the repo: copy `frontend/.env.example` to `frontend/.env` and paste them in:
   ```
   VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
   `.env` is gitignored — it is never committed.
   **Do not** copy the `service_role` key anywhere into the frontend.

## 3. Create the database schema
1. Dashboard → **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) and **Run**.
   This creates the `profiles` table, security rules (RLS), login history, helper
   functions, and the private `documents` storage bucket. It's safe to re-run.

## 4. Create your administrator login
1. Dashboard → **Authentication → Users → Add user**.
   - Email: your admin email (this is now your **login** — email + password).
   - Password: pick a strong one.
   - Tick **Auto Confirm User**.
2. Back in **SQL Editor**, promote that account to administrator:
   ```sql
   update public.profiles
      set role = 'administrator', active = true, must_change_password = false
    where email = 'YOUR-ADMIN-EMAIL@example.com';
   ```

## 5. Deploy the admin Edge Function
This is the secure, server-side function that creates users and resets passwords
(it's the only place the `service_role` key is used — never the browser).

Install the CLI once (<https://supabase.com/docs/guides/cli>), then from the repo root:
```bash
supabase login
supabase link --project-ref YOUR-REF
supabase functions deploy admin-users
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
into deployed functions automatically — you don't set them by hand.

## 5b. Emailing payslips (optional)
Only needed if you want **Payroll → Payslips → Email**. Until this is set up the
Email buttons are there but every send fails with a clear message; everything else
(preview, PDF, Word, Excel) works without it.

Payslips are emailed **one message per employee, each with only their own
attachment** — there is no batch or BCC path, so nobody can receive someone else's
pay details. The mail credentials live only in the function, never in the browser.

```bash
supabase functions deploy send-payslips
```

Then set the mail secrets. **Pick either one** — the function uses whichever it
finds, so you can switch later without a code change.

**Option A — INZU's own mailbox (SMTP).** Payslips arrive from a real INZU address
and there's no new vendor or bill. Use an **app password**, not the account
password (Google/Microsoft both require this when 2FA is on).
```bash
supabase secrets set SMTP_HOST=smtp.gmail.com SMTP_PORT=465 \
  SMTP_USER=payroll@inzumcs.com SMTP_PASS=your-app-password \
  PAYSLIP_FROM="INZU Payroll <payroll@inzumcs.com>"
```
Note most mailboxes cap how many messages you may send per day (Gmail ≈ 500) — fine
for one branch, worth checking before a big run.

**Option B — Resend (email API).** Better deliverability for large runs; free up to
3,000 emails/month. Create an account, verify your domain, then:
```bash
supabase secrets set RESEND_API_KEY=re_xxx \
  PAYSLIP_FROM="INZU Payroll <payroll@yourdomain.com>"
```
`PAYSLIP_FROM` must be on the domain you verified, or Resend rejects the send.

Optional, either way — a copy of every payslip to an archive mailbox:
```bash
supabase secrets set PAYSLIP_BCC=payroll-archive@inzumcs.com
```

Only active users with a payroll role (administrator, payroll officer, HR manager,
Ops manager, MD) can send; the function re-checks this server-side, so it can't be
bypassed from the browser.

## 6. Run the app
```bash
cd frontend
npm install
npm run dev
```
With `.env` present the app uses Supabase; sign in with your admin **email + password**.
(Without `.env` it falls back to the old local mode, so nothing breaks mid-setup.)

---

## How the security model works
- **Passwords**: handled by Supabase Auth, hashed with bcrypt server-side. The app
  never stores or sees them. Login is **email + password**.
- **First login / resets**: admin-created accounts (and admin resets) get a one-time
  password and a `must_change_password` flag; the app forces a new password before
  letting them in.
- **Authorisation**: Row-Level Security in Postgres decides what each signed-in user
  can read/write — enforced by the database, not just the UI.
- **Privileged actions**: creating users, resetting passwords, deactivating accounts
  run only inside the `admin-users` Edge Function, which first verifies the caller is
  an active administrator.
- **Files**: stored in the private `documents` bucket and opened via short-lived
  signed URLs. Each document version is a separate object — files are never
  overwritten, so nothing goes missing. (Enable **Point-in-Time Recovery** on the
  database under Settings → Add-ons for extra safety.)

## What's next (the app wiring)
Once the above is done, the app gets wired onto this backend in order, each piece
verified before the next:
1. **Auth** — email/password login, forced first-login password change, admin reset.
2. **Files** — uploads move to the `documents` bucket.
3. **Data** — each module's records move into Postgres tables (with RLS) on a shared
   sync layer, so data is live across all users and devices.

Your existing in-browser data stays untouched as a fallback until each piece is
confirmed working.
