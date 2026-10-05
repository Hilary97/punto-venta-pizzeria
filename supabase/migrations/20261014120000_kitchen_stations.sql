-- Kitchen stations and delivery.
--
-- Written by hand (no Supabase CLI available in the authoring environment).
--
--   * categories.kitchen_station says which station cooks a category
--     ('pizza' | 'grill' | null = not cooked). order_items.station snapshots it
--     when a line is inserted; pizza-builder lines are always 'pizza'.
--   * order_items.ready_at is set by a station (or immediately for lines with
--     no station); delivered_at is set by the waiter at delivery.
--   * order_devices.kind separates waiter devices from kitchen devices. Waiter
--     RPCs reject kitchen devices and kitchen RPCs reject waiter devices.
--   * An order reaches delivery only when none of its lines is still pending
--     in a kitchen. Lines added later start pending again.
--   * The product-merge index now only merges into lines that are still
--     pending (or never cooked and undelivered), so adding more of an already
--     cooked product creates a fresh line that goes back to the kitchen.

-- ============================================================================
-- A. Columns and backfill
-- ============================================================================

alter table public.categories
  add column kitchen_station text check (kitchen_station in ('pizza', 'grill'));

update public.categories
set kitchen_station = case
  when regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like '%pizza%' then 'pizza'
  when regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('hamburguesas', 'botanas', 'ensaladas') then 'grill'
end;

alter table public.order_items
  add column station text check (station in ('pizza', 'grill')),
  add column ready_at timestamptz,
  add column delivered_at timestamptz;

-- Orders already open must not flood the kitchen: stamp their station but mark
-- every existing line as ready and delivered.
update public.order_items i
set station = case
      when i.item_type = 'pizza' then 'pizza'
      else (
        select c.kitchen_station
        from public.products p
        join public.categories c on c.id = p.category_id
        where p.id = i.product_id
      )
    end,
    ready_at = now(),
    delivered_at = now()
from public.orders o
where o.id = i.order_id and o.status = 'open';

drop index if exists public.order_items_product_merge_idx;
create unique index order_items_product_merge_idx
  on public.order_items (order_id, product_id, coalesce(variant, ''))
  where item_type = 'product' and notes is null
    and delivered_at is null and (station is null or ready_at is null);

create index order_items_kitchen_idx
  on public.order_items (station)
  where ready_at is null;

alter table public.order_devices
  add column kind text not null default 'waiter'
    check (kind in ('waiter', 'kitchen_pizza', 'kitchen_grill'));

-- ============================================================================
-- B. insert_order_lines (stamps station / ready_at; used by create and add paths)
-- ============================================================================

