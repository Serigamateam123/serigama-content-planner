-- Auto-posting: run instagram-publish every 5 minutes (pg_cron + pg_net).
-- Empty body = every due job. instagram-publish has verify_jwt disabled; it only posts
-- jobs already queued by the planner (it can't be told what to post).

select cron.unschedule(jobid) from cron.job where jobname = 'instagram-publish';

select cron.schedule(
  'instagram-publish',
  '*/5 * * * *',
  $CRON$
  select net.http_post(
    url := 'https://acfscrvvlzjtbsxturkx.supabase.co/functions/v1/instagram-publish',
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
