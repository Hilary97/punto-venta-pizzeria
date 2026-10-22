-- Dine-in or takeaway orders.
--
-- Waiters mark each new order as dine-in ("Aquí") or takeaway ("Para llevar")
-- so the kitchen knows whether to plate or pack it. The whole order has one
-- service type; items added later keep it.
--
--   * orders.service: 'dine_in' or 'takeaway'; null for orders created before
--     this migration or by an app version that does not send it.
--   * insert_order_core, create_order and device_create_order take
--     p_service (default null, so cached app versions keep working) and
--     reject any other value. The app requires the choice.
--   * Cocina, Entrega and the waiter's open orders expose `service`.
--
-- Runs as one script (Supabase SQL Editor).

alter table public.orders add column if not exists service text;

alter table public.orders drop constraint if exists orders_service_valid;
alter table public.orders add constraint orders_service_valid check (service in ('dine_in', 'takeaway'));

-- insert_order_core (20261025120000) plus p_service.
drop function if exists public.insert_order_core(uuid, uuid, text, integer, text, jsonb, text, timestamptz);

create or replace function public.insert_order_core(
  p_created_by uuid,
  p_waiter_id uuid,
  p_waiter_name text,
  p_table_number integer,
  p_customer_name text,
  p_items jsonb,
  p_notes text,
  p_scheduled_for timestamptz,
  p_service text default null
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

  if p_service is not null and p_service not in ('dine_in', 'takeaway') then
    raise exception 'El tipo de pedido no es válido.';
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

  insert into public.orders (table_number, customer_name, created_by, waiter_id, waiter_name, notes, scheduled_for, service)
  values (p_table_number, v_customer_name, p_created_by, p_waiter_id, p_waiter_name, v_notes, p_scheduled_for, p_service)
  returning id into v_order_id;

  perform public.insert_order_lines(v_order_id, p_items);

  return v_order_id;
end;
$$;

revoke all on function public.insert_order_core(uuid, uuid, text, integer, text, jsonb, text, timestamptz, text)
  from public, anon, authenticated;

-- create_order (20261025120000) plus p_service.
drop function if exists public.create_order(integer, text, jsonb, text, timestamptz);

create or replace function public.create_order(
  p_table_number integer,
  p_customer_name text,
  p_items jsonb,
  p_notes text default null,
  p_scheduled_for timestamptz default null,
  p_service text default null
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
    public.insert_order_core(v_uid, null, null, p_table_number, p_customer_name, p_items, p_notes, p_scheduled_for, p_service)
  );
end;
$$;

revoke all on function public.create_order(integer, text, jsonb, text, timestamptz, text) from public, anon;
grant execute on function public.create_order(integer, text, jsonb, text, timestamptz, text) to authenticated;

-- device_create_order (20261025120000) plus p_service.
drop function if exists public.device_create_order(text, uuid, integer, text, jsonb, text, timestamptz);

create or replace function public.device_create_order(
  p_device_secret text,
  p_shift_token uuid,
  p_table_number integer,
  p_customer_name text,
  p_items jsonb,
  p_notes text default null,
  p_scheduled_for timestamptz default null,
  p_service text default null
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
      p_table_number, p_customer_name, p_items, p_notes, p_scheduled_for, p_service
    )
  );
end;
$$;

revoke all on function public.device_create_order(text, uuid, integer, text, jsonb, text, timestamptz, text) from public;
grant execute on function public.device_create_order(text, uuid, integer, text, jsonb, text, timestamptz, text) to anon, authenticated;

-- kitchen_orders_core (20261027120000) plus `service`.
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

-- ready_orders_core (20261026120000) plus `service`.
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

-- device_list_open_orders (20261025120000) plus `service`.
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
          'service', o.service,
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
