-- Free an order's token when its last line is delivered.
--
-- The token only matches plates to their order at pickup, so it was held too
-- long: an open order kept it until it was paid or cancelled, even after every
-- line was delivered. Now:
--
--   * mark_delivered_core frees the token when no line is left to deliver,
--     whether the order is open or paid.
--   * add_order_items_core gives an order that has no token (it was delivered,
--     or none was free) the lowest free token again, so the new lines reach the
--     kitchen with one. A waiting scheduled order still takes it when queued.
--   * pay_order ends an order at payment only when every line was delivered
--     (was: when nothing was left to cook). A paid order with plates waiting
--     in Entrega keeps its token until they are delivered.
--   * Orders in service whose lines are all delivered free their token now.
--
-- Runs as one script (Supabase SQL Editor).

update public.orders o
set token = null
where o.token is not null
  and (o.status = 'open' or (o.status = 'paid' and o.served_at is null))
  and exists (select 1 from public.order_items i where i.order_id = o.id)
  and not exists (select 1 from public.order_items i where i.order_id = o.id and i.delivered_at is null);

-- mark_delivered_core (20261026120000) plus: the last delivered line frees the token.
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

  if not exists (
    select 1 from public.order_items where order_id = p_order_id and delivered_at is null
  ) then
    update public.orders
    set token = null,
        served_at = case when v_status = 'paid' then now() else served_at end
    where id = p_order_id;
  end if;

  return p_order_id;
end;
$$;

-- add_order_items_core (20261005120000) plus: an order in the queue without a
-- token takes the lowest free one.
create or replace function public.add_order_items_core(p_order_id uuid, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_token smallint;
  v_queued_at timestamptz;
begin
  if p_order_id is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  -- Serialize against concurrent pay/cancel/add calls on the same order.
  select status, token, queued_at into v_status, v_token, v_queued_at
  from public.orders
  where id = p_order_id
  for update;

  if v_status is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if v_status <> 'open' then
    raise exception 'El pedido ya no está abierto.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes agregar al menos un producto.';
  end if;

  -- Same lock as order creation, so two orders never share a token. Taken
  -- before the lines lock products, in the same order as order creation.
  if v_token is null and v_queued_at is not null then
    perform pg_advisory_xact_lock(hashtext('public.orders.token'));
    update public.orders set token = public.free_order_token() where id = p_order_id;
  end if;

  perform public.insert_order_lines(p_order_id, p_items);

  return p_order_id;
end;
$$;

-- pay_order (20261026120000): an order with lines not delivered stays in service.
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
        when exists (select 1 from public.order_items where order_id = p_order_id and delivered_at is null) then null
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

revoke all on function public.mark_delivered_core(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.add_order_items_core(uuid, jsonb) from public, anon, authenticated;
