-- Auto-posting to Instagram (2026-11-12). Run once in Supabase → SQL Editor. Safe to re-run.
--
-- A planner item can carry one posting job: the video / photo (in Storage bucket
-- `publish-media`), the caption to post, when to post, and whether it's a trial reel.
-- The Edge Function `instagram-publish` (every 5 minutes, see cron_publish.sql) posts
-- due jobs through the Instagram API and then turns the item into the posted reel.
-- Owner + team members with the Full role can schedule; Calendar-only members can't.

create table if not exists public.publish_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade, -- data owner
  content_id   uuid not null references public.contents (id) on delete cascade,
  account_id   uuid references public.accounts (id) on delete set null,
  platform     text not null default 'instagram',
  kind         text not null default 'reel' check (kind in ('reel', 'image')),
  media_path   text not null,          -- object in bucket publish-media
  cover_path   text,                   -- optional reel cover image
  caption      text not null default '',
  share_to_feed boolean not null default true,
  trial        text check (trial in ('MANUAL', 'SS_PERFORMANCE')), -- null = normal post
  scheduled_at timestamptz not null,
  status       text not null default 'queued'
               check (status in ('queued', 'processing', 'published', 'failed', 'cancelled')),
  container_id text,
  media_id     text,
  permalink    text,
  error        text,
  attempts     int not null default 0,
  lock_until   timestamptz,           -- set while a run is working on it
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (content_id)
);
alter table public.publish_jobs add column if not exists lock_until timestamptz;
create index if not exists publish_jobs_due on public.publish_jobs (status, scheduled_at);
alter table public.publish_jobs enable row level security;

drop policy if exists publish_jobs_own on public.publish_jobs;
create policy publish_jobs_own on public.publish_jobs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists publish_jobs_team on public.publish_jobs;
create policy publish_jobs_team on public.publish_jobs
  for all to authenticated
  using (user_id = (select public.my_team_owner()) and (select public.my_team_role()) = 'full')
  with check (user_id = (select public.my_team_owner()) and (select public.my_team_role()) = 'full');

-- Private bucket; files live under <owner id>/… . Instagram fetches them through a
-- short-lived signed link made by the Edge Function. 50 MB per file (free plan limit).
insert into storage.buckets (id, name, public, file_size_limit)
values ('publish-media', 'publish-media', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists publish_media_rw on storage.objects;
create policy publish_media_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'publish-media' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or ((storage.foldername(name))[1] = (select public.my_team_owner())::text and (select public.my_team_role()) = 'full')))
  with check (bucket_id = 'publish-media' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or ((storage.foldername(name))[1] = (select public.my_team_owner())::text and (select public.my_team_role()) = 'full')));

-- Also post to Story (2026-11-12): after the reel / photo is published, the same file
-- goes up as a Story (its own post; the API can't add a "reel" sticker).
alter table public.publish_jobs add column if not exists also_story boolean not null default false;
alter table public.publish_jobs add column if not exists story_status text
  check (story_status in ('queued', 'processing', 'published', 'failed'));
alter table public.publish_jobs add column if not exists story_container_id text;
alter table public.publish_jobs add column if not exists story_media_id text;
alter table public.publish_jobs add column if not exists story_error text;
