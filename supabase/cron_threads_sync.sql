-- Daily automatic Threads sync (pg_cron + pg_net), 22:10 UTC = 6:10 AM Malaysia,
-- just after the TikTok (6:00) and Instagram (6:05) syncs. Empty body = every
-- connected Threads account. threads-sync has verify_jwt disabled.

select cron.unschedule(jobid) from cron.job where jobname = 'threads-daily-sync';

select cron.schedule(
  'threads-daily-sync',
  '10 22 * * *',
  $CRON$
  select net.http_post(
    url := 'https://acfscrvvlzjtbsxturkx.supabase.co/functions/v1/threads-sync',
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
