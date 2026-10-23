-- Prepared drinks station ("Bebidas preparadas").
--
-- Shakes and coffees need preparation, so they get a third kitchen station,
-- 'drinks', with its own device kind 'kitchen_drinks'. The station still comes
-- from the category: a new category "Bebidas preparadas" (placed right after
-- "Bebidas") cooks at 'drinks', and the Bebidas products whose name starts with
-- "Malteada" or "Café" move into it. Other drinks stay ready on arrival.
-- Lines already ordered are not touched. Safe to run more than once.

-- ============================================================================
-- A. Allowed values
-- ============================================================================

alter table public.categories drop constraint if exists categories_kitchen_station_check;
alter table public.categories
  add constraint categories_kitchen_station_check check (kitchen_station in ('pizza', 'grill', 'drinks'));

alter table public.order_items drop constraint if exists order_items_station_check;
alter table public.order_items
  add constraint order_items_station_check check (station in ('pizza', 'grill', 'drinks'));

alter table public.order_devices drop constraint if exists order_devices_kind_check;
alter table public.order_devices
  add constraint order_devices_kind_check check (kind in ('waiter', 'kitchen_pizza', 'kitchen_grill', 'kitchen_drinks'));

-- ============================================================================
-- B. Category and products
-- ============================================================================

-- Same sort_order as Bebidas: buttons are ordered by (sort_order, name), so it
-- lands right after it. Only a menu with a Bebidas category gets it.
insert into public.categories (name, sort_order, kitchen_station)
select 'Bebidas preparadas', min(c.sort_order), 'drinks'
from public.categories c
where regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g') = 'bebidas'
having count(*) > 0
on conflict (name) do update set kitchen_station = 'drinks';

update public.products p
set category_id = (select id from public.categories where name = 'Bebidas preparadas')
from public.categories c
where c.id = p.category_id
  and regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g') = 'bebidas'
  and lower(btrim(p.name)) ~ '^(malteada|caf[eé])';

-- ============================================================================
-- C. Devices
-- ============================================================================

-- device_station (20261014120000) with kitchen_drinks.
create or replace function public.device_station(p_kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_kind
    when 'kitchen_pizza' then 'pizza'
    when 'kitchen_grill' then 'grill'
    when 'kitchen_drinks' then 'drinks'
  end;
$$;

-- resolve_kitchen_device (20261014120000) with kitchen_drinks.
create or replace function public.resolve_kitchen_device(p_device_secret text)
returns public.order_devices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_order_device(p_device_secret);

  if v_device.kind not in ('kitchen_pizza', 'kitchen_grill', 'kitchen_drinks') then
    raise exception 'Este dispositivo no es de cocina.';
  end if;

  return v_device;
end;
$$;

-- admin_register_device (20261014120000) with kitchen_drinks.
create or replace function public.admin_register_device(p_name text, p_kind text default 'waiter')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_kind text := coalesce(p_kind, 'waiter');
  v_secret text;
  v_device_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar dispositivos.';
  end if;

  if length(v_name) < 1 or length(v_name) > 60 then
    raise exception 'El nombre del dispositivo debe tener entre 1 y 60 caracteres.';
  end if;

  if v_kind not in ('waiter', 'kitchen_pizza', 'kitchen_grill', 'kitchen_drinks') then
    raise exception 'El tipo de dispositivo no es válido.';
  end if;

  v_secret := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.order_devices (name, secret_hash, registered_by, kind)
  values (v_name, encode(extensions.digest(v_secret, 'sha256'), 'hex'), auth.uid(), v_kind)
  returning id into v_device_id;

  return jsonb_build_object(
    'device_id', v_device_id,
    'name', v_name,
    'kind', v_kind,
    'device_secret', v_secret
  );
end;
$$;

-- ============================================================================
-- D. Kitchen cores
-- ============================================================================

-- kitchen_orders_core (20261031120000) with the drinks station.
create or replace function public.kitchen_orders_core(p_station text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_station is null or p_station not in ('pizza', 'grill', 'drinks') then
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

-- mark_station_ready_core (20261027120000) with the drinks station.
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
  if p_station is null or p_station not in ('pizza', 'grill', 'drinks') then
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
