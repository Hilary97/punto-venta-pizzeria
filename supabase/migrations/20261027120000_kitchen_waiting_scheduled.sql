-- Scheduled orders are visible in the kitchen while they wait.
--
-- Until now a scheduled order stayed out of Cocina until it entered the queue
-- (lead time before its pickup time). Now each station also lists the waiting
-- scheduled orders that have lines for it, after the queue, flagged
-- `waiting: true`: one ticket per order, without turn number or token, ordered
-- by pickup time. They are informative only: a waiting order cannot be marked
-- ready. When it enters the queue it takes its token and turn as before.
--
-- Queue tickets carry `waiting: false`.
--
-- Runs as one script (Supabase SQL Editor).

-- kitchen_orders_core (20261026120000): queue tickets, then waiting scheduled orders.
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
          'waiting', false,
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
  ) || coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'token', null,
          'table_number', o.table_number,
          'customer_name', o.customer_name,
          'waiter_name', o.waiter_name,
          'notes', o.notes,
          'scheduled_for', o.scheduled_for,
          'waiting', true,
          'created_at', o.created_at,
          'lines', (
            select jsonb_agg(public.kitchen_line_json(i) order by i.product_name, i.variant nulls first, i.id)
            from public.order_items i
            where i.order_id = o.id and i.station = p_station and i.ready_at is null
          )
        )
        order by o.scheduled_for, o.created_at, o.id
      )
      from public.orders o
      where o.queued_at is null
        and o.scheduled_for is not null
        and (o.status = 'open' or (o.status = 'paid' and o.served_at is null))
        and exists (
          select 1 from public.order_items i
          where i.order_id = o.id and i.station = p_station and i.ready_at is null
        )
    ),
    '[]'::jsonb
  );
end;
$$;

-- mark_station_ready_core (20261026120000): a waiting scheduled order cannot
-- be marked ready.
create or replace function public.mark_station_ready_core(p_order_id uuid, p_station text, p_line_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_served_at timestamptz;
  v_queued_at timestamptz;
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

  select status, served_at, queued_at into v_status, v_served_at, v_queued_at
  from public.orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if not (v_status = 'open' or (v_status = 'paid' and v_served_at is null)) then
    raise exception 'El pedido ya no está abierto.';
  end if;

  if v_queued_at is null then
    raise exception 'El pedido programado todavía no entra a la cola.';
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
