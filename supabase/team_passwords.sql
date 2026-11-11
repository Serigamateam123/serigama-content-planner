-- Team starting passwords (2026-11-11). Run once in Supabase → SQL Editor after team.sql.
--
-- The owner asked to see / copy each member's password on the Team page. Supabase only
-- keeps a one-way hash of real passwords, so what we keep here is the STARTING password
-- the owner typed (when inviting, or with "Set new password"). Readable only by the owner
-- (team_owner_manages) and by that member for their own row. When the member changes it
-- with "Set password" in the planner, mark_my_password_changed() wipes it, so a password
-- the member chose themselves is never stored.

alter table public.team_members add column if not exists start_password   text;
alter table public.team_members add column if not exists password_changed boolean not null default false;

create or replace function public.mark_my_password_changed() returns void
language sql volatile security definer set search_path = public, auth as $$
  update public.team_members
     set start_password = null, password_changed = true
   where email = public.my_email();
$$;
revoke all on function public.mark_my_password_changed() from public;
grant execute on function public.mark_my_password_changed() to authenticated;