create or replace function public.insert_order_lines(p_order_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_type text;
  v_product_id uuid;
  v_raw_quantity text;
  v_quantity integer;
  v_notes text;
  v_product_name text;
  v_product_variants text[];
  v_variant text;
  v_station text;
  v_ready_at timestamptz;
  v_config jsonb;
begin
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Uno de los artículos del pedido es inválido.';
    end if;

    v_type := coalesce(v_item ->> 'type', 'product');
    if v_type not in ('product', 'pizza') then
      raise exception 'Uno de los artículos del pedido es inválido.';
    end if;

    v_raw_quantity := v_item ->> 'quantity';
    if v_raw_quantity is null or v_raw_quantity !~ '^[0-9]+$' then
      raise exception 'Uno de los artículos del pedido es inválido.';
    end if;
    v_quantity := v_raw_quantity::integer;
    if v_quantity <= 0 then
      raise exception 'Uno de los artículos del pedido es inválido.';
    end if;

    if jsonb_typeof(v_item -> 'notes') not in ('string', 'null') then
      raise exception 'Uno de los artículos del pedido es inválido.';
    end if;
    v_notes := nullif(btrim(v_item ->> 'notes'), '');
    if v_notes is not null and length(v_notes) > 200 then
      raise exception 'La nota es demasiado larga.';
    end if;

    if v_type = 'pizza' then
      v_config := public.validate_pizza(v_item -> 'pizza');

      insert into public.order_items (order_id, item_type, pizza, product_name, quantity, notes, station)
      values (p_order_id, 'pizza', v_config, public.describe_pizza(v_config), v_quantity, v_notes, 'pizza');
    else
      begin
        v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'Uno de los artículos del pedido es inválido.';
      end;

      if v_product_id is null then
        raise exception 'Uno de los artículos del pedido es inválido.';
      end if;

      if jsonb_typeof(v_item -> 'variant') not in ('string', 'null') then
        raise exception 'Uno de los artículos del pedido es inválido.';
      end if;

      v_product_name := null;
      v_station := null;
      select p.name, p.variants, c.kitchen_station into v_product_name, v_product_variants, v_station
      from public.products p
      left join public.categories c on c.id = p.category_id
      where p.id = v_product_id and p.active = true
      for share of p;

      if v_product_name is null then
        raise exception 'Uno de los productos no existe o no está activo.';
      end if;

      v_variant := nullif(btrim(v_item ->> 'variant'), '');
      if cardinality(v_product_variants) > 0 then
        if v_variant is null then
          raise exception 'Elige una opción para %', v_product_name;
        end if;

        select o into v_variant
        from unnest(v_product_variants) as o
        where lower(o) = lower(v_variant)
        limit 1;

        if v_variant is null then
          raise exception 'Opción no válida para %', v_product_name;
        end if;
      elsif v_variant is not null then
        raise exception '% no tiene opciones', v_product_name;
      end if;

      -- Lines without a station are never cooked: they are ready on arrival.
      v_ready_at := case when v_station is null then now() end;

      if v_notes is null then
        insert into public.order_items (order_id, item_type, product_id, product_name, variant, quantity, station, ready_at)
        values (p_order_id, 'product', v_product_id, v_product_name, v_variant, v_quantity, v_station, v_ready_at)
        on conflict (order_id, product_id, coalesce(variant, ''))
          where item_type = 'product' and notes is null and delivered_at is null and (station is null or ready_at is null)
        do update set quantity = order_items.quantity + excluded.quantity;
      else
        insert into public.order_items (order_id, item_type, product_id, product_name, variant, quantity, notes, station, ready_at)
        values (p_order_id, 'product', v_product_id, v_product_name, v_variant, v_quantity, v_notes, v_station, v_ready_at);
      end if;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- C. Device kind helpers
-- ============================================================================

create or replace function public.resolve_waiter_device(p_device_secret text)
returns public.order_devices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_order_device(p_device_secret);

  if v_device.kind <> 'waiter' then
    raise exception 'Este dispositivo no es de mesero.';
  end if;

  return v_device;
end;
$$;

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

  if v_device.kind not in ('kitchen_pizza', 'kitchen_grill') then
    raise exception 'Este dispositivo no es de cocina.';
  end if;

  return v_device;
end;
$$;

create or replace function public.device_station(p_kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_kind when 'kitchen_pizza' then 'pizza' when 'kitchen_grill' then 'grill' end;
$$;

revoke all on function public.resolve_waiter_device(text) from public, anon, authenticated;
revoke all on function public.resolve_kitchen_device(text) from public, anon, authenticated;
revoke all on function public.device_station(text) from public, anon, authenticated;

-- ============================================================================
-- D. Kitchen / delivery cores (shared by device and authenticated RPCs)
-- ============================================================================

create or replace function public.kitchen_line_json(i public.order_items)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'id', i.id,
    'product_name', i.product_name,
    'quantity', i.quantity,
    'item_type', i.item_type,
    'pizza', i.pizza,
    'notes', i.notes,
    'variant', i.variant
  );
$$;

-- Open orders with at least one pending line of the station; only that
-- station's pending lines are returned. Oldest first.
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
          'created_at', o.created_at,
          'lines', (
            select jsonb_agg(public.kitchen_line_json(i) order by i.product_name, i.variant nulls first, i.id)
            from public.order_items i
            where i.order_id = o.id and i.station = p_station and i.ready_at is null
          )
        )
        order by o.created_at, o.id
      )
      from public.orders o
      where o.status = 'open'
        and exists (
          select 1 from public.order_items i
          where i.order_id = o.id and i.station = p_station and i.ready_at is null
        )
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.mark_station_ready_core(p_order_id uuid, p_station text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_station is null or p_station not in ('pizza', 'grill') then
    raise exception 'Estación inválida.';
  end if;

  if p_order_id is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  select status into v_status from public.orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if v_status <> 'open' then
    raise exception 'El pedido ya no está abierto.';
  end if;

  update public.order_items
  set ready_at = now()
  where order_id = p_order_id and station = p_station and ready_at is null;

  return p_order_id;
end;
$$;

-- Open orders with nothing left to cook and something to deliver. Oldest first.
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

create or replace function public.mark_delivered_core(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_order_id is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  select status into v_status from public.orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if v_status <> 'open' then
    raise exception 'El pedido ya no está abierto.';
  end if;

  update public.order_items
  set delivered_at = now()
  where order_id = p_order_id and ready_at is not null and delivered_at is null;

  return p_order_id;
end;
$$;

revoke all on function public.kitchen_line_json(public.order_items) from public, anon, authenticated;
revoke all on function public.kitchen_orders_core(text) from public, anon, authenticated;
revoke all on function public.mark_station_ready_core(uuid, text) from public, anon, authenticated;
revoke all on function public.ready_orders_core() from public, anon, authenticated;
revoke all on function public.mark_delivered_core(uuid) from public, anon, authenticated;

-- ============================================================================
-- E. Waiter device RPCs (now reject kitchen devices)
-- ============================================================================

create or replace function public.device_list_waiters(p_device_secret text)
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
        jsonb_build_object('id', w.id, 'full_name', w.full_name)
        order by w.full_name
      )
      from public.waiters w
      where w.active = true
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.device_start_shift(
  p_device_secret text,
  p_waiter_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
  v_waiter public.waiters%rowtype;
  v_attempts integer;
  v_token uuid;
  v_expires_at timestamptz;
begin
  v_device := public.resolve_waiter_device(p_device_secret);

  select * into v_waiter
  from public.waiters
  where id = p_waiter_id and active = true
  for update;

  if not found then
    raise exception 'Mesero no encontrado o inactivo.';
  end if;

  if v_waiter.locked_until is not null and v_waiter.locked_until > now() then
    return jsonb_build_object('error', 'Demasiados intentos. Intenta de nuevo en unos minutos.');
  end if;

  -- A malformed PIN is a client bug, not a guess: raise without counting it.
  if not public.validate_pin_format(p_pin) then
    raise exception 'El PIN debe tener exactamente 4 dígitos.';
  end if;

  if v_waiter.pin_hash <> extensions.crypt(p_pin, v_waiter.pin_hash) then
    v_attempts := v_waiter.failed_attempts + 1;

    if v_attempts >= 5 then
      update public.waiters
      set failed_attempts = 0, locked_until = now() + interval '5 minutes'
      where id = v_waiter.id;

      return jsonb_build_object('error', 'Demasiados intentos. Intenta de nuevo en unos minutos.');
    end if;

    update public.waiters
    set failed_attempts = v_attempts
    where id = v_waiter.id;

    return jsonb_build_object('error', 'PIN incorrecto.');
  end if;

  update public.waiters
  set failed_attempts = 0, locked_until = null
  where id = v_waiter.id;

  delete from public.waiter_shifts
  where waiter_id = v_waiter.id and expires_at <= now();

  insert into public.waiter_shifts (waiter_id, device_id, expires_at)
  values (v_waiter.id, v_device.id, now() + interval '12 hours')
  returning token, expires_at into v_token, v_expires_at;

  return jsonb_build_object(
    'token', v_token,
    'waiter_id', v_waiter.id,
    'full_name', v_waiter.full_name,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.device_get_shift(p_device_secret text, p_shift_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
  v_result jsonb;
begin
  v_device := public.resolve_waiter_device(p_device_secret);

  select jsonb_build_object(
    'waiter_id', w.id,
    'full_name', w.full_name,
    'expires_at', s.expires_at
  )
  into v_result
  from public.waiter_shifts s
  join public.waiters w on w.id = s.waiter_id
  where s.token = p_shift_token
    and s.device_id = v_device.id
    and s.expires_at > now()
    and w.active = true;

  return v_result;
end;
$$;

create or replace function public.device_end_shift(p_device_secret text, p_shift_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
  v_deleted integer;
begin
  v_device := public.resolve_waiter_device(p_device_secret);

  delete from public.waiter_shifts
  where token = p_shift_token and device_id = v_device.id;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('ended', v_deleted > 0);
end;
$$;

create or replace function public.device_list_catalog(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_waiter_device(p_device_secret);

  return jsonb_build_object(
    'categories',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', c.id, 'name', c.name, 'sort_order', c.sort_order)
          order by c.sort_order, c.name
        )
        from public.categories c
      ),
      '[]'::jsonb
    ),
    'products',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', p.id, 'name', p.name, 'category_id', p.category_id, 'variants', to_jsonb(p.variants))
          order by p.name
        )
        from public.products p
        where p.active = true
      ),
      '[]'::jsonb
    ),
    'pizza',
    jsonb_build_object(
      'sizes',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'code', s.code,
              'name', s.name,
              'allowed_portions', to_jsonb(s.allowed_portions),
              'sort_order', s.sort_order
            )
            order by s.sort_order
          )
          from public.pizza_sizes s
        ),
        '[]'::jsonb
      ),
      'styles',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', st.id,
              'name', st.name,
              'description', st.description,
              'kind', st.kind,
              'included_ingredients', st.included_ingredients,
              'sort_order', st.sort_order
            )
            order by st.sort_order, st.name
          )
          from public.pizza_styles st
          where st.active = true
        ),
        '[]'::jsonb
      ),
      'ingredients',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('id', i.id, 'name', i.name, 'sort_order', i.sort_order)
            order by i.sort_order, i.name
          )
          from public.pizza_ingredients i
          where i.active = true
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;

