-- Kitchen queue in arrival order.
--
-- Before, each station listed one card per open order sorted by the time the
-- order was opened, so a dish added late to an old table jumped ahead of orders
-- that reached the kitchen earlier. Order lines now record when they arrived,
-- and each station lists one ticket per arrival batch (the lines of one order
-- sent by one create/add action), oldest first. A late addition is a separate
-- ticket at the end of the queue.
--
-- Runs as one script (Supabase SQL Editor).

alter table public.order_items add column if not exists created_at timestamptz;

-- Existing lines arrived with their order.
update public.order_items i
set created_at = o.created_at
from public.orders o
where o.id = i.order_id and i.created_at is null;

-- now() is the transaction time: every line inserted by one RPC call shares it.
alter table public.order_items alter column created_at set default now();
alter table public.order_items alter column created_at set not null;

-- One ticket per (order, arrival time) with this station's pending lines.
-- `id` stays the order id; `created_at` is the ticket's arrival time.
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

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'table_number', o.table_number,
          'customer_name', o.customer_name,
          'waiter_name', o.waiter_name,
          'notes', o.notes,
          'created_at', t.created_at,
          'lines', (
            select jsonb_agg(public.kitchen_line_json(i) order by i.product_name, i.variant nulls first, i.id)
            from public.order_items i
            where i.order_id = o.id
              and i.station = p_station
              and i.ready_at is null
              and i.created_at = t.created_at
          )
        )
        order by t.created_at, o.id
      )
      from (
        select distinct i.order_id, i.created_at
        from public.order_items i
        where i.station = p_station and i.ready_at is null
      ) t
      join public.orders o on o.id = t.order_id
      where o.status = 'open'
    ),
    '[]'::jsonb
  );
end;
$$;
