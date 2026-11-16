create table public.media_library (
  id uuid primary key default gen_random_uuid(),
  media_type text not null check (media_type in ('image', 'video')),
  cloudinary_asset_id text not null unique,
  cloudinary_public_id text,
  media_url text not null,
  alt_text text,
  poster_media_library_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  cleanup_pending_assets jsonb not null default '[]'::jsonb
    check (jsonb_typeof(cleanup_pending_assets) = 'array')
);

insert into public.media_library (
  media_type, cloudinary_asset_id, cloudinary_public_id, media_url, alt_text,
  created_at
)
select distinct on (assets.cloudinary_asset_id)
  assets.media_type,
  assets.cloudinary_asset_id,
  assets.cloudinary_public_id,
  assets.media_url,
  assets.alt_text,
  assets.created_at
from (
  select
    media_type, cloudinary_asset_id, cloudinary_public_id, media_url,
    alt_text, created_at, 0 as source_priority
  from public.product_media
  union all
  select
    media_type, cloudinary_asset_id, cloudinary_public_id, media_url,
    alt_text, created_at, 1 as source_priority
  from public.homepage_media
) as assets
where assets.cloudinary_asset_id is not null
order by assets.cloudinary_asset_id, assets.source_priority, assets.created_at;

insert into public.media_library (
  media_type, cloudinary_asset_id, cloudinary_public_id, media_url, alt_text
)
select distinct on (posters.cloudinary_asset_id)
  'image',
  posters.cloudinary_asset_id,
  posters.cloudinary_public_id,
  posters.poster_url,
  null
from (
  select
    poster_cloudinary_asset_id as cloudinary_asset_id,
    poster_cloudinary_public_id as cloudinary_public_id,
    poster_url
  from public.product_media
  where poster_cloudinary_asset_id is not null
) as posters
where not exists (
  select 1
  from public.media_library existing
  where existing.cloudinary_asset_id = posters.cloudinary_asset_id
)
order by posters.cloudinary_asset_id, posters.cloudinary_public_id
on conflict do nothing;

alter table public.media_library
  add constraint media_library_poster_media_library_id_fkey
    foreign key (poster_media_library_id) references public.media_library(id) on delete set null;

update public.media_library as video
set poster_media_library_id = poster.id
from (
  select distinct on (media.cloudinary_asset_id)
    media.cloudinary_asset_id,
    media.poster_cloudinary_asset_id
  from public.product_media as media
  where media.poster_cloudinary_asset_id is not null
  order by media.cloudinary_asset_id, media.created_at
) as posters
join public.media_library as poster
  on poster.cloudinary_asset_id = posters.poster_cloudinary_asset_id
where video.cloudinary_asset_id = posters.cloudinary_asset_id;

update public.media_library as library
set deleted_at = case
  when exists (
    select 1
    from public.product_media as media
    where media.cloudinary_asset_id = library.cloudinary_asset_id
      and media.deleted_at is null
  ) or exists (
    select 1
    from public.homepage_media as media
    where media.cloudinary_asset_id = library.cloudinary_asset_id
      and media.deleted_at is null
  ) then null
  else coalesce(
    (
      select min(media.deleted_at)
      from public.product_media as media
      where media.cloudinary_asset_id = library.cloudinary_asset_id
        and media.deleted_at is not null
    ),
    (
      select min(media.deleted_at)
      from public.homepage_media as media
      where media.cloudinary_asset_id = library.cloudinary_asset_id
        and media.deleted_at is not null
    )
  )
end;

with pending_assets as (
  select
    source.cloudinary_asset_id,
    jsonb_agg(distinct source.asset) as assets
  from (
    select media.cloudinary_asset_id, pending.asset
    from public.product_media as media
    cross join lateral jsonb_array_elements(media.cleanup_pending_assets) as pending(asset)
    union all
    select media.cloudinary_asset_id, pending.asset
    from public.homepage_media as media
    cross join lateral jsonb_array_elements(media.cleanup_pending_assets) as pending(asset)
  ) as source
  group by source.cloudinary_asset_id
)
update public.media_library as library
set cleanup_pending_assets = pending.assets
from pending_assets as pending
where pending.cloudinary_asset_id = library.cloudinary_asset_id;

create temporary table media_library_legacy_ids (
  legacy_id text primary key,
  media_library_id uuid not null
);

