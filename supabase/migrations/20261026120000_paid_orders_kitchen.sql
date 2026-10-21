-- Paid orders stay in the kitchen until they are delivered.
--
-- Paying used to end an order: kitchen, delivery and tokens only saw open
-- orders, so an order paid before it was cooked (e.g. a prepaid scheduled
-- order) was never made. Now an order is "in service" while it is open, or
-- paid with lines not delivered yet:
--
--   status = 'open' or (status = 'paid' and served_at is null)
--
-- orders.served_at: when a paid order left service. pay_order sets it at once
-- when nothing is left to cook (every line ready, e.g. drinks or food already
-- out of the kitchen), as payment always did; otherwise the order goes through
-- Cocina and Entrega and mark_delivered_core sets it when the last line is
-- delivered. In service orders keep their token, appear
-- in Cocina and Entrega, and can be marked ready and delivered. Adding items
-- and cancelling still need an open order.
--
-- Orders paid before this migration are ended (served_at = paid time), so
-- undelivered history never reappears on the boards.
--
-- Runs as one script (Supabase SQL Editor).

-- The backfill runs only when the column is added, so running the script
-- again never ends orders that are in service.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'served_at'
  ) then
    alter table public.orders add column served_at timestamptz;
    update public.orders set served_at = coalesce(paid_at, now()) where status = 'paid';
  end if;
end;
$$;

-- Tokens are unique among orders in service (was: among open orders).
drop index if exists public.orders_open_token_key;
create unique index if not exists orders_in_service_token_key on public.orders (token)
  where status = 'open' or (status = 'paid' and served_at is null);

drop index if exists public.orders_waiting_scheduled_idx;
create index if not exists orders_waiting_scheduled_idx on public.orders (scheduled_for)
  where queued_at is null and (status = 'open' or (status = 'paid' and served_at is null));

-- free_order_token (20261025120000): tokens held by orders in service.
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
    select 1 from public.orders o
    where o.token = n and (o.status = 'open' or (o.status = 'paid' and o.served_at is null))
  )
$$;

-- release_scheduled_orders (20261025120000): a scheduled order paid while
-- waiting is still released.
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
    where queued_at is null and scheduled_for <= v_due
      and (status = 'open' or (status = 'paid' and served_at is null))
  ) then
    return;
  end if;

  -- Same lock as order creation, so a released order never shares a token.
  perform pg_advisory_xact_lock(hashtext('public.orders.token'));

  -- Orders locked by a payment or cancellation are released on a later list.
  for v_id in
    select id from public.orders
    where queued_at is null and scheduled_for <= v_due
      and (status = 'open' or (status = 'paid' and served_at is null))
    order by scheduled_for, created_at, id
    for update skip locked
  loop
    update public.orders
    set queued_at = public.app_now(), token = public.free_order_token()
    where id = v_id;
  end loop;
end;
$$;

-- kitchen_orders_core (20261025120000): orders in service.
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
      where o.status = 'open' or (o.status = 'paid' and o.served_at is null)
    ),
    '[]'::jsonb
  );
end;
$$;

-- ready_orders_core (20261018120000): orders in service.
create or replace function public.ready_orders_core()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'token', o.token,
          'table_number', o.table_number,
          'customer_name', o.customer_name,
          'waiter_name', o.waiter_name,
          'notes', o.notes,
          'created_at', o.created_at,
          'lines', (
            select jsonb_agg(public.kitchen_line_json(i) order by i.product_name, i.variant nulls first, i.id)
            from public.order_items i
            where i.order_id = o.id and i.ready_at is not null and i.delivered_at is null
          )
        )
        order by o.created_at, o.id
      )
      from public.orders o
      where (o.status = 'open' or (o.status = 'paid' and o.served_at is null))
        and exists (
          select 1 from public.order_items i
          where i.order_id = o.id and i.ready_at is not null and i.delivered_at is null
        )
        and not exists (
          select 1 from public.order_items i
          where i.order_id = o.id and i.ready_at is null
        )
    ),
    '[]'::jsonb
  );
$$;

