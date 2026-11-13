create table public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  customer_name text not null,
  customer_email text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index contact_submissions_email_created_idx
  on public.contact_submissions (customer_email, created_at desc);

alter table public.email_logs
  drop constraint email_logs_status_check,
  alter column recipient drop not null,
  add column email_key text unique,
  add column recipient_role text not null default 'customer'
    check (recipient_role in ('customer', 'owner')),
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column cycle_attempt_count integer not null default 0 check (cycle_attempt_count between 0 and 5),
  add column manual_retry_count integer not null default 0 check (manual_retry_count between 0 and 2),
  add column max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  add column next_attempt_at timestamptz not null default now(),
  add column claim_token uuid,
  add column last_attempt_at timestamptz,
  add column sent_at timestamptz,
  add column error_details text,
  add column retryable boolean not null default true,
  add column related_contact_id uuid references public.contact_submissions(id) on delete set null,
  add column updated_at timestamptz not null default now(),
  add constraint email_logs_status_check
    check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'complained'));

create index email_logs_queue_idx on public.email_logs (next_attempt_at, created_at)
  where status in ('queued', 'sending');
create unique index email_logs_provider_message_idx on public.email_logs (provider_message_id)
  where provider_message_id is not null;

update public.email_logs
set status = 'failed',
    retryable = false,
    error_details = 'This email record predates the retryable delivery queue.'
where email_key is null and status = 'queued';
update public.email_logs set retryable = false where email_key is null;

