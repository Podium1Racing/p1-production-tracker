create table if not exists public.lead_picklist_verifications (
  id uuid primary key default gen_random_uuid(),
  item_id bigint,
  item_name text,
  customer_name text,
  wo_number text not null,
  col_type text not null default 'chassis',
  lead_name text not null,
  project_percent integer,
  progress_note text,
  still_missing jsonb not null default '[]'::jsonb,
  resolved_items jsonb not null default '[]'::jsonb,
  newly_missing jsonb not null default '[]'::jsonb,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists lead_picklist_verifications_wo_idx
  on public.lead_picklist_verifications (wo_number);

create index if not exists lead_picklist_verifications_item_idx
  on public.lead_picklist_verifications (item_id);

create index if not exists lead_picklist_verifications_verified_at_idx
  on public.lead_picklist_verifications (verified_at desc);

alter table public.lead_picklist_verifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_picklist_verifications'
      and policyname = 'lead_picklist_verifications_select_all'
  ) then
    create policy lead_picklist_verifications_select_all
      on public.lead_picklist_verifications
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
      and tablename = 'lead_picklist_verifications'
      and policyname = 'lead_picklist_verifications_insert_all'
  ) then
    create policy lead_picklist_verifications_insert_all
      on public.lead_picklist_verifications
      for insert
      to anon, authenticated
      with check (true);
  end if;
end $$;

