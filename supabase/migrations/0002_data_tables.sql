-- ===========================================================================
-- INZU Workstation — data tables, phase 1: Fleet (owned + operated vehicles).
--
-- Columns mirror the app's TypeScript records 1:1 so rows round-trip with no
-- mapping. Dates/timestamps are stored as text (the exact ISO strings the app
-- already uses) to avoid any format drift. Run after 0001_init.sql. Idempotent.
-- ===========================================================================

-- Helper: enable a table for realtime, only if not already enabled.
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

-- ── Owned vehicles ──────────────────────────────────────────────────────────
create table if not exists public.vehicles (
  id              text primary key,
  fleet_no        text not null,
  reg_plate       text default '',
  make            text default '',
  model           text default '',
  year            integer,
  type            text default 'bus',
  branch          text not null,
  status          text not null default 'active',
  capacity        integer,
  colour          text default '',
  chassis_no      text default '',
  engine_no       text default '',
  in_service_date text default '',
  notes           text default '',
  created_by      text default '',
  created_at      text default '',
  updated_by      text default '',
  updated_at      text default ''
);
alter table public.vehicles enable row level security;
drop policy if exists "vehicles_rw" on public.vehicles;
create policy "vehicles_rw" on public.vehicles for all to authenticated using (true) with check (true);
select public._add_to_realtime('vehicles');

-- ── Operated (contract) vehicles ────────────────────────────────────────────
create table if not exists public.operated_vehicles (
  id          text primary key,
  branch      text not null,
  fleet_no    text not null,
  reg_plate   text default '',
  owner       text default '',
  section     text default '',
  status      text not null default 'active',
  notes       text default '',
  created_by  text default '',
  created_at  text default '',
  updated_by  text default '',
  updated_at  text default ''
);
alter table public.operated_vehicles enable row level security;
drop policy if exists "operated_vehicles_rw" on public.operated_vehicles;
create policy "operated_vehicles_rw" on public.operated_vehicles for all to authenticated using (true) with check (true);
select public._add_to_realtime('operated_vehicles');

-- ===========================================================================
-- Security note: these policies allow any signed-in user full read/write
-- (the app enforces role/branch in the UI). Tighten later with per-role / per-
-- branch policies once the data model is fully migrated.
-- ===========================================================================
