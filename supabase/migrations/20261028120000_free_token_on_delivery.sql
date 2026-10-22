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

revoke all on function public.mark_delivered_core(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.add_order_items_core(uuid, jsonb) from public, anon, authenticated;
