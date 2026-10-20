-- Finished-goods inventory (odd/tasks/inventory.md).
-- Products opt in to stock tracking. Taking an order deducts the stock and is
-- rejected when not enough is left; cancelling the order gives back exactly
-- what each line took (order_items.stocked_quantity). Paying never touches stock.
-- Admins add received units or set a counted value through RPCs.

-- A. Columns
alter table public.products
  add column track_stock boolean not null default false,
  add column stock integer not null default 0,
  add column stock_min integer not null default 0,
  add constraint products_stock_not_negative check (stock >= 0),
  add constraint products_stock_min_not_negative check (stock_min >= 0);

alter table public.order_items
  add column stocked_quantity integer not null default 0,
  add constraint order_items_stocked_quantity_not_negative check (stocked_quantity >= 0);

-- B. insert_order_lines: deducts tracked stock (used by every create and add path)
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
  v_track_stock boolean;
  v_stock integer;
  v_stocked integer;
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
      -- Locked for update: concurrent orders of a tracked product queue here
      -- instead of both reading the same stock.
      select p.name, p.variants, c.kitchen_station, p.track_stock, p.stock
      into v_product_name, v_product_variants, v_station, v_track_stock, v_stock
      from public.products p
      left join public.categories c on c.id = p.category_id
      where p.id = v_product_id and p.active = true
      for no key update of p;

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

      v_stocked := 0;
      if v_track_stock then
        if v_stock < v_quantity then
          raise exception 'No hay suficiente %: quedan %.', v_product_name, v_stock;
        end if;
        update public.products set stock = stock - v_quantity where id = v_product_id;
        v_stocked := v_quantity;
      end if;

      -- Lines without a station are never cooked: they are ready on arrival.
      v_ready_at := case when v_station is null then now() end;

      -- Kitchen lines never merge: the cook may already be looking at the old
      -- quantity, so every add creates its own line.
      if v_notes is null and v_station is null then
        insert into public.order_items (order_id, item_type, product_id, product_name, variant, quantity, station, ready_at, stocked_quantity)
        values (p_order_id, 'product', v_product_id, v_product_name, v_variant, v_quantity, v_station, v_ready_at, v_stocked)
        on conflict (order_id, product_id, coalesce(variant, ''))
          where item_type = 'product' and notes is null and delivered_at is null and station is null
        do update set
          quantity = order_items.quantity + excluded.quantity,
          stocked_quantity = order_items.stocked_quantity + excluded.stocked_quantity;
      elsif v_notes is null then
        insert into public.order_items (order_id, item_type, product_id, product_name, variant, quantity, station, ready_at, stocked_quantity)
        values (p_order_id, 'product', v_product_id, v_product_name, v_variant, v_quantity, v_station, v_ready_at, v_stocked);
      else
        insert into public.order_items (order_id, item_type, product_id, product_name, variant, quantity, notes, station, ready_at, stocked_quantity)
        values (p_order_id, 'product', v_product_id, v_product_name, v_variant, v_quantity, v_notes, v_station, v_ready_at, v_stocked);
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.insert_order_lines(uuid, jsonb) from public, anon, authenticated;

-- C. cancel_order_core: gives the stock back
create or replace function public.cancel_order_core(p_order_id uuid)
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

  select status into v_status
  from public.orders
  where id = p_order_id
  for update;

  if v_status is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if v_status <> 'open' then
    raise exception 'El pedido ya no está abierto.';
  end if;

  -- Give back exactly what the order took, whatever the product's tracking is now.
  update public.products p
  set stock = p.stock + taken.quantity
  from (
    select product_id, sum(stocked_quantity)::integer as quantity
    from public.order_items
    where order_id = p_order_id and stocked_quantity > 0 and product_id is not null
    group by product_id
  ) taken
  where p.id = taken.product_id;

  update public.orders
  set status = 'cancelled', cancelled_at = now()
  where id = p_order_id;

  return p_order_id;
end;
$$;
revoke all on function public.cancel_order_core(uuid) from public, anon, authenticated;

-- D. device_list_catalog: stock fields for the waiter grid
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
          jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'category_id', p.category_id,
            'variants', to_jsonb(p.variants),
            'track_stock', p.track_stock,
            'stock', p.stock
          )
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
revoke all on function public.device_list_catalog(text) from public;
grant execute on function public.device_list_catalog(text) to anon, authenticated;

-- E. Admin stock RPCs
create or replace function public.admin_receive_stock(p_product_id uuid, p_quantity integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ajustar el inventario.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a cero.';
  end if;

  update public.products
  set stock = stock + p_quantity
  where id = p_product_id and track_stock = true
  returning stock into v_stock;

  if v_stock is null then
    raise exception 'El producto no controla inventario.';
  end if;

  return jsonb_build_object('product_id', p_product_id, 'stock', v_stock);
end;
$$;

create or replace function public.admin_count_stock(p_product_id uuid, p_stock integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ajustar el inventario.';
  end if;
  if p_stock is null or p_stock < 0 then
    raise exception 'El conteo no puede ser negativo.';
  end if;

  update public.products
  set stock = p_stock
  where id = p_product_id and track_stock = true
  returning stock into v_stock;

  if v_stock is null then
    raise exception 'El producto no controla inventario.';
  end if;

  return jsonb_build_object('product_id', p_product_id, 'stock', v_stock);
end;
$$;

revoke all on function public.admin_receive_stock(uuid, integer) from public, anon;
revoke all on function public.admin_count_stock(uuid, integer) from public, anon;
grant execute on function public.admin_receive_stock(uuid, integer) to authenticated;
grant execute on function public.admin_count_stock(uuid, integer) to authenticated;
