alter table public.homepage_media
  add column deleted_at timestamptz,
  add column cleanup_pending_assets jsonb not null default '[]'::jsonb
    check (jsonb_typeof(cleanup_pending_assets) = 'array');
