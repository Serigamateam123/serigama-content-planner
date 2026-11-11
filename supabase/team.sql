-- Team access (2026-11-11). Run once in Supabase → SQL Editor. Safe to re-run.
--
-- The owner (the login that holds the data, serigamateam@gmail.com) invites people by
-- email with a role:
--   full     – everything the owner sees, except the TikTok / Instagram connections
--   calendar – the content plan only: contents, the account list and the planning
--              fields kept in app_kv `serigama.contentmeta`. No reports, stats or other figures.
-- Members sign in with their OWN login. These policies sit next to the existing
-- "own rows" policies, so the owner's access is unchanged. Integrations (tokens) stay
-- owner-only. Logins are created by the `team-invite` Edge Function (no email needed).

create table if not exists public.team_members (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  email      text not null check (email = lower(email)),
  role       text not null check (role in ('full', 'calendar')),
  invited_at timestamptz not null default now(),
  primary key (owner_id, email)
);
alter table public.team_members enable row level security;

-- The signed-in user's confirmed email, team owner and role (null when not a member).
-- SECURITY DEFINER so policies can read auth.users / team_members without exposing them.
create or replace function public.my_email() returns text
language sql stable security definer set search_path = public, auth as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null
$$;

create or replace function public.my_team_owner() returns uuid
language sql stable security definer set search_path = public, auth as $$
  select tm.owner_id from public.team_members tm
  where tm.email = public.my_email()
  order by tm.invited_at limit 1
$$;

create or replace function public.my_team_role() returns text
language sql stable security definer set search_path = public, auth as $$
  select tm.role from public.team_members tm
  where tm.email = public.my_email()
  order by tm.invited_at limit 1
$$;

revoke all on function public.my_email(), public.my_team_owner(), public.my_team_role() from public;
grant execute on function public.my_email(), public.my_team_owner(), public.my_team_role() to authenticated;

-- team_members: the owner manages their list; a member can read their own entry.
drop policy if exists team_owner_manages on public.team_members;
create policy team_owner_manages on public.team_members
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists team_member_reads_self on public.team_members;
create policy team_member_reads_self on public.team_members
  for select to authenticated
  using (email = (select public.my_email()));

-- Content plan: every member (both roles) can read and change it.
drop policy if exists team_contents on public.contents;
create policy team_contents on public.contents
  for all to authenticated
  using (user_id = (select public.my_team_owner()))
  with check (user_id = (select public.my_team_owner()));

drop policy if exists team_accounts_read on public.accounts;
create policy team_accounts_read on public.accounts
  for select to authenticated
  using (user_id = (select public.my_team_owner()));

drop policy if exists team_campaigns_read on public.campaigns;
create policy team_campaigns_read on public.campaigns
  for select to authenticated
  using (user_id = (select public.my_team_owner()));

-- app_kv: full members – every key; calendar members – only the planning fields.
drop policy if exists team_app_kv on public.app_kv;
create policy team_app_kv on public.app_kv
  for all to authenticated
  using (user_id = (select public.my_team_owner())
         and ((select public.my_team_role()) = 'full' or k = 'serigama.contentmeta'))
  with check (user_id = (select public.my_team_owner())
         and ((select public.my_team_role()) = 'full' or k = 'serigama.contentmeta'));

-- Numbers and reports: full members only.
drop policy if exists team_content_metrics on public.content_metrics;
create policy team_content_metrics on public.content_metrics
  for all to authenticated
  using (user_id = (select public.my_team_owner()) and (select public.my_team_role()) = 'full')
  with check (user_id = (select public.my_team_owner()) and (select public.my_team_role()) = 'full');

drop policy if exists team_account_stats_read on public.account_stats;
create policy team_account_stats_read on public.account_stats
  for select to authenticated
  using (user_id = (select public.my_team_owner()) and (select public.my_team_role()) = 'full');

drop policy if exists team_studio_metrics on public.studio_metrics;
create policy team_studio_metrics on public.studio_metrics
  for all to authenticated
  using (user_id = (select public.my_team_owner()) and (select public.my_team_role()) = 'full')
  with check (user_id = (select public.my_team_owner()) and (select public.my_team_role()) = 'full');
