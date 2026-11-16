alter table public.products
  add column sku text;

update public.products
set sku = 'SJQ-' || upper(replace(id::text, '-', ''))
where sku is null;

alter table public.products
  alter column sku set not null;

create unique index products_sku_case_insensitive_idx
  on public.products (lower(sku));
