-- ===========================================================================
-- Link a logged bus run (op_allocations) back to the Daily Plan trip it
-- fulfils, so the app can compare plan vs actual. Run after 0005. Idempotent.
-- ===========================================================================
alter table public.op_allocations add column if not exists plan_trip_id text;
