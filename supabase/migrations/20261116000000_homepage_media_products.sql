alter table public.products
  add column subcategory text
    check (subcategory is null or category_id is not null);

alter table public.products
  drop column sku;

alter table public.order_items
  drop column product_sku_snapshot;

alter table public.checkout_reservation_items
  drop column product_sku_snapshot;

create table public.homepage_media (
  id uuid primary key default gen_random_uuid(),
  media_type text not null check (media_type in ('image', 'video')),
  cloudinary_asset_id text not null unique,
  cloudinary_public_id text not null unique,
  media_url text not null,
  alt_text text,
  created_at timestamptz not null default now()
);

alter table public.homepage_media enable row level security;

create policy "Owners manage homepage media"
  on public.homepage_media for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create or replace function public.create_checkout_reservation(
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
      reservation_id, product_id, product_name_snapshot,
      quantity, unit_price, line_total
    ) values (
      v_reservation.id, v_product.id, v_product.name,
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

create or replace function public.complete_checkout_reservation(
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
    select product_id, product_name_snapshot, quantity, unit_price, line_total
    from public.checkout_reservation_items
    where reservation_id = v_reservation.id
  loop
    insert into public.order_items (
      order_id, product_id, product_name_snapshot,
      quantity, unit_price, line_total
    ) values (
      v_order.id, v_item.product_id, v_item.product_name_snapshot,
      v_item.quantity, v_item.unit_price, v_item.line_total
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
