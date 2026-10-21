-- Pizza dough limit per cash register shift (odd/tasks/pizza-dough-cash-shift.md).
-- The dough limit stops following the 05:00 clock: it belongs to a dough shift
-- that ends when the cash register is closed. Closing the register starts a new
-- shift with no rows, so every size is unlimited until the admin loads doughs
-- again; doughs loaded while no register is open belong to the shift that
-- follows. Cancelling still gives the dough back to the shift that supplied it.
-- Replaces the business_day key of 20261023120000_pizza_dough.sql, which is
-- already applied: existing rows and open orders are converted here, and the
-- old business_day / dough_day columns stay as history only.
-- Run it in one go while no orders are being written.

begin;

-- A. Shifts. The current shift is the highest id. A close inserts a new one;
-- deleting a cash session never touches them.
create table public.pizza_dough_shifts (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  -- Only set on shifts converted from the old clock-based business days.
  business_day date
);

alter table public.pizza_dough_shifts enable row level security;

create policy pizza_dough_shifts_select_admin on public.pizza_dough_shifts
  for select to authenticated using (public.is_admin());

revoke all on public.pizza_dough_shifts from public, anon, authenticated;
grant select on public.pizza_dough_shifts to authenticated;

create or replace function public.pizza_dough_shift()
returns bigint
language sql
stable
set search_path = public
as $$
  select max(id) from public.pizza_dough_shifts
$$;

revoke all on function public.pizza_dough_shift() from public, anon, authenticated;

-- B. Convert the existing data: one shift per old business day, in date order.
-- If nothing was loaded on the current business day, an empty shift goes last
-- so today stays unlimited, exactly as it was before this migration.
do $$
declare
  v_day date;
begin
  for v_day in select distinct business_day from public.pizza_dough_days order by 1
  loop
    insert into public.pizza_dough_shifts (started_at, business_day)
    values ((v_day + time '05:00') at time zone 'America/Mexico_City', v_day);
  end loop;

  if not exists (select 1 from public.pizza_dough_days where business_day = public.pizza_business_day()) then
    insert into public.pizza_dough_shifts default values;
  end if;
end;
$$;

alter table public.pizza_dough_days add column shift_id bigint references public.pizza_dough_shifts (id);

update public.pizza_dough_days d
set shift_id = s.id
from public.pizza_dough_shifts s
where s.business_day = d.business_day;

alter table public.pizza_dough_days alter column shift_id set not null;
alter table public.pizza_dough_days drop constraint pizza_dough_days_pkey;
alter table public.pizza_dough_days add primary key (shift_id, size_code);
alter table public.pizza_dough_days alter column business_day drop not null;

alter table public.order_items add column dough_shift bigint references public.pizza_dough_shifts (id);

update public.order_items i
set dough_shift = s.id
from public.pizza_dough_shifts s
where i.dough_day is not null and s.business_day = i.dough_day;

-- C. Closing the register starts the next shift.
create or replace function public.start_pizza_dough_shift()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pizza_dough_shifts default values;
  return null;
end;
$$;

revoke all on function public.start_pizza_dough_shift() from public, anon, authenticated;

create trigger cash_sessions_start_pizza_dough_shift
  after update of closed_at on public.cash_sessions
  for each row
  when (old.closed_at is null and new.closed_at is not null)
  execute function public.start_pizza_dough_shift();

-- D. insert_order_lines: takes the dough of the current shift
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
  v_shift bigint := public.pizza_dough_shift();
  v_size text;
  v_dough_left integer;
  v_dough_shift bigint;
  v_locked_sizes text[] := '{}';
  v_tracked_products uuid[] := '{}';
