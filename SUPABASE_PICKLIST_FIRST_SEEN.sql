alter table public.picklist_items
  add column if not exists first_seen_at timestamptz;

update public.picklist_items
set first_seen_at = coalesce(first_seen_at, last_synced_at)
where first_seen_at is null
  and last_synced_at is not null;

create index if not exists picklist_items_first_seen_at_idx
  on public.picklist_items (first_seen_at desc);
