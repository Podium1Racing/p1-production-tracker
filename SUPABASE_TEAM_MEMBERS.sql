-- Podium 1 Production Tracker: shared team roster
-- Run this once in Supabase SQL Editor for the project used by the app.

create table if not exists public.team_members (
  name text primary key,
  initials text,
  color text,
  role text not null default 'ms'
    check (role in ('ms', 'chassis', 'kit', 'float')),
  active boolean not null default true,
  is_custom boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.team_members enable row level security;

drop policy if exists "team_members_select" on public.team_members;
create policy "team_members_select"
on public.team_members
for select
using (true);

drop policy if exists "team_members_insert" on public.team_members;
create policy "team_members_insert"
on public.team_members
for insert
with check (true);

drop policy if exists "team_members_update" on public.team_members;
create policy "team_members_update"
on public.team_members
for update
using (true)
with check (true);

create index if not exists team_members_active_idx
on public.team_members (active);