-- mark_station_ready_core (20261015120000): orders in service.
create or replace function public.mark_station_ready_core(p_order_id uuid, p_station text, p_line_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_served_at timestamptz;
begin
  if p_station is null or p_station not in ('pizza', 'grill') then
    raise exception 'Estación inválida.';
  end if;

  if p_order_id is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if p_line_ids is null or coalesce(array_length(p_line_ids, 1), 0) = 0 then
    raise exception 'Indica las líneas del pedido.';
  end if;

  select status, served_at into v_status, v_served_at from public.orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if not (v_status = 'open' or (v_status = 'paid' and v_served_at is null)) then
    raise exception 'El pedido ya no está abierto.';
  end if;

  update public.order_items
  set ready_at = now()
  where id = any(p_line_ids)
    and order_id = p_order_id
    and station = p_station
    and ready_at is null;

  return p_order_id;
end;
$$;

-- mark_delivered_core (20261016120000): orders in service; a paid order
-- leaves service when its last line is delivered.
create or replace function public.mark_delivered_core(p_order_id uuid, p_line_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_served_at timestamptz;
begin
  if p_order_id is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if p_line_ids is null or coalesce(array_length(p_line_ids, 1), 0) = 0 then
    raise exception 'Indica las líneas del pedido.';
  end if;

  select status, served_at into v_status, v_served_at from public.orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if not (v_status = 'open' or (v_status = 'paid' and v_served_at is null)) then
    raise exception 'El pedido ya no está abierto.';
  end if;

  update public.order_items
  set delivered_at = now()
  where id = any(p_line_ids)
    and order_id = p_order_id
    and ready_at is not null
    and delivered_at is null;

  if v_status = 'paid' and not exists (
    select 1 from public.order_items where order_id = p_order_id and delivered_at is null
  ) then
    update public.orders set served_at = now() where id = p_order_id;
  end if;

  return p_order_id;
end;
$$;

-- pay_order (20261005120000) plus served_at: an order with lines still in the
-- kitchen stays in service.
create or replace function public.pay_order(p_order_id uuid, p_received_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_lines jsonb;
  v_line jsonb;
  v_unavailable text;
  v_total integer;
  v_session_id uuid;
  v_change integer;
  v_sale_id uuid;
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para cobrar pedidos.' using errcode = '42501';
  end if;

  if p_order_id is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if p_received_cents is null or p_received_cents < 0 then
    raise exception 'El monto recibido no es válido.';
  end if;

  select status into v_status
  from public.orders
  where id = p_order_id
  for update;

  if v_status is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if v_status <> 'open' then
    raise exception 'El pedido ya no está abierto.';
  end if;

  v_lines := public.order_lines_priced(p_order_id);

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'El pedido no tiene productos.';
  end if;

  select string_agg(l ->> 'name', ', ')
  into v_unavailable
  from jsonb_array_elements(v_lines) as l
  where not (l ->> 'available')::boolean;

  if v_unavailable is not null then
    raise exception 'Hay productos no disponibles en el pedido: %. Corrígelo en Pedidos.', v_unavailable;
  end if;

  select id into v_session_id from public.cash_sessions where closed_at is null limit 1;
  if v_session_id is null then
    raise exception 'No hay una caja abierta. Abre la caja antes de vender.';
  end if;

  select sum((l ->> 'line_total_cents')::integer)
  into v_total
  from jsonb_array_elements(v_lines) as l;

  if p_received_cents < v_total then
    raise exception 'El monto recibido es menor al total de la venta.';
  end if;

  v_change := p_received_cents - v_total;

  insert into public.sales (session_id, cashier_id, total_cents, received_cents, change_cents)
  values (v_session_id, v_uid, v_total, p_received_cents, v_change)
  returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    insert into public.sale_items (sale_id, product_id, product_name, unit_price_cents, quantity)
    select
      v_sale_id,
      i.product_id,
      (v_line ->> 'name') || coalesce(' — Nota: ' || (v_line ->> 'notes'), ''),
      (v_line ->> 'unit_price_cents')::integer,
      (v_line ->> 'quantity')::integer
    from public.order_items i
    where i.id = (v_line ->> 'order_item_id')::uuid;
  end loop;

  update public.orders
  set status = 'paid', paid_sale_id = v_sale_id, paid_at = now(),
      served_at = case
        when exists (select 1 from public.order_items where order_id = p_order_id and ready_at is null) then null
        else now()
      end
  where id = p_order_id;

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'total_cents', v_total,
    'change_cents', v_change,
    'order_id', p_order_id
  );
end;
$$;
