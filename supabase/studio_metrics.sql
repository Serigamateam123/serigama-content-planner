-- ─────────────────────────────────────────────────────────────────────────
--  TikTok Studio per-video figures (hook rate, watch time, new viewers…)
--  These aren't in TikTok's public API, so they're captured from TikTok Studio
--  and written by window.serigamaCloud.saveStudio() (src/app.js).
--
--  This table already exists in the live project but was created by hand, so its
--  definition was missing from the repo. This file is RECONSTRUCTED from the
--  columns the app reads (src/features/Analytics.js, StudioCard/KpiDetail) so the
--  database can be rebuilt. If the live table has extra columns, add them here.
--  Safe to re-run: every statement is "if not exists" / replaces its own policy.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.studio_metrics (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  external_id        text not null,        -- TikTok video id (matches contents.external_id)
  hook_3s_pct        numeric,              -- % of viewers still watching at 3s
  new_viewers_pct    numeric,              -- % of viewers who were new to the account
  new_followers      int,                  -- followers gained from this video
  avg_watch_seconds  numeric,
  avg_watch_label    text,                 -- Studio's own display text, e.g. "7.4s"
  watched_full_pct   numeric,              -- % who watched to the end
  captured_at        timestamptz not null default now()
);

alter table public.studio_metrics add column if not exists hook_3s_pct       numeric;
alter table public.studio_metrics add column if not exists new_viewers_pct   numeric;
alter table public.studio_metrics add column if not exists new_followers     int;
alter table public.studio_metrics add column if not exists avg_watch_seconds numeric;
alter table public.studio_metrics add column if not exists avg_watch_label   text;
alter table public.studio_metrics add column if not exists watched_full_pct  numeric;

create index if not exists idx_studio_metrics_ext on public.studio_metrics (user_id, external_id);

alter table public.studio_metrics enable row level security;

-- saveStudio() deletes + inserts from the browser, so the owner needs full access.
drop policy if exists own_studio_metrics on public.studio_metrics;
create policy own_studio_metrics on public.studio_metrics
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
