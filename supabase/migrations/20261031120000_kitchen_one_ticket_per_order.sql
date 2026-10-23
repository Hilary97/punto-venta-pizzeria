-- One kitchen ticket per order and station, like most kitchen display systems.
--
-- Items added while the station still has pending lines of the order join that
-- ticket instead of opening another; each such line reports `added_at` (when it
-- arrived) so the card can flag it. Once the station marks the ticket ready,
-- a later addition opens a new ticket. The ticket keeps its place in the queue
-- and its delay from the oldest pending line.

-- kitchen_orders_core (20261029120000) grouped by order instead of by arrival batch.
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
          'service', o.service,
          'table_number', o.table_number,
          'customer_name', o.customer_name,
          'waiter_name', o.waiter_name,
          'notes', o.notes,
          'scheduled_for', o.scheduled_for,
          'waiting', false,
          'created_at', t.ticket_at,
          'lines', (
            select jsonb_agg(
              public.kitchen_line_json(i) || jsonb_build_object(
                'added_at',
                case when greatest(i.created_at, o.queued_at) > t.ticket_at
                  then greatest(i.created_at, o.queued_at) end
              )
              order by i.product_name, i.variant nulls first, i.id
            )
            from public.order_items i
            where i.order_id = o.id
              and i.station = p_station
              and i.ready_at is null
          )
        )
        order by t.ticket_at, o.scheduled_for nulls first, o.id
      )
      from (
        select i.order_id, min(greatest(i.created_at, qo.queued_at)) as ticket_at
        from public.order_items i
        join public.orders qo on qo.id = i.order_id
        where i.station = p_station and i.ready_at is null and qo.queued_at is not null
        group by i.order_id
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
          'service', o.service,
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
