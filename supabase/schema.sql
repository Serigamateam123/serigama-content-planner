-- ─────────────────────────────────────────────────────────────────────────
--  Serigama Content Planner — database schema
--  Run this once in your Supabase project:  SQL Editor → paste → Run.
--  Every table is protected by Row Level Security so each signed-in user can
--  only read/write their own rows.
-- ─────────────────────────────────────────────────────────────────────────

-- Accounts (one row per social account you post to) --------------------------
create table if not exists public.accounts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  platform     text not null,           -- tiktok | instagram | youtube | facebook | threads
  handle       text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- Campaigns (group content; target_count drives the progress bars) -----------
create table if not exists public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  color        text not null default '#3B82F6',
  target_count int  not null default 0,
  start_date   timestamptz,
  end_date     timestamptz,
  status       text not null default 'active',
  created_at   timestamptz not null default now()
);

-- Content (the core planning unit) -------------------------------------------
create table if not exists public.contents (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  title              text not null,
  caption            text default '',
  platform           text not null,
  account_id         uuid references public.accounts (id) on delete set null,
  campaign_id        uuid references public.campaigns (id) on delete set null,
  scheduled_at       timestamptz,        -- null = unscheduled backlog
  status             text not null default 'draft',  -- draft | scheduled | published
  published_at       timestamptz,
  format             text default 'feed',
  has_final_caption  boolean not null default false,
  post_url           text default '',    -- filled after posting; Phase-2 sync uses this
  created_at         timestamptz not null default now()
);

-- Performance metrics (one row per pull/entry; keeps history) -----------------
create table if not exists public.content_metrics (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  content_id       uuid not null references public.contents (id) on delete cascade,
  reach            bigint default 0,
  impressions      bigint default 0,
  views            bigint default 0,
  likes            bigint default 0,
  comments         bigint default 0,
  shares           bigint default 0,
  engagement       bigint default 0,
  engagement_rate  numeric default 0,
  source           text not null default 'manual',  -- manual | tiktok | instagram
  fetched_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index if not exists idx_contents_user on public.contents (user_id);
create index if not exists idx_metrics_content on public.content_metrics (content_id);

-- Row Level Security ----------------------------------------------------------
alter table public.accounts        enable row level security;
alter table public.campaigns       enable row level security;
alter table public.contents        enable row level security;
alter table public.content_metrics enable row level security;

-- One policy per table: you may touch a row only if it is yours.
do $$
declare t text;
begin
  foreach t in array array['accounts','campaigns','contents','content_metrics'] loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format(
      'create policy own_rows on public.%I
         for all
         using (user_id = auth.uid())
         with check (user_id = auth.uid())', t);
  end loop;
end $$;
