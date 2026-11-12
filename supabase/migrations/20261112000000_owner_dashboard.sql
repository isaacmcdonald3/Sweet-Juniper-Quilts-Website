alter table public.products
  add column low_inventory_threshold integer not null default 2
  check (low_inventory_threshold >= 0);

alter table public.products
  drop constraint products_category_id_fkey,
  add constraint products_category_id_fkey
    foreign key (category_id) references public.categories(id) on delete restrict;

create function public.is_owner()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'is_owner', '') = 'true';
$$;

grant execute on function public.is_owner() to authenticated;

create policy "Owners manage categories"
  on public.categories for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "Owners manage products"
  on public.products for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "Owners manage product media"
  on public.product_media for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "Owners manage homepage content"
  on public.homepage_content for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "Owners read orders"
  on public.orders for select to authenticated
  using (public.is_owner());

create policy "Owners read order items"
  on public.order_items for select to authenticated
  using (public.is_owner());

create policy "Owners read payments"
  on public.payments for select to authenticated
  using (public.is_owner());

create policy "Owners read email logs"
  on public.email_logs for select to authenticated
  using (public.is_owner());

create policy "Owners read admin audit logs"
  on public.admin_audit_logs for select to authenticated
  using (public.is_owner());