create table public.resend_webhook_events (
  event_id text primary key,
  event_type text not null,
  provider_message_id text not null,
  error_details text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index resend_webhook_pending_idx
  on public.resend_webhook_events (provider_message_id, received_at)
  where processed_at is null;

alter table public.contact_submissions enable row level security;
alter table public.resend_webhook_events enable row level security;

create trigger email_logs_set_updated_at before update on public.email_logs
  for each row execute function public.set_updated_at();

create function public.enqueue_order_email_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid'
    and (tg_op = 'INSERT' or old.status is distinct from new.status)
  then
    insert into public.email_logs (
      recipient, recipient_role, template_key, status, related_order_id,
      email_key, next_attempt_at
    ) values
      (new.customer_email, 'customer', 'customer_order_confirmation', 'queued', new.id,
        'order:' || new.id::text || ':customer-order', now()),
      (new.customer_email, 'customer', 'customer_payment_confirmation', 'queued', new.id,
        'order:' || new.id::text || ':customer-payment', now()),
      (null, 'owner', 'owner_new_paid_order', 'queued', new.id,
        'order:' || new.id::text || ':owner-new-order', now())
    on conflict (email_key) do nothing;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status
    and new.status in ('cancelled', 'refunded')
  then
    insert into public.email_logs (
      recipient, recipient_role, template_key, status, related_order_id,
      email_key, next_attempt_at
    ) values (
      new.customer_email,
      'customer',
      case when new.status = 'cancelled' then 'customer_cancellation' else 'customer_refund' end,
      'queued',
      new.id,
      'order:' || new.id::text || ':' || new.status,
      now()
    )
    on conflict (email_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger orders_enqueue_paid_emails_after_insert
  after insert on public.orders
  for each row execute function public.enqueue_order_email_notifications();
create trigger orders_enqueue_status_emails_after_update
  after update of status on public.orders
  for each row execute function public.enqueue_order_email_notifications();

create function public.enqueue_shipping_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tracking_key text;
begin
  if new.fulfillment_status = 'shipped'
    and nullif(btrim(new.tracking_number), '') is not null
    and (
      old.fulfillment_status is distinct from new.fulfillment_status
      or old.tracking_number is distinct from new.tracking_number
    )
  then
    v_tracking_key := md5(new.tracking_number);
    insert into public.email_logs (
      recipient, recipient_role, template_key, status, related_order_id,
      email_key, next_attempt_at
    ) values (
      new.customer_email,
      'customer',
      'customer_shipping_confirmation',
      'queued',
      new.id,
      'order:' || new.id::text || ':shipping:' || v_tracking_key,
      now()
    )
    on conflict (email_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger orders_enqueue_shipping_email
  after update of fulfillment_status, shipping_carrier, tracking_number on public.orders
  for each row execute function public.enqueue_shipping_confirmation();

create function public.create_contact_email_notification(
  p_idempotency_key text,
  p_customer_name text,
  p_customer_email text,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_id uuid;
begin
  if p_idempotency_key is null
    or length(p_idempotency_key) not between 1 and 128
    or nullif(btrim(p_customer_name), '') is null
    or nullif(btrim(p_customer_email), '') is null
    or nullif(btrim(p_message), '') is null
  then
    raise exception 'INVALID_CONTACT_SUBMISSION';
  end if;

  if v_contact_id is null then
    select id into v_contact_id from public.contact_submissions
    where idempotency_key = p_idempotency_key;
  end if;
  if v_contact_id is null then
    if (
      select count(*) from public.contact_submissions
      where customer_email = lower(btrim(p_customer_email))
        and created_at > now() - interval '1 hour'
    ) >= 5 then
      raise exception using message = 'CONTACT_RATE_LIMIT';
    end if;
    insert into public.contact_submissions (
      idempotency_key, customer_name, customer_email, message
    ) values (
      p_idempotency_key, btrim(p_customer_name), lower(btrim(p_customer_email)), btrim(p_message)
    )
    on conflict (idempotency_key) do nothing
    returning id into v_contact_id;
  end if;
  if v_contact_id is null then
    select id into v_contact_id from public.contact_submissions
    where idempotency_key = p_idempotency_key;
  end if;

  insert into public.email_logs (
    recipient, recipient_role, template_key, status, related_contact_id,
    email_key, next_attempt_at
  ) values (
    null, 'owner', 'owner_customer_contact', 'queued', v_contact_id,
    'contact:' || v_contact_id::text, now()
  )
  on conflict (email_key) do nothing;

  return v_contact_id;
end;
$$;

create function public.update_order_fulfillment_and_enqueue(
  p_order_id uuid,
  p_fulfillment_status text,
  p_shipping_carrier text,
  p_tracking_number text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_fulfillment_status is null
    or p_fulfillment_status not in ('processing', 'shipped', 'fulfilled', 'returned')
  then
    raise exception 'INVALID_FULFILLMENT_STATUS';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return false;
  end if;
  if v_order.status in ('refunded', 'cancelled') then
    raise exception 'ORDER_NOT_FULFILLABLE';
  end if;

  update public.orders
  set fulfillment_status = p_fulfillment_status,
      shipping_carrier = p_shipping_carrier,
      tracking_number = p_tracking_number,
      shipped_at = case
        when p_fulfillment_status = 'shipped' then coalesce(shipped_at, now())
        else shipped_at
      end,
      fulfilled_at = case
        when p_fulfillment_status = 'fulfilled' then coalesce(fulfilled_at, now())
        else fulfilled_at
      end
  where id = p_order_id;

  return true;
end;
$$;

create function public.claim_email_logs(p_batch_size integer default 10)
returns setof public.email_logs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_batch_size not between 1 and 50 then
    raise exception 'INVALID_EMAIL_BATCH_SIZE';
  end if;

  update public.email_logs
  set status = 'failed',
      error_details = coalesce(error_details, 'Maximum email delivery attempts reached.')
  where cycle_attempt_count >= max_attempts
    and (
      status = 'queued'
      or (status = 'sending' and last_attempt_at < now() - interval '5 minutes')
    );

  return query
    with candidates as (
      select id
      from public.email_logs
      where cycle_attempt_count < max_attempts
        and (
          (status = 'queued' and next_attempt_at <= now())
          or (status = 'sending' and last_attempt_at < now() - interval '5 minutes')
        )
      order by next_attempt_at, created_at
      for update skip locked
      limit p_batch_size
    )
    update public.email_logs as logs
    set status = 'sending',
        attempt_count = logs.attempt_count + 1,
        cycle_attempt_count = logs.cycle_attempt_count + 1,
        last_attempt_at = now(),
        next_attempt_at = now(),
        claim_token = gen_random_uuid()
    from candidates
    where logs.id = candidates.id
    returning logs.*;
end;
$$;

create function public.record_email_log_sent(
  p_log_id uuid,
  p_claim_token uuid,
  p_provider_message_id text,
  p_recipient text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_status text;
begin
  update public.email_logs
  set status = 'sent',
      provider_message_id = p_provider_message_id,
      recipient = p_recipient,
      sent_at = now(),
      error_details = null,
      retryable = false,
      next_attempt_at = now(),
      claim_token = null
  where id = p_log_id and status = 'sending' and claim_token = p_claim_token;
  if not found then
    return false;
  end if;

  for v_event in
    select event_id, event_type, error_details
    from public.resend_webhook_events
    where provider_message_id = p_provider_message_id and processed_at is null
    order by received_at
  loop
    v_status := case v_event.event_type
      when 'email.delivered' then 'delivered'
      when 'email.bounced' then 'bounced'
      when 'email.complained' then 'complained'
      when 'email.failed' then 'failed'
      else null
    end;
    if v_status is not null then
      update public.email_logs
      set status = v_status,
          retryable = false,
          error_details = case
            when v_status = 'delivered' then null
            else coalesce(v_event.error_details, 'Resend reported an email delivery failure.')
          end
      where id = p_log_id;
      update public.resend_webhook_events
      set processed_at = now()
      where event_id = v_event.event_id;
    end if;
  end loop;
  return true;
end;
$$;

create function public.record_email_log_failure(
  p_log_id uuid,
  p_claim_token uuid,
  p_error_details text,
  p_retryable boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.email_logs
  set status = case
        when p_retryable and cycle_attempt_count < max_attempts then 'queued'
        else 'failed'
      end,
      error_details = left(p_error_details, 2000),
      retryable = p_retryable,
      next_attempt_at = case
        when p_retryable and cycle_attempt_count < max_attempts
          then now() + interval '1 minute' * power(2, greatest(cycle_attempt_count - 1, 0))
        else now()
      end,
      claim_token = null
  where id = p_log_id and status = 'sending' and claim_token = p_claim_token;
  return found;
end;
$$;

create function public.retry_email_log(p_log_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.email_logs
  set status = 'queued', next_attempt_at = now(), claim_token = null
  where id = p_log_id
    and status = 'failed'
    and retryable
    and manual_retry_count < 2;
  if found then
    update public.email_logs
    set cycle_attempt_count = 0,
        manual_retry_count = manual_retry_count + 1
    where id = p_log_id;
  end if;
  return found;
end;
$$;

create function public.record_resend_webhook(
  p_event_id text,
  p_event_type text,
  p_provider_message_id text,
  p_error_details text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted_event text;
  v_status text;
begin
  v_status := case p_event_type
    when 'email.delivered' then 'delivered'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.failed' then 'failed'
    else null
  end;
  if p_event_id is null or length(p_event_id) > 200
    or p_provider_message_id is null or v_status is null
  then
    raise exception 'INVALID_RESEND_EVENT';
  end if;

  insert into public.resend_webhook_events (event_id, event_type, provider_message_id, error_details)
  values (
    p_event_id,
    p_event_type,
    p_provider_message_id,
    case when v_status = 'delivered' then null
      else left(coalesce(nullif(btrim(p_error_details), ''), 'Resend reported an email delivery failure.'), 1000)
    end
  )
  on conflict (event_id) do nothing
  returning event_id into v_inserted_event;
  if v_inserted_event is null then
    return false;
  end if;

  update public.email_logs
  set status = v_status,
      retryable = false,
      error_details = case
        when v_status = 'delivered' then null
        else left(coalesce(nullif(btrim(p_error_details), ''), 'Resend reported an email delivery failure.'), 1000)
      end
  where provider_message_id = p_provider_message_id;
  if found then
    update public.resend_webhook_events
    set processed_at = now()
    where event_id = p_event_id;
  end if;
  return true;
end;
$$;

revoke all on function public.create_contact_email_notification(text, text, text, text) from public, anon, authenticated;
revoke all on function public.update_order_fulfillment_and_enqueue(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_email_logs(integer) from public, anon, authenticated;
revoke all on function public.record_email_log_sent(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.record_email_log_failure(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.retry_email_log(uuid) from public, anon, authenticated;
revoke all on function public.record_resend_webhook(text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_contact_email_notification(text, text, text, text) to service_role;
grant execute on function public.update_order_fulfillment_and_enqueue(uuid, text, text, text) to service_role;
grant execute on function public.claim_email_logs(integer) to service_role;
grant execute on function public.record_email_log_sent(uuid, uuid, text, text) to service_role;
grant execute on function public.record_email_log_failure(uuid, uuid, text, boolean) to service_role;
grant execute on function public.retry_email_log(uuid) to service_role;
grant execute on function public.record_resend_webhook(text, text, text, text) to service_role;
