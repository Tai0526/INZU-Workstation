-- ===========================================================================
-- INZU Workstation — Supabase foundation: identity (profiles), security
-- helpers, login history, and the documents storage bucket.
--
-- Run this in the Supabase dashboard → SQL Editor (or via `supabase db push`).
-- It is idempotent — safe to run more than once.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ── Profiles ───────────────────────────────────────────────────────────────
-- One row per auth user. Mirrors the app's user record, MINUS the password
-- (passwords live only in Supabase Auth, hashed with bcrypt — never stored here).
create table if not exists public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  username              text unique,
  full_name             text not null default '',
  email                 text,
  role                  text not null default 'viewer',
  branch                text not null default 'trident',
  extra_branches        text[] not null default '{}',
  perm_overrides        jsonb not null default '{}'::jsonb,
  hidden_pages          text[] not null default '{}',
  is_employee           boolean not null default false,
  employee_id           text not null default '',
  active                boolean not null default true,
  must_change_password  boolean not null default true,
  created_at            timestamptz not null default now(),
  created_by            text not null default '',
  last_login_at         timestamptz,
  login_count           integer not null default 0
);

-- ── Login history (for the Admin → Sessions tab) ────────────────────────────
create table if not exists public.login_events (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid references auth.users (id) on delete cascade,
  full_name text,
  role      text,
  at        timestamptz not null default now()
);

-- ── Security helper: is the caller an active administrator? ──────────────────
-- SECURITY DEFINER so it bypasses RLS on profiles (avoids recursive policy eval).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'administrator' and active
  );
$$;

-- ── Create a profile automatically whenever an auth user is created ──────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, full_name, role, branch, must_change_password, created_by)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'viewer'),
    coalesce(new.raw_user_meta_data->>'branch', 'trident'),
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, true),
    coalesce(new.raw_user_meta_data->>'created_by', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── RPC: the signed-in user clears their own "must change password" flag ─────
-- Called by the app right after a successful forced password change.
create or replace function public.complete_password_change()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

-- ── RPC: record a login for the signed-in user ──────────────────────────────
create or replace function public.record_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare p public.profiles;
begin
  update public.profiles
     set last_login_at = now(), login_count = login_count + 1
   where id = auth.uid()
   returning * into p;
  if found then
    insert into public.login_events (user_id, full_name, role) values (p.id, p.full_name, p.role);
  end if;
end;
$$;

-- ── Row-Level Security ──────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.login_events enable row level security;

-- Any signed-in user may read the directory (names/roles/branches) — needed for
-- messaging, document sharing pickers, etc. No password data lives here.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

-- Only administrators may change profile rows (role, branch, permissions, active).
-- Creating users / resetting passwords goes through the Edge Function (service_role).
drop policy if exists "profiles_admin_write" on public.profiles;
create policy "profiles_admin_write" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete" on public.profiles
  for delete to authenticated using (public.is_admin());

drop policy if exists "login_events_select_authenticated" on public.login_events;
create policy "login_events_select_authenticated" on public.login_events
  for select to authenticated using (true);

-- ── Storage: the documents bucket (private; access via signed URLs) ──────────
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Authenticated users may read/write document files. We never overwrite a file —
-- each document version is stored under its own unique key — so nothing is lost.
drop policy if exists "documents_read" on storage.objects;
create policy "documents_read" on storage.objects
  for select to authenticated using (bucket_id = 'documents');

drop policy if exists "documents_insert" on storage.objects;
create policy "documents_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'documents');

drop policy if exists "documents_update" on storage.objects;
create policy "documents_update" on storage.objects
  for update to authenticated using (bucket_id = 'documents');

drop policy if exists "documents_delete" on storage.objects;
create policy "documents_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'documents');

-- ===========================================================================
-- After running this:
--   1) Create your admin login under Authentication → Users → "Add user"
--      (set a password, tick "Auto Confirm User").
--   2) Promote that account to administrator by email:
--
--        update public.profiles
--           set role = 'administrator', active = true, must_change_password = false
--         where email = 'YOUR-ADMIN-EMAIL@example.com';
--
-- ===========================================================================
