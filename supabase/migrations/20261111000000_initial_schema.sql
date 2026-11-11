create extension if not exists pgcrypto;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text not null default '',
  price numeric(10, 2) not null check (price >= 0),
  sku text not null unique,
  inventory_quantity integer not null default 0 check (inventory_quantity >= 0),
  fulfillment_type text not null default 'ready_to_ship'
    check (fulfillment_type in ('ready_to_ship', 'made_to_order')),
  is_published boolean not null default false,
  is_featured boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_public_catalog_idx on public.products (category_id, created_at desc)
  where is_published and archived_at is null;

create table public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  cloudinary_asset_id text not null,
  media_url text not null,
  alt_text text,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (product_id, cloudinary_asset_id)
);

create unique index product_media_one_primary_idx on public.product_media (product_id)
  where is_primary;
create index product_media_order_idx on public.product_media (product_id, sort_order);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'processing', 'shipped', 'fulfilled', 'cancelled', 'refunded')),
  customer_email text not null,
  customer_name text not null,
  shipping_address jsonb not null,
  billing_address jsonb,
  subtotal numeric(10, 2) not null check (subtotal >= 0),
  tax_amount numeric(10, 2) not null default 0 check (tax_amount >= 0),
  shipping_amount numeric(10, 2) not null default 0 check (shipping_amount >= 0),
  total_amount numeric(10, 2) not null check (total_amount >= 0),
  currency text not null default 'USD',
  fulfillment_status text not null default 'unfulfilled'
    check (fulfillment_status in ('unfulfilled', 'processing', 'shipped', 'fulfilled', 'returned')),
  shipping_carrier text,
  tracking_number text,
  shipped_at timestamptz,
  fulfilled_at timestamptz,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_created_at_idx on public.orders (created_at desc);
create index orders_customer_email_idx on public.orders (customer_email);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  product_name_snapshot text not null,
  product_sku_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  line_total numeric(10, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items (order_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null check (provider in ('paypal')),
  provider_order_id text,
  provider_transaction_id text,
  status text not null default 'created'
    check (status in ('created', 'approved', 'captured', 'failed', 'refunded')),
  amount numeric(10, 2) not null check (amount >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

create index payments_order_id_idx on public.payments (order_id);

create table public.homepage_content (
  id uuid primary key default gen_random_uuid(),
  content_key text not null unique,
  content jsonb not null default '{}'::jsonb,
  is_published boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text,
  recipient text not null,
  template_key text not null,
  status text not null check (status in ('queued', 'sent', 'failed')),
  related_order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create trigger homepage_content_set_updated_at before update on public.homepage_content
  for each row execute function public.set_updated_at();

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_media enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.homepage_content enable row level security;
alter table public.email_logs enable row level security;
alter table public.admin_audit_logs enable row level security;

create policy "Public can read published categories"
  on public.categories for select to anon, authenticated
  using (is_published);

create policy "Public can read published products"
  on public.products for select to anon, authenticated
  using (is_published and archived_at is null);

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

create policy "Public can read published homepage content"
  on public.homepage_content for select to anon, authenticated
  using (is_published);

-- Orders, payments, email logs, audit records, and writes have no public policies.
