-- ===========================================================================
-- INZU Workstation — data tables, phase 2: Drivers, HR, Operations, Documents.
-- Columns mirror the app's TypeScript records 1:1. Run after 0002. Idempotent.
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

-- Apply the standard "any signed-in user" policy + realtime to a table.
create or replace function public._secure_table(tbl text)
returns void language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', tbl);
  execute format('drop policy if exists "%s_rw" on public.%I', tbl, tbl);
  execute format('create policy "%s_rw" on public.%I for all to authenticated using (true) with check (true)', tbl, tbl);
  perform public._add_to_realtime(tbl);
end; $$;

-- ── Drivers ─────────────────────────────────────────────────────────────────
create table if not exists public.drivers (
  id text primary key,
  employee_no text default '',
  full_name text default '',
  branch text not null,
  phone text default '',
  licence_no text default '',
  licence_class text default '',
  licence_expiry text default '',
  psv_expiry text default '',
  date_hired text default '',
  crew text default 'A',
  section text default '',
  status text default 'active',
  schedule_anchor text,
  overtime boolean default false,
  photo_file_id text default '',
  notes text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('drivers');

-- ── HR employees ────────────────────────────────────────────────────────────
create table if not exists public.employees (
  id text primary key,
  branch text not null,
  employee_no text default '',
  full_name text default '',
  job_role text default 'Other',
  status text default 'active',
  phone text default '',
  hod text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('employees');

-- ── Operations: route library ───────────────────────────────────────────────
create table if not exists public.op_routes (
  id text primary key,
  branch text not null,
  name text default '',
  code text default '',
  distance_km integer default 0,
  notes text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('op_routes');

-- ── Operations: bus allocation (actuals) ────────────────────────────────────
create table if not exists public.op_allocations (
  id text primary key,
  branch text not null,
  date text default '',
  trip_type text default 'pickup',
  driver_name text default '',
  fleet_no text default '',
  reg_no text default '',
  route_id text default '',
  location text default '',
  departure_time text default '',
  passengers integer,
  planned_km integer default 0,
  notes text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('op_allocations');

-- ── Operations: mileage (actual km) ─────────────────────────────────────────
create table if not exists public.op_mileage (
  id text primary key,
  branch text not null,
  date text default '',
  vehicle_id text default '',
  vehicle_label text default '',
  driver_id text default '',
  driver_name text default '',
  actual_km integer default 0,
  status text default 'pending',
  approved_by text default '',
  approved_at text default '',
  notes text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('op_mileage');

-- ── Operations: daily plan (intended movements) ─────────────────────────────
create table if not exists public.op_daily_plan (
  id text primary key,
  branch text not null,
  date text default '',
  trip_type text default 'pickup',
  driver_name text default '',
  fleet_no text default '',
  reg_no text default '',
  from_location text default '',
  to_location text default '',
  departure_time text default '',
  notes text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('op_daily_plan');

-- ── Operations: weekly driver↔vehicle assignment ────────────────────────────
create table if not exists public.op_weekly_assign (
  id text primary key,
  branch text not null,
  week_start text default '',
  week_end text default '',
  cover_start text,
  cover_end text,
  fleet_no text default '',
  driver_id text default '',
  driver_name text default '',
  overtime boolean default false,
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('op_weekly_assign');

-- ── Documents (library records; the files live in Storage) ───────────────────
create table if not exists public.documents (
  id text primary key,
  category text default 'other',
  title text,
  entity_type text default 'general',
  entity_id text default '',
  entity_label text default '',
  branch text not null,
  issue_date text default '',
  expiry_date text default '',
  reference_no text default '',
  issuer text default '',
  file_id text default '',
  file_name text default '',
  file_size integer default 0,
  mime_type text default '',
  version integer default 1,
  superseded boolean default false,
  notes text default '',
  uploaded_by text default '',
  uploaded_by_role text default '',
  uploaded_at text default '',
  doc_type text,
  department text,
  owner text,
  tags jsonb default '[]'::jsonb,
  review_date text,
  all_branches boolean default false,
  approval_status text default 'approved',
  audit jsonb default '[]'::jsonb,
  visibility text default 'public',
  owner_id text default '',
  shared_with jsonb default '[]'::jsonb
);
select public._secure_table('documents');
