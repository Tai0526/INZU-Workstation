-- ===========================================================================
-- CLEAN SLATE — wipe all operational data so you can enter real records.
-- Run this MANUALLY in the Supabase SQL Editor when you want a fresh start.
-- It does NOT touch user accounts (public.profiles), settings (app_config),
-- or login history. Tables that don't exist yet are skipped, so this is safe to
-- run no matter which migrations you've applied.
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'vehicles', 'operated_vehicles', 'drivers', 'employees',
    'op_routes', 'op_allocations', 'op_mileage', 'op_daily_plan', 'op_weekly_assign',
    'documents', 'speed_events', 'disciplinary_cases',
    'safety_compliance', 'safety_training', 'safety_hazards', 'safety_cap', 'safety_loto', 'safety_tools',
    'fuel_issuances', 'fuel_receipts', 'fuel_generator',
    'mileage_trips', 'mileage_routes', 'payroll_deductions', 'report_recipients'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('truncate table public.%I', t);
    end if;
  end loop;
end $$;
