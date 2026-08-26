-- Daily email reminders: pg_cron calls the daily-reminders Edge Function every
-- morning at 07:00 UTC (09:00 site time), which sends one digest email per
-- NATURE of thing per BRANCH — vehicles & workshop, driver credentials,
-- contracts & documents, fuel stock snapshot — to the recipients configured on
-- the Admin page. Which categories are included is also chosen there
-- (Scheduling tab).
--
-- ONE-TIME SETUP (dashboard SQL editor or psql, after `supabase db push`):
--
--   1. Deploy the function and set its secret:
--        supabase functions deploy daily-reminders
--        supabase secrets set CRON_SECRET=<a long random string>
--
--   2. Store the SAME secret and your project's function URL in Vault, so the
--      cron job can present it (replace the values):
--        select vault.create_secret('<the same long random string>', 'cron_secret');
--        select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/daily-reminders', 'reminders_url');
--
--   3. Set the recipients on the Workstation's Admin page, and use its
--      "Send now" button to test without waiting for the morning.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-creating the job must not duplicate it.
do $$
begin
  perform cron.unschedule('daily-reminders');
exception when others then
  -- not scheduled yet
end $$;

select cron.schedule(
  'daily-reminders',
  '0 7 * * *',  -- 07:00 UTC = 09:00 CAT
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