create or replace function public.device_create_order(
  p_device_secret text,
  p_shift_token uuid,
  p_table_number integer,
  p_customer_name text,
  p_items jsonb,
  p_notes text default null
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
      p_table_number, p_customer_name, p_items, p_notes
    )
  );
end;
$$;

create or replace function public.device_add_order_items(
  p_device_secret text,
  p_shift_token uuid,
  p_order_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_waiter_device(p_device_secret);
  perform 1 from public.resolve_waiter_shift(v_device.id, p_shift_token);

  return jsonb_build_object('order_id', public.add_order_items_core(p_order_id, p_items));
end;
$$;

create or replace function public.device_cancel_order(
  p_device_secret text,
  p_shift_token uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_waiter_device(p_device_secret);
  perform 1 from public.resolve_waiter_shift(v_device.id, p_shift_token);

  return jsonb_build_object('order_id', public.cancel_order_core(p_order_id));
end;
$$;

create or replace function public.device_set_order_notes(
  p_device_secret text,
  p_shift_token uuid,
  p_order_id uuid,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_waiter_device(p_device_secret);
  perform 1 from public.resolve_waiter_shift(v_device.id, p_shift_token);

  return jsonb_build_object('order_id', public.set_order_notes_core(p_order_id, p_notes));
end;
$$;

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

create or replace function public.device_info(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_order_device(p_device_secret);

  return jsonb_build_object('device_id', v_device.id, 'name', v_device.name, 'kind', v_device.kind);
end;
$$;

-- ============================================================================
-- F. New device RPCs: kitchen and delivery
-- ============================================================================

create or replace function public.device_list_kitchen_orders(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_kitchen_device(p_device_secret);

  return public.kitchen_orders_core(public.device_station(v_device.kind));
end;
$$;

create or replace function public.device_mark_station_ready(p_device_secret text, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_kitchen_device(p_device_secret);

  return jsonb_build_object(
    'order_id',
    public.mark_station_ready_core(p_order_id, public.device_station(v_device.kind))
  );
end;
$$;

create or replace function public.device_list_ready_orders(p_device_secret text, p_shift_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_waiter_device(p_device_secret);
  perform 1 from public.resolve_waiter_shift(v_device.id, p_shift_token);

  return public.ready_orders_core();
end;
$$;

create or replace function public.device_mark_delivered(p_device_secret text, p_shift_token uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_waiter_device(p_device_secret);
  perform 1 from public.resolve_waiter_shift(v_device.id, p_shift_token);

  return jsonb_build_object('order_id', public.mark_delivered_core(p_order_id));
end;
$$;

-- ============================================================================
-- G. Authenticated RPCs (admin / cashier at the register)
-- ============================================================================

create or replace function public.list_kitchen_orders(p_station text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para operar la caja.';
  end if;

  return public.kitchen_orders_core(p_station);
end;
$$;

create or replace function public.mark_station_ready(p_order_id uuid, p_station text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para operar la caja.';
  end if;

  return jsonb_build_object('order_id', public.mark_station_ready_core(p_order_id, p_station));
end;
$$;

create or replace function public.list_ready_orders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para operar la caja.';
  end if;

  return public.ready_orders_core();
end;
$$;

create or replace function public.mark_delivered(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para operar la caja.';
  end if;

  return jsonb_build_object('order_id', public.mark_delivered_core(p_order_id));
end;
$$;

-- ============================================================================
-- H. Admin device RPCs (kind)
-- ============================================================================

drop function if exists public.admin_register_device(text);

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

  if v_kind not in ('waiter', 'kitchen_pizza', 'kitchen_grill') then
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

create or replace function public.admin_list_devices()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar dispositivos.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'name', d.name,
          'kind', d.kind,
          'created_at', d.created_at,
          'last_seen_at', d.last_seen_at,
          'revoked', d.revoked_at is not null
        )
        order by d.created_at desc
      )
      from public.order_devices d
    ),
    '[]'::jsonb
  );
end;
$$;

-- ============================================================================
-- I. Privileges
-- ============================================================================

revoke all on function public.insert_order_lines(uuid, jsonb) from public, anon, authenticated;

revoke all on function public.admin_register_device(text, text) from public, anon;
revoke all on function public.admin_list_devices() from public, anon;
grant execute on function public.admin_register_device(text, text) to authenticated;
grant execute on function public.admin_list_devices() to authenticated;

revoke all on function public.list_kitchen_orders(text) from public, anon;
revoke all on function public.mark_station_ready(uuid, text) from public, anon;
revoke all on function public.list_ready_orders() from public, anon;
revoke all on function public.mark_delivered(uuid) from public, anon;
grant execute on function public.list_kitchen_orders(text) to authenticated;
grant execute on function public.mark_station_ready(uuid, text) to authenticated;
grant execute on function public.list_ready_orders() to authenticated;
grant execute on function public.mark_delivered(uuid) to authenticated;

revoke all on function public.device_info(text) from public;
revoke all on function public.device_list_waiters(text) from public;
revoke all on function public.device_start_shift(text, uuid, text) from public;
revoke all on function public.device_get_shift(text, uuid) from public;
revoke all on function public.device_end_shift(text, uuid) from public;
revoke all on function public.device_list_catalog(text) from public;
revoke all on function public.device_list_open_orders(text) from public;
revoke all on function public.device_create_order(text, uuid, integer, text, jsonb, text) from public;
revoke all on function public.device_add_order_items(text, uuid, uuid, jsonb) from public;
revoke all on function public.device_cancel_order(text, uuid, uuid) from public;
revoke all on function public.device_set_order_notes(text, uuid, uuid, text) from public;
revoke all on function public.device_list_kitchen_orders(text) from public;
revoke all on function public.device_mark_station_ready(text, uuid) from public;
revoke all on function public.device_list_ready_orders(text, uuid) from public;
revoke all on function public.device_mark_delivered(text, uuid, uuid) from public;

grant execute on function public.device_info(text) to anon, authenticated;
grant execute on function public.device_list_waiters(text) to anon, authenticated;
grant execute on function public.device_start_shift(text, uuid, text) to anon, authenticated;
grant execute on function public.device_get_shift(text, uuid) to anon, authenticated;
grant execute on function public.device_end_shift(text, uuid) to anon, authenticated;
grant execute on function public.device_list_catalog(text) to anon, authenticated;
grant execute on function public.device_list_open_orders(text) to anon, authenticated;
grant execute on function public.device_create_order(text, uuid, integer, text, jsonb, text) to anon, authenticated;
grant execute on function public.device_add_order_items(text, uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.device_cancel_order(text, uuid, uuid) to anon, authenticated;
grant execute on function public.device_set_order_notes(text, uuid, uuid, text) to anon, authenticated;
grant execute on function public.device_list_kitchen_orders(text) to anon, authenticated;
grant execute on function public.device_mark_station_ready(text, uuid) to anon, authenticated;
grant execute on function public.device_list_ready_orders(text, uuid) to anon, authenticated;
grant execute on function public.device_mark_delivered(text, uuid, uuid) to anon, authenticated;