begin
  -- Lock every product of the payload up front, in id order: tracked ones for
  -- update (and check the total asked per product against the real stock),
  -- untracked ones for share. All product locks come before any dough lock,
  -- so concurrent orders, payments and cancels never wait on each other in a
  -- cycle. Malformed items are skipped here; the per-line loop rejects them.
  for v_short in
    select p.id, p.track_stock, wanted.quantity
    from (
      select (i ->> 'product_id')::uuid as product_id, sum((i ->> 'quantity')::integer) as quantity
      from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) as i
      where jsonb_typeof(i) = 'object'
        and coalesce(i ->> 'type', 'product') = 'product'
        and i ->> 'product_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and i ->> 'quantity' ~ '^0*[0-9]{1,9}$'
      group by 1
    ) wanted
    join public.products p on p.id = wanted.product_id and p.active = true
    order by p.id
  loop
    if v_short.track_stock then
      select p.name, p.stock into v_product_name, v_stock
      from public.products p
      where p.id = v_short.id
      for no key update of p;
      if v_stock < v_short.quantity then
        raise exception 'No hay suficiente %: quedan %.', v_product_name, v_stock;
      end if;
      v_tracked_products := v_tracked_products || v_short.id;
    else
      perform 1 from public.products p where p.id = v_short.id for share of p;
    end if;
  end loop;

  -- Then lock the current shift's dough rows of the sizes in the payload, in size_code
  -- order (always after every product), check the total pizzas asked per
  -- size, and remember which sizes were locked. Sizes without a row are
  -- unlimited, and so is any size without a recorded lock later on. Malformed
  -- items are skipped here too; the per-line loop rejects them.
  for v_short in
    select s.name, d.size_code, d.prepared - d.used as dough_left, wanted.quantity
    from (
      select i -> 'pizza' ->> 'size' as size_code, sum((i ->> 'quantity')::integer)::bigint as quantity
      from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) as i
      where jsonb_typeof(i) = 'object'
        and i ->> 'type' = 'pizza'
        and i ->> 'quantity' ~ '^0*[0-9]{1,9}$'
      group by 1
    ) wanted
    join public.pizza_dough_days d on d.size_code = wanted.size_code and d.shift_id = v_shift
    join public.pizza_sizes s on s.code = d.size_code
    order by d.size_code
    for no key update of d
  loop
    if v_short.dough_left < v_short.quantity then
      raise exception 'No hay masas de pizza %: quedan %.', v_short.name, v_short.dough_left;
    end if;
    v_locked_sizes := v_locked_sizes || v_short.size_code;
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
    if v_raw_quantity is null or v_raw_quantity !~ '^0*[0-9]{1,9}$' then
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

      -- Take the dough of the size only from a row the up-front check locked.
      -- Any other size (no row then, or a row the admin created in between) is
      -- unlimited: locking it here would break the lock order.
      v_size := v_config ->> 'size';
      v_dough_shift := null;
      v_dough_left := null;
      if v_size = any (v_locked_sizes) then
        select d.prepared - d.used into v_dough_left
        from public.pizza_dough_days d
        where d.shift_id = v_shift and d.size_code = v_size;
      end if;

      if v_dough_left is not null then
        if v_dough_left < v_quantity then
          raise exception 'No hay masas de pizza %: quedan %.',
            (select name from public.pizza_sizes where code = v_size), v_dough_left;
        end if;
        update public.pizza_dough_days
        set used = used + v_quantity
        where shift_id = v_shift and size_code = v_size;
        v_dough_shift := v_shift;
      end if;

      insert into public.order_items (order_id, item_type, pizza, product_name, quantity, notes, station, dough_shift)
      values (p_order_id, 'pizza', v_config, public.describe_pizza(v_config), v_quantity, v_notes, 'pizza', v_dough_shift);
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

      -- Only products the pre-check locked as tracked take stock; tracking
      -- switched on mid-order leaves this line untracked, like a late dough row.
      v_stocked := 0;
      if v_track_stock and v_product_id = any (v_tracked_products) then
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

-- E. cancel_order_core: gives the dough back to the shift that supplied it
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

  -- Then the dough rows the order took, in (shift_id, size_code) order,
  -- each back to the shift that supplied it, even if the register closed since.
  perform 1
  from public.pizza_dough_days d
  where (d.shift_id, d.size_code) in (
    select dough_shift, pizza ->> 'size' from public.order_items
    where order_id = p_order_id and dough_shift is not null
  )
  order by d.shift_id, d.size_code
  for no key update;

  update public.pizza_dough_days d
  set used = d.used - taken.quantity
  from (
    select dough_shift, pizza ->> 'size' as size_code, sum(quantity)::integer as quantity
    from public.order_items
    where order_id = p_order_id and dough_shift is not null
    group by 1, 2
  ) taken
  where d.shift_id = taken.dough_shift and d.size_code = taken.size_code;

  update public.orders
  set status = 'cancelled', cancelled_at = now()
  where id = p_order_id;

  return p_order_id;
end;
$$;
revoke all on function public.cancel_order_core(uuid) from public, anon, authenticated;

-- F. device_list_catalog: dough_left of the current shift
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
                where d.shift_id = public.pizza_dough_shift() and d.size_code = s.code
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


-- G. Admin RPCs and the dough left for every signed-in role, on the current shift
create or replace function public.admin_set_pizza_dough(p_size_code text, p_prepared integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift bigint := public.pizza_dough_shift();
  v_used integer;
  v_row public.pizza_dough_days;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cargar las masas.';
  end if;
  if p_prepared is null or p_prepared < 0 or p_prepared > 100000 then
    raise exception 'La cantidad de masas no es válida.';
  end if;
  if not exists (select 1 from public.pizza_sizes where code = p_size_code) then
    raise exception 'El tamaño de pizza no existe.';
  end if;

  select used into v_used
  from public.pizza_dough_days
  where shift_id = v_shift and size_code = p_size_code
  for no key update;

  if v_used is not null and p_prepared < v_used then
    raise exception 'No puedes cargar menos masas de las que ya se usaron (%).', v_used;
  end if;

  insert into public.pizza_dough_days (shift_id, size_code, prepared)
  values (v_shift, p_size_code, p_prepared)
  on conflict (shift_id, size_code) do update set prepared = excluded.prepared
  returning * into v_row;

  return jsonb_build_object(
    'shift_id', v_row.shift_id,
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
    'shift_started_at', (select started_at from public.pizza_dough_shifts where id = public.pizza_dough_shift()),
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
          on d.size_code = s.code and d.shift_id = public.pizza_dough_shift()
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
    on d.size_code = s.code and d.shift_id = public.pizza_dough_shift()
$$;

revoke all on function public.admin_set_pizza_dough(text, integer) from public, anon;
revoke all on function public.admin_list_pizza_dough() from public, anon;
revoke all on function public.list_pizza_dough_left() from public, anon;
grant execute on function public.admin_set_pizza_dough(text, integer) to authenticated;
grant execute on function public.admin_list_pizza_dough() to authenticated;
grant execute on function public.list_pizza_dough_left() to authenticated;

commit;
