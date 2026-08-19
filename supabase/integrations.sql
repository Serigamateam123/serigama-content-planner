-- ─────────────────────────────────────────────────────────────────────────
--  Phase 2: TikTok connection storage
--  Run once in Supabase SQL Editor (after schema.sql).
-- ─────────────────────────────────────────────────────────────────────────

-- Stores one row per connected social account (OAuth tokens live here).
create table if not exists public.integrations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  platform         text not null,              -- 'tiktok'
  open_id          text,                       -- TikTok's stable user id
  display_name     text,
  access_token     text not null,
  refresh_token    text,
  expires_at       timestamptz,                -- access token expiry
  scope            text,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, platform)
);

alter table public.integrations enable row level security;

-- The user can SEE their own connection status (never the tokens in the client;
-- the app only selects non-secret columns). Writes happen server-side via the
-- Edge Functions using the service role, which bypasses RLS.
do $$
begin
  execute 'drop policy if exists own_integration on public.integrations';
  execute 'create policy own_integration on public.integrations
             for select using (user_id = auth.uid())';
end $$;

-- Link a TikTok video id to our content row, so repeated syncs update (not duplicate).
alter table public.contents add column if not exists external_id text;
create index if not exists idx_contents_external on public.contents (user_id, platform, external_id);
