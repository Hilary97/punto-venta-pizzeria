-- Scheduled orders (pedidos para una hora).
--
-- A waiter may set the time a customer picks up an order (today, later than
-- now, America/Mexico_City). The order waits outside the kitchen without a
-- physical token; it enters the station queue `scheduled_lead_minutes` (admin
-- setting, default 20) before that time, taking the lowest free token then.
--
--   * orders.scheduled_for: pickup time; null for ordinary orders.
--   * orders.queued_at: when the order entered the kitchen queue; null while
--     a scheduled order waits. Ordinary orders are queued at creation.
--
-- Nothing runs on a timer: release_scheduled_orders() queues due orders and
-- is called by the kitchen and waiter list RPCs. Boards reload at least every
-- 60 seconds, and the order update sends the realtime signal to the others.
-- Kitchen tickets are timed at queue entry, so delay alerts start there.
--
-- Runs as one script (Supabase SQL Editor).

-- ============================================================================
-- A. Clock, columns and setting
-- ============================================================================

-- Server clock for the scheduled order rules; tests replace it.
create or replace function public.app_now()
returns timestamptz
language sql
stable
as $$ select now() $$;

revoke all on function public.app_now() from public, anon, authenticated;

alter table public.orders add column if not exists scheduled_for timestamptz;
alter table public.orders add column if not exists queued_at timestamptz;

update public.orders set queued_at = created_at where queued_at is null and scheduled_for is null;

alter table public.orders drop constraint if exists orders_queued_or_scheduled;
alter table public.orders add constraint orders_queued_or_scheduled
  check (queued_at is not null or scheduled_for is not null);

create index if not exists orders_waiting_scheduled_idx
  on public.orders (scheduled_for) where status = 'open' and queued_at is null;

-- Single-row table (id is always true).
create table if not exists public.order_settings (
  id boolean primary key default true check (id),
  scheduled_lead_minutes integer not null default 20
    check (scheduled_lead_minutes between 0 and 240)
);

insert into public.order_settings (id) values (true) on conflict (id) do nothing;

alter table public.order_settings enable row level security;
revoke all on public.order_settings from public, anon, authenticated;

create or replace function public.scheduled_lead() returns interval
language sql
stable
security definer
set search_path = public
as $$
  select make_interval(mins => scheduled_lead_minutes) from public.order_settings where id
$$;

revoke all on function public.scheduled_lead() from public, anon, authenticated;

create or replace function public.get_order_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  return (select jsonb_build_object('scheduled_lead_minutes', scheduled_lead_minutes) from public.order_settings where id);
end;
$$;

