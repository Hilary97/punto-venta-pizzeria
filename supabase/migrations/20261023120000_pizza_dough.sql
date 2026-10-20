-- Daily pizza dough per size (odd/tasks/pizza-dough.md).
-- Each morning the admin loads how many doughs were prepared per size. Every
-- pizza ordered takes one dough of its size (a line of quantity N takes N),
-- an order that asks for more than is left is rejected, and cancelling gives
-- the dough back to the business day that supplied it. A size with no row for
-- today is unlimited. The business day changes at 05:00 Mexico City time so
-- service after midnight stays on the same day.

-- A. Business day (the only place the day is computed)
create or replace function public.pizza_business_day_at(p_at timestamptz)
returns date
language sql
stable
set search_path = public
as $$
  select ((p_at at time zone 'America/Mexico_City') - interval '5 hours')::date
$$;

create or replace function public.pizza_business_day()
returns date
language sql
stable
set search_path = public
as $$
  select public.pizza_business_day_at(now())
$$;

revoke all on function public.pizza_business_day_at(timestamptz) from public, anon, authenticated;
revoke all on function public.pizza_business_day() from public, anon, authenticated;

-- B. Table and line column
create table public.pizza_dough_days (
  business_day date not null,
  size_code text not null references public.pizza_sizes (code),
  prepared integer not null,
  used integer not null default 0,
  primary key (business_day, size_code),
  constraint pizza_dough_days_prepared_not_negative check (prepared >= 0),
  constraint pizza_dough_days_used_not_negative check (used >= 0),
  constraint pizza_dough_days_used_within_prepared check (used <= prepared)
);

alter table public.order_items add column dough_day date;

-- RLS: admin read only; every write goes through the RPCs
alter table public.pizza_dough_days enable row level security;

create policy pizza_dough_days_select_admin on public.pizza_dough_days
  for select to authenticated using (public.is_admin());

-- Supabase grants all privileges on new public tables to anon and authenticated
-- by default, so revoke everything first and grant back only the admin read.
revoke all on public.pizza_dough_days from public, anon, authenticated;
grant select on public.pizza_dough_days to authenticated;

-- C. insert_order_lines: also takes the pizza dough (used by every create and add path)
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
  v_short record;
  v_day date := public.pizza_business_day();
  v_size text;
  v_dough_left integer;
  v_dough_day date;
begin
  -- Lock every tracked product of the payload up front, in id order, so
  -- concurrent orders, payments and cancels never wait on each other in a
  -- cycle, and check the total asked per product against the real stock.
  -- Malformed items are skipped here; the per-line loop rejects them.
  for v_short in
    select p.name, p.stock, wanted.quantity
    from (
      select (i ->> 'product_id')::uuid as product_id, sum((i ->> 'quantity')::integer) as quantity
      from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) as i
      where jsonb_typeof(i) = 'object'
        and coalesce(i ->> 'type', 'product') = 'product'
        and i ->> 'product_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and i ->> 'quantity' ~ '^[0-9]{1,9}$'
      group by 1
    ) wanted
    join public.products p on p.id = wanted.product_id and p.track_stock = true and p.active = true
    order by p.id
    for no key update of p
  loop
    if v_short.stock < v_short.quantity then
      raise exception 'No hay suficiente %: quedan %.', v_short.name, v_short.stock;
    end if;
  end loop;

  -- Then lock today's dough rows of the sizes in the payload, in size_code
  -- order (always after the products), and check the total pizzas asked per
  -- size. Sizes without a row are unlimited. Malformed items are skipped here
  -- too; the per-line loop rejects them.
  for v_short in
    select s.name, d.prepared - d.used as dough_left, wanted.quantity
    from (
      select i -> 'pizza' ->> 'size' as size_code, sum((i ->> 'quantity')::integer)::bigint as quantity
      from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) as i
      where jsonb_typeof(i) = 'object'
        and i ->> 'type' = 'pizza'
        and i ->> 'quantity' ~ '^[0-9]{1,9}$'
      group by 1
    ) wanted
    join public.pizza_dough_days d on d.size_code = wanted.size_code and d.business_day = v_day
    join public.pizza_sizes s on s.code = d.size_code
    order by d.size_code
    for no key update of d
  loop
    if v_short.dough_left < v_short.quantity then
      raise exception 'No hay masas de pizza %: quedan %.', v_short.name, v_short.dough_left;
    end if;
  end loop;

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

      -- Take the dough of the size from today's row, if there is one. The row
      -- is locked already when it existed at the up-front check; the re-check
      -- also covers a row the admin created in between.
      v_size := v_config ->> 'size';
      v_dough_day := null;
      v_dough_left := null;
      select d.prepared - d.used into v_dough_left
      from public.pizza_dough_days d
      where d.business_day = v_day and d.size_code = v_size
      for no key update;

      if v_dough_left is not null then
        if v_dough_left < v_quantity then
          raise exception 'No hay masas de pizza %: quedan %.',
            (select name from public.pizza_sizes where code = v_size), v_dough_left;
        end if;
        update public.pizza_dough_days
        set used = used + v_quantity
        where business_day = v_day and size_code = v_size;
        v_dough_day := v_day;
      end if;

      insert into public.order_items (order_id, item_type, pizza, product_name, quantity, notes, station, dough_day)
      values (p_order_id, 'pizza', v_config, public.describe_pizza(v_config), v_quantity, v_notes, 'pizza', v_dough_day);
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
      select p.name, p.variants, c.kitchen_station, p.track_stock, p.stock
      into v_product_name, v_product_variants, v_station, v_track_stock, v_stock
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

