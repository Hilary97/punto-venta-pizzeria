-- Kitchen: mark ready only the lines the cook was shown.
--
-- Before, marking an order ready for a station updated every pending line of
-- that station, including lines a waiter added after the cook's last refresh,
-- so unseen lines skipped the kitchen. The mark-ready functions now take the
-- line ids displayed on the card and only touch those.
--
-- Lines with a kitchen station also never merge on re-add (a quantity bump on a
-- line the cook already saw would be marked ready unseen); only station-less
-- lines (drinks, extras) keep merging.
--
-- Runs as one script (Supabase SQL Editor).

drop index if exists public.order_items_product_merge_idx;
create unique index order_items_product_merge_idx
  on public.order_items (order_id, product_id, coalesce(variant, ''))
  where item_type = 'product' and notes is null
    and delivered_at is null and station is null;

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

      -- Kitchen lines never merge: the cook may already be looking at the old
      -- quantity, so every add creates its own line.
      if v_notes is null and v_station is null then
        insert into public.order_items (order_id, item_type, product_id, product_name, variant, quantity, station, ready_at)
        values (p_order_id, 'product', v_product_id, v_product_name, v_variant, v_quantity, v_station, v_ready_at)
        on conflict (order_id, product_id, coalesce(variant, ''))
          where item_type = 'product' and notes is null and delivered_at is null and station is null
        do update set quantity = order_items.quantity + excluded.quantity;
      elsif v_notes is null then
        insert into public.order_items (order_id, item_type, product_id, product_name, variant, quantity, station, ready_at)
        values (p_order_id, 'product', v_product_id, v_product_name, v_variant, v_quantity, v_station, v_ready_at);
      else
        insert into public.order_items (order_id, item_type, product_id, product_name, variant, quantity, notes, station, ready_at)
        values (p_order_id, 'product', v_product_id, v_product_name, v_variant, v_quantity, v_notes, v_station, v_ready_at);
      end if;
    end if;
  end loop;
end;
$$;

drop function if exists public.device_mark_station_ready(text, uuid);
drop function if exists public.mark_station_ready(uuid, text);
drop function if exists public.mark_station_ready_core(uuid, text);

create or replace function public.mark_station_ready_core(p_order_id uuid, p_station text, p_line_ids uuid[])
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

  if p_line_ids is null or coalesce(array_length(p_line_ids, 1), 0) = 0 then
    raise exception 'Indica las líneas del pedido.';
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
  where id = any(p_line_ids)
    and order_id = p_order_id
    and station = p_station
    and ready_at is null;

  return p_order_id;
end;
$$;

create or replace function public.device_mark_station_ready(p_device_secret text, p_order_id uuid, p_line_ids uuid[])
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
    public.mark_station_ready_core(p_order_id, public.device_station(v_device.kind), p_line_ids)
  );
end;
$$;

create or replace function public.mark_station_ready(p_order_id uuid, p_station text, p_line_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para operar la caja.';
  end if;

  return jsonb_build_object('order_id', public.mark_station_ready_core(p_order_id, p_station, p_line_ids));
end;
$$;

revoke all on function public.mark_station_ready_core(uuid, text, uuid[]) from public, anon, authenticated;
revoke all on function public.mark_station_ready(uuid, text, uuid[]) from public, anon;
grant execute on function public.mark_station_ready(uuid, text, uuid[]) to authenticated;
revoke all on function public.device_mark_station_ready(text, uuid, uuid[]) from public;
grant execute on function public.device_mark_station_ready(text, uuid, uuid[]) to anon, authenticated;

revoke all on function public.insert_order_lines(uuid, jsonb) from public, anon, authenticated;
