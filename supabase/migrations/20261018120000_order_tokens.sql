-- Numbered order tokens (fichas).
--
-- The kitchen puts a physical numbered token (1-50) on each finished plate so
-- the waiter can match it to its order. Every open order holds one token: a new
-- order takes the lowest token no other open order holds, and paying or
-- cancelling an order frees it. When all 50 are held the order is created
-- without a token. Kitchen, delivery and open order lists expose `token`.
--
-- Runs as one script (Supabase SQL Editor).

alter table public.orders add column if not exists token smallint;

alter table public.orders drop constraint if exists orders_token_range;
alter table public.orders add constraint orders_token_range check (token between 1 and 50);

-- Existing open orders take tokens in creation order.
with ranked as (
  select id, row_number() over (order by created_at, id) as n
  from public.orders
  where status = 'open' and token is null
)
update public.orders o
set token = r.n
from ranked r
where o.id = r.id and r.n <= 50;

-- Two open orders never share a token.
create unique index if not exists orders_open_token_key on public.orders (token) where status = 'open';

create or replace function public.assign_order_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serializes concurrent order creation so two orders never pick the same token.
  perform pg_advisory_xact_lock(hashtext('public.orders.token'));

  select min(n)::smallint into new.token
  from generate_series(1, 50) as n
  where not exists (
    select 1 from public.orders o where o.status = 'open' and o.token = n
  );

  return new;
end;
$$;

revoke all on function public.assign_order_token() from public, anon, authenticated;

drop trigger if exists orders_assign_token on public.orders;
create trigger orders_assign_token
  before insert on public.orders
  for each row execute function public.assign_order_token();

-- Kitchen tickets (unchanged from 20261017120000) plus `token`.
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
          'token', o.token,
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

-- Ready orders (unchanged from 20261014120000) plus `token`.
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
      where o.status = 'open'
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

-- Waiter device open orders (unchanged from 20261014120000) plus `token`.
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