insert into media_library_legacy_ids (legacy_id, media_library_id)
select legacy.id, library.id
from (
  select id::text as id, cloudinary_asset_id from public.product_media
  union all
  select id::text, cloudinary_asset_id from public.homepage_media
  union all
  select cloudinary_asset_id, cloudinary_asset_id from public.product_media
  union all
  select cloudinary_asset_id, cloudinary_asset_id from public.homepage_media
  union all
  select cloudinary_public_id, cloudinary_asset_id from public.product_media
  union all
  select cloudinary_public_id, cloudinary_asset_id from public.homepage_media
  union all
  select poster_cloudinary_asset_id, poster_cloudinary_asset_id from public.product_media
  union all
  select poster_cloudinary_public_id, poster_cloudinary_asset_id from public.product_media
) as legacy
join public.media_library as library
  on library.cloudinary_asset_id = legacy.cloudinary_asset_id
where legacy.id is not null
on conflict (legacy_id) do nothing;

create function public.remap_media_content(value jsonb, media_mapping jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb;
begin
  if jsonb_typeof(value) = 'string' then
    if media_mapping ? (value #>> '{}') then
      return to_jsonb(media_mapping ->> (value #>> '{}'));
    end if;
    return value;
  end if;

  if jsonb_typeof(value) = 'array' then
    select coalesce(jsonb_agg(public.remap_media_content(item.value, media_mapping) order by item.ordinality), '[]'::jsonb)
    into result
    from jsonb_array_elements(value) with ordinality as item(value, ordinality);
    return result;
  end if;

  if jsonb_typeof(value) = 'object' then
    select coalesce(
      jsonb_object_agg(
        case
          when media_mapping ? item.key then media_mapping ->> item.key
          else item.key
        end,
        public.remap_media_content(item.value, media_mapping)
      ),
      '{}'::jsonb
    )
    into result
    from jsonb_each(value) as item(key, value);
    return result;
  end if;

  return value;
end;
$$;

update public.homepage_content
set content = public.remap_media_content(
  content,
  (select jsonb_object_agg(legacy_id, media_library_id::text) from media_library_legacy_ids)
);

drop function public.remap_media_content(jsonb, jsonb);
drop table media_library_legacy_ids;

alter table public.product_media
  add column media_library_id uuid,
  add column poster_media_library_id uuid;

update public.product_media as assignment
set media_library_id = library.id
from public.media_library as library
where library.cloudinary_asset_id = assignment.cloudinary_asset_id;

update public.product_media as assignment
set poster_media_library_id = poster.id
from public.media_library as poster
where poster.cloudinary_asset_id = assignment.poster_cloudinary_asset_id;

alter table public.product_media
  alter column media_library_id set not null,
  add constraint product_media_media_library_id_fkey
    foreign key (media_library_id) references public.media_library(id) on delete restrict,
  add constraint product_media_poster_media_library_id_fkey
    foreign key (poster_media_library_id) references public.media_library(id) on delete restrict;

create unique index product_media_product_library_idx
  on public.product_media (product_id, media_library_id);

create index product_media_library_lookup_idx
  on public.product_media (media_library_id);

create index product_media_poster_library_lookup_idx
  on public.product_media (poster_media_library_id)
  where poster_media_library_id is not null;

delete from public.product_media where deleted_at is not null;

drop policy if exists"Public can read media for published products" on public.product_media;

drop index if exists public.product_media_active_order_idx;

alter table public.product_media
  drop constraint product_media_product_id_cloudinary_asset_id_key,
  drop column media_type,
  drop column cloudinary_asset_id,
  drop column cloudinary_public_id,
  drop column media_url,
  drop column alt_text,
  drop column poster_cloudinary_asset_id,
  drop column poster_cloudinary_public_id,
  drop column poster_url,
  drop column deleted_at,
  drop column cleanup_pending_assets;

create index product_media_product_order_idx
  on public.product_media (product_id, sort_order);

create policy "Public can read media for published products"
  on public.product_media for select to anon, authenticated
  using (
    exists (
      select 1 from public.products
      where products.id = product_media.product_id
        and products.is_published
        and products.archived_at is null
    )
  );

drop table public.homepage_media;

alter table public.media_library enable row level security;

create policy "Owners manage media library"
  on public.media_library for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "Public can read media assigned to published products"
  on public.media_library for select to anon, authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.product_media as assignment
      join public.products as product on product.id = assignment.product_id
      where assignment.media_library_id = media_library.id
        and product.is_published
        and product.archived_at is null
    )
  );
