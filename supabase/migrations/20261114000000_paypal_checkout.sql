alter table public.orders
  add column paypal_order_id text unique,
  add column paypal_capture_id text unique;

alter table public.payments
  add column refund_status text not null default 'none'
    check (refund_status in ('none', 'pending', 'refunded', 'failed'));

create table public.checkout_reservations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'capturing', 'completed', 'cancelled', 'expired', 'failed')),
  customer_name text not null,
  customer_email text not null,
  shipping_address jsonb not null,
  subtotal numeric(10, 2) not null default 0 check (subtotal >= 0),
  shipping_amount numeric(10, 2) not null check (shipping_amount >= 0),
  total_amount numeric(10, 2) not null default 0 check (total_amount >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  paypal_order_id text unique,
  order_id uuid references public.orders(id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index checkout_reservations_expiration_idx
  on public.checkout_reservations (expires_at)
  where status in ('pending', 'capturing');

create table public.checkout_reservation_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.checkout_reservations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name_snapshot text not null,
  product_sku_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  line_total numeric(10, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index checkout_reservation_items_reservation_idx
  on public.checkout_reservation_items (reservation_id);

create table public.paypal_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

alter table public.checkout_reservations enable row level security;
alter table public.checkout_reservation_items enable row level security;
alter table public.paypal_webhook_events enable row level security;

create trigger checkout_reservations_set_updated_at before update on public.checkout_reservations
  for each row execute function public.set_updated_at();

create function public.create_checkout_reservation(
  p_idempotency_key text,
  p_customer_name text,
  p_customer_email text,
  p_shipping_address jsonb,
  p_items jsonb,
  p_shipping_amount numeric,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.checkout_reservations%rowtype;
  v_product public.products%rowtype;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_line_total numeric(10, 2);
begin
  if p_idempotency_key is null
    or length(p_idempotency_key) not between 1 and 128
    or p_customer_name is null
    or p_customer_email is null
    or p_shipping_address is null
    or p_items is null
    or p_shipping_amount is null
    or p_expires_at is null
  then
    raise exception 'INVALID_CHECKOUT';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'INVALID_CHECKOUT';
  end if;
  if jsonb_array_length(p_items) not between 1 and 30
    or jsonb_typeof(p_shipping_address) is distinct from 'object'
    or p_shipping_amount < 0
    or p_expires_at <= now()
  then
    raise exception 'INVALID_CHECKOUT';
  end if;

  insert into public.checkout_reservations (
    idempotency_key, customer_name, customer_email, shipping_address,
    shipping_amount, expires_at
  ) values (
    p_idempotency_key, p_customer_name, p_customer_email, p_shipping_address,
    p_shipping_amount, p_expires_at
  )
  on conflict (idempotency_key) do nothing
  returning * into v_reservation;

  if v_reservation.id is null then
    select * into v_reservation
    from public.checkout_reservations
    where idempotency_key = p_idempotency_key;
    if v_reservation.status not in ('pending', 'capturing')
      or v_reservation.expires_at <= now()
      or v_reservation.paypal_order_id is null
    then
      raise exception 'CHECKOUT_ALREADY_PROCESSED';
    end if;
    return to_jsonb(v_reservation) || jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(to_jsonb(ri) order by ri.created_at)
        from public.checkout_reservation_items ri
        where ri.reservation_id = v_reservation.id
      ), '[]'::jsonb)
    );
  end if;

  for v_item in
    select item.value from jsonb_array_elements(p_items) as item(value)
    order by item.value->>'productId'
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity not between 1 and 99 then
      raise exception 'INVALID_CHECKOUT';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id
    for update;
    if not found or not v_product.is_published or v_product.archived_at is not null then
      raise exception 'PRODUCT_UNAVAILABLE';
    end if;
    if v_product.fulfillment_type <> 'ready_to_ship' then
      raise exception 'CUSTOM_ORDERS_BY_EMAIL';
    end if;
    if v_product.inventory_quantity < v_quantity then
      raise exception 'OUT_OF_STOCK';
    end if;

    update public.products
    set inventory_quantity = inventory_quantity - v_quantity
    where id = v_product.id;

    v_line_total := round(v_product.price * v_quantity, 2);
    insert into public.checkout_reservation_items (
      reservation_id, product_id, product_name_snapshot, product_sku_snapshot,
      quantity, unit_price, line_total
    ) values (
      v_reservation.id, v_product.id, v_product.name, v_product.sku,
      v_quantity, v_product.price, v_line_total
    );
    v_reservation.subtotal := v_reservation.subtotal + v_line_total;
  end loop;

  if v_reservation.subtotal + v_reservation.shipping_amount <= 0
    or v_reservation.subtotal + v_reservation.shipping_amount > 99999999.99
  then
    raise exception 'INVALID_CHECKOUT';
  end if;

  update public.checkout_reservations
  set subtotal = v_reservation.subtotal,
      total_amount = v_reservation.subtotal + shipping_amount
  where id = v_reservation.id
  returning * into v_reservation;

  return to_jsonb(v_reservation) || jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(ri) order by ri.created_at)
      from public.checkout_reservation_items ri
      where ri.reservation_id = v_reservation.id
    ), '[]'::jsonb)
  );
