-- Partial delivery: each station's lines reach Entrega as soon as that
-- station marks them ready, without waiting for the other stations.
--
--   * ready_orders_core lists an order once it has a ready, undelivered line,
--     even while other lines are still cooking, and adds `pending_stations`:
--     the stations whose lines are not ready yet (empty when none).
--   * A scheduled order still waiting to enter the queue keeps the previous
--     rule (listed only when every line is ready), so its drinks do not show
--     in Entrega hours before it is cooked.
--   * mark_delivered_core already delivers line by line and frees the token
--     only once every line is delivered; it is unchanged.

-- ready_orders_core (20261029120000) plus `pending_stations` and partial readiness.
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
          'service', o.service,
          'table_number', o.table_number,
          'customer_name', o.customer_name,
          'waiter_name', o.waiter_name,
          'notes', o.notes,
          'created_at', o.created_at,
          'lines', (
            select jsonb_agg(public.kitchen_line_json(i) order by i.product_name, i.variant nulls first, i.id)
            from public.order_items i
            where i.order_id = o.id and i.ready_at is not null and i.delivered_at is null
          ),
          'pending_stations', coalesce(
            (
              select jsonb_agg(s.station order by s.station)
              from (
                select distinct i.station
                from public.order_items i
                where i.order_id = o.id and i.ready_at is null and i.station is not null
              ) s
            ),
            '[]'::jsonb
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
        and (
          o.queued_at is not null
          or not exists (
            select 1 from public.order_items i
            where i.order_id = o.id and i.ready_at is null
          )
        )
    ),
    '[]'::jsonb
  );
$$;