-- D. cancel_order_core: also gives the dough back
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
  -- Rows are locked in id order first, like every other stock writer.
  perform 1
  from public.products
  where id in (
    select product_id from public.order_items
    where order_id = p_order_id and stocked_quantity > 0 and product_id is not null
  )
  order by id
  for no key update;

  update public.products p
  set stock = p.stock + taken.quantity
  from (
    select product_id, sum(stocked_quantity)::integer as quantity
    from public.order_items
    where order_id = p_order_id and stocked_quantity > 0 and product_id is not null
    group by product_id
  ) taken
  where p.id = taken.product_id;

  -- Then the dough rows the order took, in (business_day, size_code) order,
  -- each back to the day that supplied it.
  perform 1
  from public.pizza_dough_days d
  where (d.business_day, d.size_code) in (
    select dough_day, pizza ->> 'size' from public.order_items
    where order_id = p_order_id and dough_day is not null
  )
  order by d.business_day, d.size_code
  for no key update;

  update public.pizza_dough_days d
  set used = d.used - taken.quantity
  from (
    select dough_day, pizza ->> 'size' as size_code, sum(quantity)::integer as quantity
    from public.order_items
    where order_id = p_order_id and dough_day is not null
    group by 1, 2
  ) taken
  where d.business_day = taken.dough_day and d.size_code = taken.size_code;

  update public.orders
  set status = 'cancelled', cancelled_at = now()
  where id = p_order_id;

  return p_order_id;
end;
$$;
revoke all on function public.cancel_order_core(uuid) from public, anon, authenticated;

-- E. device_list_catalog: dough_left per size for the waiter grid
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
              'sort_order', s.sort_order,
              'dough_left', (
                select d.prepared - d.used from public.pizza_dough_days d
                where d.business_day = public.pizza_business_day() and d.size_code = s.code
              )
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


-- F. Admin RPCs and the dough left for every signed-in role
create or replace function public.admin_set_pizza_dough(p_size_code text, p_prepared integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := public.pizza_business_day();
  v_used integer;
  v_row public.pizza_dough_days;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cargar las masas.';
  end if;
  if p_prepared is null or p_prepared < 0 then
    raise exception 'La cantidad de masas no es válida.';
  end if;
  if not exists (select 1 from public.pizza_sizes where code = p_size_code) then
    raise exception 'El tamaño de pizza no existe.';
  end if;

  select used into v_used
  from public.pizza_dough_days
  where business_day = v_day and size_code = p_size_code
  for no key update;

  if v_used is not null and p_prepared < v_used then
    raise exception 'No puedes cargar menos masas de las que ya se usaron (%).', v_used;
  end if;

  insert into public.pizza_dough_days (business_day, size_code, prepared)
  values (v_day, p_size_code, p_prepared)
  on conflict (business_day, size_code) do update set prepared = excluded.prepared
  returning * into v_row;

  return jsonb_build_object(
    'business_day', v_row.business_day,
    'size_code', v_row.size_code,
    'prepared', v_row.prepared,
    'used', v_row.used,
    'left', v_row.prepared - v_row.used
  );
end;
$$;

create or replace function public.admin_list_pizza_dough()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver las masas.';
  end if;

  return jsonb_build_object(
    'business_day', public.pizza_business_day(),
    'sizes',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'size_code', s.code,
            'name', s.name,
            'prepared', d.prepared,
            'used', d.used,
            'left', d.prepared - d.used
          )
          order by s.sort_order
        )
        from public.pizza_sizes s
        left join public.pizza_dough_days d
          on d.size_code = s.code and d.business_day = public.pizza_business_day()
      ),
      '[]'::jsonb
    )
  );
end;
$$;

-- Any signed-in role (admin, cashier, waiter) reads the dough left, so the
-- table itself stays admin only.
create or replace function public.list_pizza_dough_left()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('size_code', s.code, 'dough_left', d.prepared - d.used)
      order by s.sort_order
    ),
    '[]'::jsonb
  )
  from public.pizza_sizes s
  left join public.pizza_dough_days d
    on d.size_code = s.code and d.business_day = public.pizza_business_day()
$$;

revoke all on function public.admin_set_pizza_dough(text, integer) from public, anon;
revoke all on function public.admin_list_pizza_dough() from public, anon;
revoke all on function public.list_pizza_dough_left() from public, anon;
grant execute on function public.admin_set_pizza_dough(text, integer) to authenticated;
grant execute on function public.admin_list_pizza_dough() to authenticated;
grant execute on function public.list_pizza_dough_left() to authenticated;