end;
$$;

create function public.set_checkout_paypal_order(
  p_reservation_id uuid,
  p_paypal_order_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.checkout_reservations
  set paypal_order_id = p_paypal_order_id
  where id = p_reservation_id
    and status = 'pending'
    and expires_at > now()
    and paypal_order_id is null;
  return found;
end;
$$;

create function public.begin_checkout_capture(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.checkout_reservations
  set status = 'capturing',
      expires_at = now() + interval '10 minutes'
  where id = p_reservation_id
    and status in ('pending', 'capturing')
    and expires_at > now()
    and paypal_order_id is not null;
  return found;
end;
$$;

create function public.release_checkout_reservation(
  p_reservation_id uuid,
  p_status text default 'cancelled'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.checkout_reservations%rowtype;
  v_item record;
begin
  if p_status not in ('cancelled', 'expired', 'failed') then
    raise exception 'INVALID_RESERVATION_STATUS';
  end if;

  select * into v_reservation
  from public.checkout_reservations
  where id = p_reservation_id
  for update;
  if not found
    or v_reservation.order_id is not null
    or (
      v_reservation.status <> 'pending'
      and not (v_reservation.status = 'capturing' and p_status in ('expired', 'failed'))
    )
  then
    return false;
  end if;

  update public.checkout_reservations
  set status = p_status
  where id = v_reservation.id;
  for v_item in
    select product_id, quantity
    from public.checkout_reservation_items
    where reservation_id = v_reservation.id
  loop
    if v_item.product_id is not null then
      update public.products
      set inventory_quantity = inventory_quantity + v_item.quantity
      where id = v_item.product_id;
    end if;
  end loop;
  return true;
end;
$$;

create function public.expire_checkout_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation_id uuid;
  v_expired integer := 0;
begin
  for v_reservation_id in
    select id
    from public.checkout_reservations
    where status in ('pending', 'capturing') and expires_at <= now()
    order by expires_at
    for update skip locked
  loop
    if public.release_checkout_reservation(v_reservation_id, 'expired') then
      v_expired := v_expired + 1;
    end if;
  end loop;
  return v_expired;
end;
$$;

create function public.complete_checkout_reservation(
  p_reservation_id uuid,
  p_paypal_order_id text,
  p_paypal_capture_id text,
  p_capture_amount numeric,
  p_capture_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.checkout_reservations%rowtype;
  v_order public.orders%rowtype;
  v_item record;
begin
  select * into v_reservation
  from public.checkout_reservations
  where id = p_reservation_id
  for update;
  if not found or v_reservation.paypal_order_id <> p_paypal_order_id then
    raise exception 'RESERVATION_NOT_FOUND';
  end if;
  if v_reservation.status = 'completed' and v_reservation.order_id is not null then
    select * into v_order from public.orders where id = v_reservation.order_id;
    return jsonb_build_object('id', v_order.id, 'order_number', v_order.order_number);
  end if;
  if v_reservation.status not in ('pending', 'capturing') or v_reservation.expires_at <= now() then
    raise exception 'RESERVATION_EXPIRED';
  end if;
  if p_capture_currency <> v_reservation.currency
    or p_capture_amount <> v_reservation.total_amount
  then
    raise exception 'CAPTURE_AMOUNT_MISMATCH';
  end if;

  insert into public.orders (
    status, customer_email, customer_name, shipping_address, subtotal,
    shipping_amount, total_amount, currency, idempotency_key,
    paypal_order_id, paypal_capture_id
  ) values (
    'paid', v_reservation.customer_email, v_reservation.customer_name,
    v_reservation.shipping_address, v_reservation.subtotal,
    v_reservation.shipping_amount, v_reservation.total_amount,
    v_reservation.currency, v_reservation.idempotency_key,
    p_paypal_order_id, p_paypal_capture_id
  )
  returning * into v_order;

  for v_item in
    select product_id, product_name_snapshot, product_sku_snapshot,
      quantity, unit_price, line_total
    from public.checkout_reservation_items
    where reservation_id = v_reservation.id
  loop
    insert into public.order_items (
      order_id, product_id, product_name_snapshot, product_sku_snapshot,
      quantity, unit_price, line_total
    ) values (
      v_order.id, v_item.product_id, v_item.product_name_snapshot,
      v_item.product_sku_snapshot, v_item.quantity, v_item.unit_price,
      v_item.line_total
    );
  end loop;

  insert into public.payments (
    order_id, provider, provider_order_id, provider_transaction_id,
    status, amount, currency, refund_status
  ) values (
    v_order.id, 'paypal', p_paypal_order_id, p_paypal_capture_id,
    'captured', v_reservation.total_amount, v_reservation.currency, 'none'
  );

  update public.checkout_reservations
  set status = 'completed', order_id = v_order.id
  where id = v_reservation.id;

  return jsonb_build_object('id', v_order.id, 'order_number', v_order.order_number);
end;
$$;

alter table public.payments add column provider_refund_id text;

create function public.record_paypal_refund(
  p_paypal_capture_id text,
  p_refund_id text,
  p_cancelled boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment
  from public.payments
  where provider = 'paypal' and provider_transaction_id = p_paypal_capture_id
  for update;
  if not found then
    return false;
  end if;

  update public.payments
  set status = 'refunded', refund_status = 'refunded',
      provider_refund_id = coalesce(p_refund_id, provider_refund_id)
  where id = v_payment.id;
  update public.orders
  set status = case when p_cancelled then 'cancelled' else 'refunded' end
  where id = v_payment.order_id
    and (status in ('paid', 'processing') or (p_cancelled and status = 'refunded'));
  return true;
end;
$$;

revoke all on function public.create_checkout_reservation(text, text, text, jsonb, jsonb, numeric, timestamptz) from public, anon, authenticated;
revoke all on function public.set_checkout_paypal_order(uuid, text) from public, anon, authenticated;
revoke all on function public.begin_checkout_capture(uuid) from public, anon, authenticated;
revoke all on function public.release_checkout_reservation(uuid, text) from public, anon, authenticated;
revoke all on function public.expire_checkout_reservations() from public, anon, authenticated;
revoke all on function public.complete_checkout_reservation(uuid, text, text, numeric, text) from public, anon, authenticated;
revoke all on function public.record_paypal_refund(text, text, boolean) from public, anon, authenticated;
grant execute on function public.create_checkout_reservation(text, text, text, jsonb, jsonb, numeric, timestamptz) to service_role;
grant execute on function public.set_checkout_paypal_order(uuid, text) to service_role;
grant execute on function public.begin_checkout_capture(uuid) to service_role;
grant execute on function public.release_checkout_reservation(uuid, text) to service_role;
grant execute on function public.expire_checkout_reservations() to service_role;
grant execute on function public.complete_checkout_reservation(uuid, text, text, numeric, text) to service_role;
grant execute on function public.record_paypal_refund(text, text, boolean) to service_role;
