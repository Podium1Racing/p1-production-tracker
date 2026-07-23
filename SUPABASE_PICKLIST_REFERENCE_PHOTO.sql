alter table public.picklists
  add column if not exists initial_kit_photo_base64 text,
  add column if not exists initial_kit_photo_mime text,
  add column if not exists initial_kit_photo_taken_at timestamptz,
  add column if not exists initial_kit_photo_by text;
