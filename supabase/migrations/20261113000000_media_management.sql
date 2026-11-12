alter table public.product_media
  add column poster_cloudinary_asset_id text,
  add column cloudinary_public_id text,
  add column poster_cloudinary_public_id text,
  add column poster_url text,
  add column deleted_at timestamptz,
  add column cleanup_pending_assets jsonb not null default '[]'::jsonb
    check (jsonb_typeof(cleanup_pending_assets) = 'array');

create index product_media_active_order_idx
  on public.product_media (product_id, sort_order)
  where deleted_at is null;

drop policy "Public can read media for published products" on public.product_media;

create policy "Public can read media for published products"
  on public.product_media for select to anon, authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.products
      where products.id = product_media.product_id
        and products.is_published
        and products.archived_at is null
    )
  );
