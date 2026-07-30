create table if not exists public.configuration_checklists (
  id uuid primary key default gen_random_uuid(),
  wo_number text not null unique,
  monday_item_id bigint,
  customer_name text,
  project_name text,
  assigned_to text,
  checklist jsonb not null default '[]'::jsonb,
  notes text,
  status text not null default 'in_progress',
  tech_name text,
  tech_completed_at timestamptz,
  lead_name text,
  lead_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists configuration_checklists_status_idx
  on public.configuration_checklists (status);

create index if not exists configuration_checklists_assigned_to_idx
  on public.configuration_checklists (assigned_to);

alter table public.configuration_checklists enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'configuration_checklists'
      and policyname = 'configuration_checklists_select_all'
  ) then
    create policy configuration_checklists_select_all
      on public.configuration_checklists
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'configuration_checklists'
      and policyname = 'configuration_checklists_insert_all'
  ) then
    create policy configuration_checklists_insert_all
      on public.configuration_checklists
      for insert
      to anon, authenticated
      with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'configuration_checklists'
      and policyname = 'configuration_checklists_update_all'
  ) then
    create policy configuration_checklists_update_all
      on public.configuration_checklists
      for update
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;
