-- ===========================================================================
-- INZU Workstation — data tables, phase 5: Petty Cash.
--
-- Moves petty cash off the app_config JSON blobs and onto real tables (one row
-- per requisition / ledger entry) — durable, auditable, and included in the
-- clean-slate reset. Columns mirror the app's TypeScript records 1:1 (snake_case)
-- so a row round-trips with no mapping. Run after 0006 in the Supabase dashboard
-- → SQL Editor (or `supabase db push`). Idempotent — safe to run more than once.
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

-- ── Petty cash: requisitions ─────────────────────────────────────────────────
-- Flow: request → check (Safety) → authorise (Asst Ops) → approve (Ops/Asst Ops)
-- → pay. Each stage stamps who + when; receipts are optional proof-of-purchase.
create table if not exists public.petty_cash_requisitions (
  id                 text primary key,
  branch             text not null,
  date               text default '',
  requester_name     text default '',
  department         text default '',
  position           text default '',
  purpose            text default '',
  amount             numeric default 0,
  status             text not null default 'pending',
  checked_by         text default '',
  checked_at         text default '',
  authorised_by      text default '',
  authorised_at      text default '',
  authorised_skipped boolean default false,
  approved_by        text default '',
  approved_at        text default '',
  paid_by            text default '',
  paid_at            text default '',
  paid_amount        numeric default 0,
  rejected_by        text default '',
  rejected_at        text default '',
  rejected_note      text default '',
  receipts           jsonb default '[]'::jsonb,
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('petty_cash_requisitions');

-- ── Petty cash: reconciliation ledger (money in / out, running balance) ───────
create table if not exists public.petty_cash_ledger (
  id          text primary key,
  branch      text not null,
  date        text default '',
  direction   text not null default 'in',   -- 'in' | 'out'
  kind        text not null default 'topup', -- float / topup / borrowed / disbursement / repayment / adjustment
  amount      numeric default 0,
  party       text default '',               -- source (in) / recipient (out) / lender (borrowed)
  note        text default '',
  req_id      text,                          -- linked requisition, for disbursements
  created_by text default '', created_at text default '', updated_by text default '', updated_at text default ''
);
select public._secure_table('petty_cash_ledger');

-- ── One-time cleanup ─────────────────────────────────────────────────────────
-- Remove the superseded app_config JSON blobs. This also clears the test data,
-- so petty cash starts empty and ready for real entries. (Leaves the acting-
-- approver setting alone.)
delete from public.app_config where key in ('petty_cash_reqs', 'petty_cash_ledger');