create or replace function public.admin_set_scheduled_lead_minutes(p_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cambiar la anticipación de los pedidos programados.';
  end if;
  if p_minutes is null or p_minutes < 0 or p_minutes > 240 then
    raise exception 'La anticipación debe estar entre 0 y 240 minutos.';
  end if;

  update public.order_settings set scheduled_lead_minutes = p_minutes where id;
  return jsonb_build_object('scheduled_lead_minutes', p_minutes);
end;
$$;

revoke all on function public.get_order_settings() from public, anon;
grant execute on function public.get_order_settings() to authenticated;
revoke all on function public.admin_set_scheduled_lead_minutes(integer) from public, anon;
grant execute on function public.admin_set_scheduled_lead_minutes(integer) to authenticated;

-- ============================================================================
-- B. Tokens and queue entry
-- ============================================================================

-- Lowest token 1..50 not held by an open order; null when all are held.
-- Callers hold the token advisory lock.
create or replace function public.free_order_token()
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select min(n)::smallint
  from generate_series(1, 50) as n
  where not exists (
    select 1 from public.orders o where o.status = 'open' and o.token = n
  )
$$;

revoke all on function public.free_order_token() from public, anon, authenticated;

-- Token trigger (20261018120000) plus queue entry: a scheduled order outside
-- the lead window waits without a token.
create or replace function public.assign_order_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.scheduled_for is not null and new.scheduled_for - public.scheduled_lead() > public.app_now() then
    new.token := null;
    new.queued_at := null;
    return new;
  end if;

  -- Serializes concurrent order creation so two orders never pick the same token.
  perform pg_advisory_xact_lock(hashtext('public.orders.token'));

  new.token := public.free_order_token();
  new.queued_at := public.app_now();
  return new;
end;
$$;

-- Queues every waiting scheduled order that is due, oldest time first.
-- Writes (and signals the boards) only when there is one.
create or replace function public.release_scheduled_orders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due timestamptz := public.app_now() + public.scheduled_lead();
  v_id uuid;
begin
  if not exists (
    select 1 from public.orders
    where status = 'open' and queued_at is null and scheduled_for <= v_due
  ) then
    return;
  end if;

  -- Same lock as order creation, so a released order never shares a token.
  perform pg_advisory_xact_lock(hashtext('public.orders.token'));

  -- Orders locked by a payment or cancellation are released on a later list.
  for v_id in
    select id from public.orders
    where status = 'open' and queued_at is null and scheduled_for <= v_due
    order by scheduled_for, created_at, id
    for update skip locked
  loop
    update public.orders
    set queued_at = public.app_now(), token = public.free_order_token()
    where id = v_id;
  end loop;
end;
$$;

revoke all on function public.release_scheduled_orders() from public, anon, authenticated;

-- ============================================================================
-- C. Creating orders with a pickup time
-- ============================================================================

-- insert_order_core (20261005120000) plus p_scheduled_for.
drop function if exists public.insert_order_core(uuid, uuid, text, integer, text, jsonb, text);

create or replace function public.insert_order_core(
  p_created_by uuid,
  p_waiter_id uuid,
  p_waiter_name text,
  p_table_number integer,
  p_customer_name text,
  p_items jsonb,
  p_notes text,
  p_scheduled_for timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_name text := nullif(btrim(p_customer_name), '');
  v_notes text := public.normalize_order_notes(p_notes);
  v_order_id uuid;
begin
  if p_table_number is not null and (p_table_number < 1 or p_table_number > 9) then
    raise exception 'El número de mesa no es válido.';
  end if;

  if v_customer_name is not null and length(v_customer_name) > 80 then
    raise exception 'El nombre del cliente no es válido.';
  end if;

  if p_table_number is null and v_customer_name is null then
    raise exception 'Indica la mesa o el nombre del cliente.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe incluir al menos un producto.';
  end if;

  if p_scheduled_for is not null and (
    p_scheduled_for <= public.app_now()
    or (p_scheduled_for at time zone 'America/Mexico_City')::date
       <> (public.app_now() at time zone 'America/Mexico_City')::date
  ) then
    raise exception 'La hora del pedido debe ser más tarde hoy.';
  end if;

  insert into public.orders (table_number, customer_name, created_by, waiter_id, waiter_name, notes, scheduled_for)
  values (p_table_number, v_customer_name, p_created_by, p_waiter_id, p_waiter_name, v_notes, p_scheduled_for)
  returning id into v_order_id;

  perform public.insert_order_lines(v_order_id, p_items);

  return v_order_id;
end;
$$;

revoke all on function public.insert_order_core(uuid, uuid, text, integer, text, jsonb, text, timestamptz)
  from public, anon, authenticated;

-- create_order (20261005120000) plus p_scheduled_for.
drop function if exists public.create_order(integer, text, jsonb, text);

create or replace function public.create_order(
  p_table_number integer,
  p_customer_name text,
  p_items jsonb,
  p_notes text default null,
  p_scheduled_for timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para crear un pedido.';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is null or v_role not in ('admin', 'cashier') then
    raise exception 'Los pedidos de meseros se registran desde un dispositivo autorizado.';
  end if;

  return jsonb_build_object(
    'order_id',
    public.insert_order_core(v_uid, null, null, p_table_number, p_customer_name, p_items, p_notes, p_scheduled_for)
  );
end;
$$;

revoke all on function public.create_order(integer, text, jsonb, text, timestamptz) from public, anon;
grant execute on function public.create_order(integer, text, jsonb, text, timestamptz) to authenticated;

-- device_create_order (20261014120000) plus p_scheduled_for.
drop function if exists public.device_create_order(text, uuid, integer, text, jsonb, text);

create or replace function public.device_create_order(
  p_device_secret text,
  p_shift_token uuid,
  p_table_number integer,
  p_customer_name text,
  p_items jsonb,
  p_notes text default null,
  p_scheduled_for timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
  v_waiter_id uuid;
  v_waiter_name text;
begin
  v_device := public.resolve_waiter_device(p_device_secret);

  select s.waiter_id, s.waiter_name
  into v_waiter_id, v_waiter_name
  from public.resolve_waiter_shift(v_device.id, p_shift_token) s;

  return jsonb_build_object(
    'order_id',
    public.insert_order_core(
      v_device.registered_by, v_waiter_id, v_waiter_name,
      p_table_number, p_customer_name, p_items, p_notes, p_scheduled_for
    )
  );
end;
$$;

revoke all on function public.device_create_order(text, uuid, integer, text, jsonb, text, timestamptz) from public;
grant execute on function public.device_create_order(text, uuid, integer, text, jsonb, text, timestamptz) to anon, authenticated;

-- ============================================================================
-- D. Lists
-- ============================================================================

-- Kitchen tickets (20261018120000): only queued orders; lines that arrived
-- before queue entry join the ticket timed at queue entry; orders entering
-- together are listed by pickup time; plus `scheduled_for`.
create or replace function public.kitchen_orders_core(p_station text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_station is null or p_station not in ('pizza', 'grill') then
    raise exception 'Estación inválida.';
  end if;

  perform public.release_scheduled_orders();

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'token', o.token,
          'table_number', o.table_number,
          'customer_name', o.customer_name,
          'waiter_name', o.waiter_name,
          'notes', o.notes,
          'scheduled_for', o.scheduled_for,
          'created_at', t.ticket_at,
          'lines', (
            select jsonb_agg(public.kitchen_line_json(i) order by i.product_name, i.variant nulls first, i.id)
            from public.order_items i
            where i.order_id = o.id
              and i.station = p_station
              and i.ready_at is null
              and greatest(i.created_at, o.queued_at) = t.ticket_at
          )
        )
        order by t.ticket_at, o.scheduled_for nulls first, o.id
      )
      from (
        select distinct i.order_id, greatest(i.created_at, qo.queued_at) as ticket_at
        from public.order_items i
        join public.orders qo on qo.id = i.order_id
        where i.station = p_station and i.ready_at is null and qo.queued_at is not null
      ) t
      join public.orders o on o.id = t.order_id
      where o.status = 'open'
    ),
    '[]'::jsonb
  );
end;
$$;

-- Waiter device open orders (20261018120000) plus `scheduled_for` and `queued_at`.
create or replace function public.device_list_open_orders(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_waiter_device(p_device_secret);

  perform public.release_scheduled_orders();

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'token', o.token,
          'table_number', o.table_number,
          'customer_name', o.customer_name,
          'status', o.status,
          'created_at', o.created_at,
          'scheduled_for', o.scheduled_for,
          'queued_at', o.queued_at,
          'waiter_name', o.waiter_name,
          'notes', o.notes,
          'order_items', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id', i.id,
                  'product_id', i.product_id,
                  'product_name', i.product_name,
                  'quantity', i.quantity,
                  'item_type', i.item_type,
                  'pizza', i.pizza,
                  'notes', i.notes,
                  'variant', i.variant,
                  'station', i.station,
                  'ready_at', i.ready_at,
                  'delivered_at', i.delivered_at
                )
                order by i.product_name, i.variant nulls first, i.id
              )
              from public.order_items i
              where i.order_id = o.id
            ),
            '[]'::jsonb
          )
        )
        order by o.created_at, o.id
      )
      from public.orders o
      where o.status = 'open'
    ),
    '[]'::jsonb
  );
end;
$$;
