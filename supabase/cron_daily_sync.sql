-- Daily automatic TikTok sync (pg_cron + pg_net).
-- Runs tiktok-sync every day at 22:00 UTC = 6:00 AM Malaysia (UTC+8).
-- An empty body {} makes the Edge Function sync EVERY connected TikTok account.
-- The Authorization/apikey use the public publishable key (same one in config.js);
-- tiktok-sync has verify_jwt disabled, so no service-role secret is needed here.
-- Verified: a manual net.http_post to the function returns HTTP 200 {"ok":true,...}
-- and completes within the 55s timeout.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop a previous job of the same name before re-creating.
select cron.unschedule(jobid) from cron.job where jobname = 'tiktok-daily-sync';

select cron.schedule(
  'tiktok-daily-sync',
  '0 22 * * *',
  $CRON$
  select net.http_post(
    url := 'https://acfscrvvlzjtbsxturkx.supabase.co/functions/v1/tiktok-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_Zywb6MJKBGSEah1PrFzUrg_eUCX0v1i',
      'Authorization','Bearer sb_publishable_Zywb6MJKBGSEah1PrFzUrg_eUCX0v1i'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $CRON$
);

-- Handy checks:
--   select jobid, jobname, schedule, active from cron.job where jobname='tiktok-daily-sync';
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='tiktok-daily-sync') order by start_time desc limit 5;
