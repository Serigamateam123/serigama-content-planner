-- app_kv: small per-user key/value store for manually-captured figures that used
-- to live only in browser localStorage (monthly report, views goal, audience,
-- saves, new followers, monthly followers). Backing them with Supabase makes them
-- appear on every device — not just the browser they were captured in.
-- The app (src/app.js syncKV) mirrors localStorage <-> this table on load.

create table if not exists public.app_kv (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  k          text        not null,
  v          text        not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, k)
);

alter table public.app_kv enable row level security;

-- Each user can only read/write their own rows.
drop policy if exists app_kv_all_own on public.app_kv;
create policy app_kv_all_own on public.app_kv
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
