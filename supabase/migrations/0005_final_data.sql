-- ===========================================================================
-- INZU Workstation — data tables, phase 4 (final): Mileage module, payroll
-- deductions, report recipients, and the app_config settings table.
-- Run after 0004. Idempotent.
-- ===========================================================================

create or replace function public._add_to_realtime(tbl text)
returns void language plpgsql as $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl
  ) then
    execute format('alter publication supabase_realtime add table public.%I', tbl);
  end if;
end; $$;

create or replace function public._secure_table(tbl text)
returns void language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', tbl);
  execute format('drop policy if exists "%s_rw" on public.%I', tbl, tbl);
  execute format('create policy "%s_rw" on public.%I for all to authenticated using (true) with check (true)', tbl, tbl);
  perform public._add_to_realtime(tbl);
end; $$;

-- ── Mileage: route catalogue (FQM billing) ───────────────────────────────────
create table if not exists public.mileage_routes (
  id text primary key,
  branch text not null,
  project text default '',
  name text default '',
  internal_km integer default 0,
  external_km integer default 0,
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('mileage_routes');

-- ── Mileage: per-vehicle movement log ────────────────────────────────────────
create table if not exists public.mileage_trips (
  id text primary key,
  branch text not null,
  project text default '',
  date text default '',
  fleet_no text default '',
  vehicle_reg text default '',
  seat_class text default '',
  shift text default '',
  route text default '',
  internal_km integer default 0,
  external_km integer default 0,
  edited_by text,
  edited_at text,
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('mileage_trips');

-- ── Payroll deductions (incident fines) ──────────────────────────────────────
create table if not exists public.payroll_deductions (
  id text primary key,
  branch text not null,
  driver_id text default '',
  driver_name text default '',
  amount numeric default 0,
  reason text default '',
  incident_id text default '',
  date text default '',
  status text default 'pending',
  created_by text default '',
  created_at text default ''
);
select public._secure_table('payroll_deductions');

-- ── Report recipient list ────────────────────────────────────────────────────
create table if not exists public.report_recipients (
  id text primary key,
  name text default '',
  email text default ''
);
select public._secure_table('report_recipients');

-- ── App settings (one jsonb row per setting key) ─────────────────────────────
-- Holds role permissions, branding, approval chains, fuel/mileage rates, the
-- safety class catalogue, and messaging — each as a single jsonb blob.
create table if not exists public.app_config (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);
select public._secure_table('app_config');
