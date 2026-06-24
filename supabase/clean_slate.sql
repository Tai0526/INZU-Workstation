-- ===========================================================================
-- CLEAN SLATE — wipe all operational data so you can enter real records.
-- Run this MANUALLY in the Supabase SQL Editor when you want a fresh start.
-- It does NOT touch user accounts (public.profiles) or login history.
-- (Migrated tables already start empty; this just clears any test rows.)
-- ===========================================================================
truncate table
  public.vehicles,
  public.operated_vehicles,
  public.drivers,
  public.employees,
  public.op_routes,
  public.op_allocations,
  public.op_mileage,
  public.op_daily_plan,
  public.op_weekly_assign,
  public.documents;
