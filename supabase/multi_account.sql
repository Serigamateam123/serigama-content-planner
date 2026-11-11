-- ─────────────────────────────────────────────────────────────────────────
--  Multi-account TikTok: more than one TikTok account per planner login.
--  Run once in Supabase SQL Editor (after integrations.sql + account_stats.sql),
--  then redeploy the tiktok-callback and tiktok-sync Edge Functions straight away
--  (the old tiktok-sync upserts account_stats on the index dropped below).
--  Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- 1) A connection belongs to one TikTok account (accounts row), and a login can
--    hold several connections — one per TikTok open_id.
alter table public.integrations
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

alter table public.integrations drop constraint if exists integrations_user_id_platform_key;
create unique index if not exists uq_integrations_open_id
  on public.integrations (user_id, platform, open_id);

-- 2) Backfill: everything that exists today belongs to the login's first TikTok
--    account (serigama.daily).
update public.integrations i
   set account_id = (select a.id from public.accounts a
                      where a.user_id = i.user_id and a.platform = i.platform
                      order by a.created_at limit 1)
 where i.account_id is null;

update public.contents c
   set account_id = (select a.id from public.accounts a
                      where a.user_id = c.user_id and a.platform = 'tiktok'
                      order by a.created_at limit 1)
 where c.platform = 'tiktok' and c.account_id is null and c.external_id is not null;

update public.account_stats s
   set account_id = (select a.id from public.accounts a
                      where a.user_id = s.user_id and a.platform = s.platform
                      order by a.created_at limit 1)
 where s.account_id is null;

-- 3) Follower snapshots: one per ACCOUNT per day (was one per login per day).
drop index if exists public.uq_account_stats_day;
create unique index if not exists uq_account_stats_account_day
  on public.account_stats (user_id, platform, account_id, day);

commit;

-- Handy checks:
--   select id, display_name, account_id, last_synced_at from public.integrations;
--   select account_id, count(*) from public.contents where platform = 'tiktok' group by 1;
