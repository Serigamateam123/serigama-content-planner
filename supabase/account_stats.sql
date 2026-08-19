-- ─────────────────────────────────────────────────────────────────────────
--  Follower / account growth snapshots
--  Run once in Supabase SQL Editor (after schema.sql + integrations.sql).
--  One row per account per day; written server-side by the tiktok-sync
--  Edge Function. Builds a follower time series going forward.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.account_stats (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  account_id      uuid references public.accounts (id) on delete set null,
  platform        text not null default 'tiktok',
  follower_count  int,
  following_count int,
  likes_count     bigint,
  video_count     int,
  captured_at     timestamptz not null default now(),
  day             date not null default current_date
);

-- One snapshot per user/platform/day → upsert keeps it idempotent within a day.
create unique index if not exists uq_account_stats_day
  on public.account_stats (user_id, platform, day);

alter table public.account_stats enable row level security;

-- The user can read their own snapshots; writes happen server-side (service role).
do $$
begin
  execute 'drop policy if exists own_account_stats on public.account_stats';
  execute 'create policy own_account_stats on public.account_stats
             for select using (user_id = auth.uid())';
end $$;
