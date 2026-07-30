alter table public.configuration_checklists
  add column if not exists tech_signature text,
  add column if not exists tech_signature_name text,
  add column if not exists final_photos jsonb not null default '[]'::jsonb;
