-- Product variants: a product can require a choice (e.g. burger Res/Pollo).
-- The variant is stored on the order line; order_lines_priced appends it to the
-- display name so quotes, sale items and returns inherit it.

-- ============================================================================
-- A. Columns and constraints
-- ============================================================================

-- Valid: at most 8 entries, each trimmed non-blank <= 40 chars, no
-- case-insensitive duplicates. A check constraint cannot hold a subquery, so
-- the rule lives in an immutable helper.
create or replace function public.product_variants_valid(p_variants text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_variants is not null
    and coalesce(array_length(p_variants, 1), 0) <= 8
    and not exists (
      select 1 from unnest(p_variants) as v
      where v is null or v <> btrim(v) or v = '' or length(v) > 40
    )
    and (
      select count(distinct lower(v)) = count(*) from unnest(p_variants) as v
    );
$$;

alter table public.products
  add column variants text[] not null default '{}',
  add constraint products_variants_valid check (public.product_variants_valid(variants));

alter table public.order_items
  add column variant text null,
  add constraint order_items_variant_valid
    check (variant is null or (btrim(variant) <> '' and length(variant) <= 40));

-- NULLs are distinct in unique indexes, hence coalesce.
drop index if exists public.order_items_product_merge_idx;
create unique index order_items_product_merge_idx
  on public.order_items (order_id, product_id, coalesce(variant, ''))
  where item_type = 'product' and notes is null;

-- ============================================================================
-- B. insert_order_lines
-- ============================================================================

-- Validates and inserts order lines. Each element is either
-- {"type"?: "product", "product_id", "quantity", "variant"?, "notes"?} or
-- {"type": "pizza", "pizza": {config}, "quantity", "notes"?}.
-- Product lines without notes merge into an existing line of the same
-- product and variant; product lines with notes and every pizza line are
-- separate rows. Products with variants require one; others reject it.
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

      insert into public.order_items (order_id, item_type, pizza, product_name, quantity, notes)
      values (p_order_id, 'pizza', v_config, public.describe_pizza(v_config), v_quantity, v_notes);
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
      select name, variants into v_product_name, v_product_variants
      from public.products
      where id = v_product_id and active = true
      for share;

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

      if v_notes is null then
        insert into public.order_items (order_id, item_type, product_id, product_name, variant, quantity)
        values (p_order_id, 'product', v_product_id, v_product_name, v_variant, v_quantity)
        on conflict (order_id, product_id, coalesce(variant, '')) where item_type = 'product' and notes is null
        do update set quantity = order_items.quantity + excluded.quantity;
      else
        insert into public.order_items (order_id, item_type, product_id, product_name, variant, quantity, notes)
        values (p_order_id, 'product', v_product_id, v_product_name, v_variant, v_quantity, v_notes);
      end if;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- C. order_lines_priced
-- ============================================================================


-- Prices every line of an order at current catalog prices. Returns a jsonb
-- array of {order_item_id, item_type, name, notes, quantity, unit_price_cents,
-- line_total_cents, available, reason}. Unavailable lines carry null prices
-- and a reason. Product rows are locked `for share` so a concurrent price edit
-- cannot commit while a payment is in flight.
create or replace function public.order_lines_priced(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.order_items%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_name text;
  v_unit integer;
  v_reason text;
  v_config jsonb;
  v_current_name text;
begin
  for v_row in
    select * from public.order_items where order_id = p_order_id order by product_name, variant nulls first, id
  loop
    v_name := v_row.product_name;
    if v_row.variant is not null then
      v_name := v_name || ' (' || v_row.variant || ')';
    end if;
    v_unit := null;
    v_reason := null;

    if v_row.item_type = 'pizza' then
      begin
        v_config := public.validate_pizza(v_row.pizza);
        v_unit := public.price_pizza(v_config);
        v_name := public.describe_pizza(v_config);
      exception
        when raise_exception then
          v_unit := null;
          v_reason := sqlerrm;
      end;
    else
      v_current_name := null;
      if v_row.product_id is not null then
        select name, price_cents into v_current_name, v_unit
        from public.products
        where id = v_row.product_id and active = true
        for share;
      end if;

      if v_current_name is null then
        v_unit := null;
        v_reason := 'Producto no disponible';
      else
        v_name := v_current_name;
        if v_row.variant is not null then
          v_name := v_name || ' (' || v_row.variant || ')';
        end if;
      end if;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'order_item_id', v_row.id,
      'item_type', v_row.item_type,
      'name', v_name,
      'notes', v_row.notes,
      'quantity', v_row.quantity,
      'unit_price_cents', v_unit,
      'line_total_cents', v_unit * v_row.quantity,
      'available', v_unit is not null,
      'reason', v_reason
    );
  end loop;

  return v_lines;
end;
$$;

-- ============================================================================
-- D. Device catalog and open orders
-- ============================================================================

-- Active catalog for the order picker. Prices are deliberately not exposed,
-- neither for products nor for pizza styles.
create or replace function public.device_list_catalog(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_order_device(p_device_secret);

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


-- Open orders, oldest first. Mirrors the shape of the nested select used by
-- the frontend (`order_items`, not `items`) so the same row schema parses it.
create or replace function public.device_list_open_orders(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_order_device(p_device_secret);

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
                  'variant', i.variant
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

-- ============================================================================
-- E. Seed: burgers require Res or Pollo
-- ============================================================================

update public.products
set variants = '{Res,Pollo}'
where variants = '{}'
  and category_id in (select id from public.categories where name = 'Hamburguesas');
