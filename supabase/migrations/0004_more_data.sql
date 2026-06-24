-- ===========================================================================
-- INZU Workstation — data tables, phase 3: Speed, Safety, Fuel.
-- Columns mirror the app's TypeScript records 1:1. Run after 0003. Idempotent.
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

-- ── Speed events ─────────────────────────────────────────────────────────────
create table if not exists public.speed_events (
  id text primary key,
  branch text not null,
  event_datetime text default '',
  driver_id text default '',
  driver_name text default '',
  vehicle_id text default '',
  vehicle_label text default '',
  route text default '',
  recorded_speed integer default 0,
  speed_limit integer default 0,
  status text default 'flagged',
  source text default '',
  notes text default '',
  resolved_by text default '',
  resolved_at text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('speed_events');

-- ── Disciplinary / incident cases ────────────────────────────────────────────
create table if not exists public.disciplinary_cases (
  id text primary key,
  branch text not null,
  source text default 'manual',
  incident_type text default 'other',
  event_id text default '',
  driver_id text default '',
  driver_name text default '',
  vehicle_label text default '',
  route text default '',
  event_datetime text default '',
  title text default '',
  description text default '',
  severity text default '',
  over_by integer,
  recorded_speed integer,
  speed_limit integer,
  rec_band text,
  rec_action text,
  rec_fine integer,
  rec_offence integer,
  repeat_total integer,
  charge_statement jsonb,
  exculpatory jsonb,
  memo jsonb,
  incident_report jsonb,
  safety_report text default '',
  safety_notes text default '',
  proposal jsonb,
  verdict jsonb,
  stage text default 'safety_review',
  trail jsonb default '[]'::jsonb,
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('disciplinary_cases');

-- ── Driver compliance + training (same Credential shape) ─────────────────────
create table if not exists public.safety_compliance (
  id text primary key,
  branch text not null,
  driver_id text default '',
  driver_name text default '',
  category text default '',
  issued text default '',
  expiry text default '',
  location text,
  cert_file jsonb,
  notes text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('safety_compliance');

create table if not exists public.safety_training (
  id text primary key,
  branch text not null,
  driver_id text default '',
  driver_name text default '',
  category text default '',
  issued text default '',
  expiry text default '',
  location text,
  cert_file jsonb,
  notes text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('safety_training');

-- ── Hazard register ──────────────────────────────────────────────────────────
create table if not exists public.safety_hazards (
  id text primary key,
  branch text not null,
  date_identified text default '',
  location text default '',
  type text default '',
  description text default '',
  severity integer default 1,
  likelihood integer default 1,
  controls text default '',
  owner text default '',
  target_date text default '',
  status text default 'open',
  notes text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('safety_hazards');

-- ── CAP tracker ──────────────────────────────────────────────────────────────
create table if not exists public.safety_cap (
  id text primary key,
  branch text not null,
  ref text default '',
  title text default '',
  description text default '',
  owner text default '',
  target_date text default '',
  status text default 'open',
  actions jsonb default '[]'::jsonb,
  evidence jsonb,
  notes text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('safety_cap');

-- ── LOTO register ────────────────────────────────────────────────────────────
create table if not exists public.safety_loto (
  id text primary key,
  branch text not null,
  asset text default '',
  label_code text default '',
  isolation_point text default '',
  energy_type text default '',
  procedure_ref text default '',
  labelled boolean default false,
  last_audit text default '',
  next_audit text default '',
  notes text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('safety_loto');

-- ── Tool inspections ─────────────────────────────────────────────────────────
create table if not exists public.safety_tools (
  id text primary key,
  branch text not null,
  asset_tag text default '',
  tool_name text default '',
  category text default '',
  condition text default 'good',
  safe_to_use boolean default true,
  last_inspection text default '',
  next_inspection text default '',
  inspector text default '',
  notes text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('safety_tools');

-- ── Fuel issuances ───────────────────────────────────────────────────────────
create table if not exists public.fuel_issuances (
  id text primary key,
  branch text not null,
  date text default '',
  fleet_no text default '',
  vehicle_reg text default '',
  driver text default '',
  fuel_attendant text default '',
  trip_number integer,
  route text default '',
  opening_fuel_level text default '',
  closing_fuel_level text default '',
  opening_mileage integer default 0,
  closing_mileage integer default 0,
  liters_given numeric default 0,
  notes text default '',
  edited_by text,
  edited_at text,
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('fuel_issuances');

-- ── Fuel receipts (depot deliveries) ─────────────────────────────────────────
create table if not exists public.fuel_receipts (
  id text primary key,
  branch text not null,
  date text default '',
  litres numeric default 0,
  supplier text default '',
  unit_cost_usd numeric,
  notes text default '',
  delivery_note_file text,
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('fuel_receipts');

-- ── Non-fleet fuel draws (generators / authorised vehicles) ──────────────────
create table if not exists public.fuel_generator (
  id text primary key,
  branch text not null,
  date text default '',
  kind text default 'generator',
  recipient text default '',
  vehicle_reg text default '',
  litres numeric default 0,
  notes text default '',
  status text default 'approved',
  authorized_by text default '',
  authorized_at text default '',
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('fuel_generator');
