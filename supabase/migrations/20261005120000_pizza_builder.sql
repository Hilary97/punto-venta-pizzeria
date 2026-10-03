-- Pizza builder.
--
-- Written by hand (no Supabase CLI available in the authoring environment).
-- Verified with the PGlite harness in supabase/tests.
--
-- Design summary:
--   * The pizza catalog (sizes, styles + per-size prices, ingredients and
--     surcharges) lives in tables seeded from the restaurant menu. Clients may
--     read them; only admins may write them (phase 2 editor).
--   * A pizza order line stores a canonical jsonb configuration in
--     order_items.pizza. Orders still NEVER store prices: validate_pizza,
--     price_pizza and describe_pizza resolve everything at quote/pay time, so
--     catalog edits between ordering and paying are always honoured.
--   * Order lines (products and pizzas) and order-level notes are validated
--     in internal helpers shared by the register RPCs and the device RPCs.
--   * quote_order lets the register preview server-side prices; pay_order now
--     prices the lines itself instead of delegating to create_sale (which only
--     understands plain products) and writes the sale directly.

-- ============================================================================
-- A. Pizza catalog
-- ============================================================================

create table public.pizza_sizes (
  code text primary key check (code in ('chica', 'mediana', 'grande')),
  name text not null,
  sort_order integer not null,
  allowed_portions integer[] not null
);

create table public.pizza_styles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  kind text not null check (kind in ('special', 'custom')),
  included_ingredients integer not null default 0 check (included_ingredients between 0 and 4),
  sort_order integer not null default 0,
  active boolean not null default true
);

create table public.pizza_style_prices (
  style_id uuid not null references public.pizza_styles (id) on delete cascade,
  size_code text not null references public.pizza_sizes (code),
  price_cents integer not null check (price_cents > 0),
  primary key (style_id, size_code)
);

create table public.pizza_ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  active boolean not null default true
);

-- Single-row table (id is always true).
create table public.pizza_settings (
  id boolean primary key default true check (id),
  extra_ingredient_cents integer not null check (extra_ingredient_cents > 0),
  extra_cheese_cents integer not null check (extra_cheese_cents > 0)
);

insert into public.pizza_sizes (code, name, sort_order, allowed_portions) values
  ('chica', 'Chica', 1, '{1}'),
  ('mediana', 'Mediana', 2, '{1,2}'),
  ('grande', 'Grande', 3, '{1,2,3,4}');

insert into public.pizza_settings (id, extra_ingredient_cents, extra_cheese_cents)
values (true, 500, 3000);

insert into public.pizza_ingredients (name, sort_order) values
  ('Jamón', 1),
  ('Pepperoni', 2),
  ('Chorizo', 3),
  ('Serrano', 4),
  ('Salami', 5),
  ('Salchicha', 6),
  ('Cebolla', 7),
  ('Piña', 8),
  ('Jitomate', 9),
  ('Pimiento morrón', 10),
  ('Champiñones', 11),
  ('Jalapeños', 12),
  ('Tocino', 13),
  ('Aceituna negra', 14),
  ('Ajo', 15);

-- Seed styles and their three prices in one statement. Prices are in pesos in
-- the VALUES list and stored as cents.
with seed (sort_order, name, description, kind, included_ingredients, chica, mediana, grande) as (
  values
    (1, 'Estilo Varas', 'Pepperoni, jamón, salami, tocino, chorizo, champiñón y morrón', 'special', 0, 130, 220, 250),
    (2, 'Estilo Chuy''s', 'Pepperoni, champiñón, cebolla y jalapeño', 'special', 0, 120, 200, 230),
    (3, 'Estilo Seis Carnes', 'Pepperoni, jamón, salami, tocino, chorizo y salchicha', 'special', 0, 130, 220, 250),
    (4, 'Estilo Vegetariana', 'Todos los vegetales', 'special', 0, 130, 210, 230),
    (5, 'Estilo Suprema', 'Pepperoni, jamón y todos los vegetales', 'special', 0, 130, 220, 250),
    (6, 'Estilo El Primo', 'Pepperoni, piña y morrón', 'special', 0, 120, 200, 220),
    (7, 'Estilo Cuquío', 'Chile martajado, pepperoni, chorizo, salchicha, jalapeño y cebolla', 'special', 0, 130, 220, 250),
    (8, 'Estilo Cuatro Carnes', 'Jamón, salami, tocino y salchicha', 'special', 0, 120, 210, 240),
    (9, 'Estilo Especial', 'Jamón, piña, tocino y serrano', 'special', 0, 120, 200, 230),
    (10, 'Estilo Margarita', 'Pepperoni, jamón, salami, tocino y champiñón', 'special', 0, 120, 210, 250),
    (11, 'Estilo Mexicana', 'Chorizo, cebolla, jitomate y los 3 chiles', 'special', 0, 130, 210, 230),
    (12, 'Estilo Chuley', 'Pepperoni, jamón, tocino, extra queso y todos los vegetales', 'special', 0, 180, 260, 280),
    (13, 'Estilo El Ranchito', 'Tender, pepperoni y serrano', 'special', 0, 180, 260, 280),
    (0, 'Arma tu combinación', 'Incluye dos ingredientes', 'custom', 2, 110, 190, 210)
),
inserted as (
  insert into public.pizza_styles (name, description, kind, included_ingredients, sort_order)
  select name, description, kind, included_ingredients, sort_order from seed
  returning id, name
)
insert into public.pizza_style_prices (style_id, size_code, price_cents)
select i.id, p.size_code, p.pesos * 100
from inserted i
join seed s on s.name = i.name
cross join lateral (
  values ('chica', s.chica), ('mediana', s.mediana), ('grande', s.grande)
) as p (size_code, pesos);

alter table public.pizza_sizes enable row level security;
alter table public.pizza_styles enable row level security;
alter table public.pizza_style_prices enable row level security;
alter table public.pizza_ingredients enable row level security;
alter table public.pizza_settings enable row level security;

create policy pizza_sizes_select on public.pizza_sizes
  for select to authenticated using (auth.role() = 'authenticated');
create policy pizza_sizes_insert on public.pizza_sizes
  for insert to authenticated with check (public.is_admin());
create policy pizza_sizes_update on public.pizza_sizes
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pizza_sizes_delete on public.pizza_sizes
  for delete to authenticated using (public.is_admin());

create policy pizza_styles_select on public.pizza_styles
  for select to authenticated using (auth.role() = 'authenticated');
create policy pizza_styles_insert on public.pizza_styles
  for insert to authenticated with check (public.is_admin());
create policy pizza_styles_update on public.pizza_styles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pizza_styles_delete on public.pizza_styles
  for delete to authenticated using (public.is_admin());

create policy pizza_style_prices_select on public.pizza_style_prices
  for select to authenticated using (auth.role() = 'authenticated');
create policy pizza_style_prices_insert on public.pizza_style_prices
  for insert to authenticated with check (public.is_admin());
create policy pizza_style_prices_update on public.pizza_style_prices
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pizza_style_prices_delete on public.pizza_style_prices
  for delete to authenticated using (public.is_admin());

create policy pizza_ingredients_select on public.pizza_ingredients
  for select to authenticated using (auth.role() = 'authenticated');
create policy pizza_ingredients_insert on public.pizza_ingredients
  for insert to authenticated with check (public.is_admin());
create policy pizza_ingredients_update on public.pizza_ingredients
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pizza_ingredients_delete on public.pizza_ingredients
  for delete to authenticated using (public.is_admin());

create policy pizza_settings_select on public.pizza_settings
  for select to authenticated using (auth.role() = 'authenticated');
create policy pizza_settings_insert on public.pizza_settings
  for insert to authenticated with check (public.is_admin());
create policy pizza_settings_update on public.pizza_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pizza_settings_delete on public.pizza_settings
  for delete to authenticated using (public.is_admin());

revoke all on public.pizza_sizes, public.pizza_styles, public.pizza_style_prices,
  public.pizza_ingredients, public.pizza_settings from anon;
grant select, insert, update, delete on public.pizza_sizes, public.pizza_styles,
  public.pizza_style_prices, public.pizza_ingredients, public.pizza_settings to authenticated;

-- ============================================================================
-- B. Orders: notes, line types, pizza payload
-- ============================================================================

alter table public.orders
  add column notes text,
  add constraint orders_notes_length check (notes is null or length(btrim(notes)) between 1 and 300);

alter table public.order_items
  add column item_type text not null default 'product' check (item_type in ('product', 'pizza')),
  add column pizza jsonb,
  add column notes text,
  add constraint order_items_notes_length check (notes is null or length(btrim(notes)) between 1 and 200),
  add constraint order_items_type_payload check (
    (item_type = 'product' and pizza is null)
    or (item_type = 'pizza' and pizza is not null and product_id is null)
  );

-- The only unique constraint on order_items is (order_id, product_id); look up
-- its real name instead of assuming Postgres' default.
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.order_items'::regclass and contype = 'u';

  if v_name is not null then
    execute format('alter table public.order_items drop constraint %I', v_name);
  end if;
end;
$$;

-- Only plain product lines without notes merge by summing quantities.
create unique index order_items_product_merge_idx
  on public.order_items (order_id, product_id)
  where item_type = 'product' and notes is null;

-- ============================================================================
-- C. Pizza configuration (internal helpers)
-- ============================================================================

-- Parses a jsonb array of uuid strings. A missing value is an empty array.
create or replace function public.pizza_uuid_array(p_value jsonb)
returns uuid[]
language plpgsql
stable
set search_path = public
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return '{}'::uuid[];
  end if;

  if jsonb_typeof(p_value) <> 'array' then
    raise exception 'La configuración de la pizza es inválida.';
  end if;

  return array(select e::uuid from jsonb_array_elements_text(p_value) as e);
exception
  when invalid_text_representation then
    raise exception 'La configuración de la pizza es inválida.';
end;
$$;

-- Validates a pizza configuration and returns its canonical form:
-- {"size": "...", "portions": [{"style_id", "ingredient_ids",
-- "extra_ingredient_ids", "extra_cheese"}]}. Ingredient lists are sorted by
-- the catalog order so equal pizzas always serialize equally.
create or replace function public.validate_pizza(p_config jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_size public.pizza_sizes%rowtype;
  v_portions jsonb;
  v_portion jsonb;
  v_style public.pizza_styles%rowtype;
  v_style_id uuid;
  v_ingredients uuid[];
  v_extras uuid[];
  v_cheese jsonb;
  v_canonical jsonb := '[]'::jsonb;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'La configuración de la pizza es inválida.';
  end if;

  select * into v_size from public.pizza_sizes where code = p_config ->> 'size';
  if not found then
    raise exception 'Tamaño de pizza inválido.';
  end if;

  v_portions := p_config -> 'portions';
  if v_portions is null or jsonb_typeof(v_portions) <> 'array' or jsonb_array_length(v_portions) = 0 then
    raise exception 'La configuración de la pizza es inválida.';
  end if;

  if not (jsonb_array_length(v_portions) = any (v_size.allowed_portions)) then
    raise exception 'La pizza % no se puede dividir en % porciones.',
      v_size.name, jsonb_array_length(v_portions);
  end if;

  for v_portion in select * from jsonb_array_elements(v_portions)
  loop
    if jsonb_typeof(v_portion) <> 'object' then
      raise exception 'La configuración de la pizza es inválida.';
    end if;

    begin
      v_style_id := nullif(v_portion ->> 'style_id', '')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'La configuración de la pizza es inválida.';
    end;

    select * into v_style from public.pizza_styles where id = v_style_id and active = true;
    if not found then
      raise exception 'Uno de los estilos no existe o no está activo.';
    end if;

    if not exists (
      select 1 from public.pizza_style_prices where style_id = v_style.id and size_code = v_size.code
    ) then
      raise exception 'El estilo % no está disponible en tamaño %.', v_style.name, v_size.name;
    end if;

    v_ingredients := public.pizza_uuid_array(v_portion -> 'ingredient_ids');
    v_extras := public.pizza_uuid_array(v_portion -> 'extra_ingredient_ids');

    if v_style.kind = 'special' then
      if cardinality(v_ingredients) > 0 then
        raise exception '% ya incluye sus ingredientes.', v_style.name;
      end if;
    else
      if cardinality(v_ingredients) = 0 then
        raise exception 'Elige al menos un ingrediente para %.', v_style.name;
      end if;
      if cardinality(v_ingredients) > v_style.included_ingredients then
        raise exception '% incluye hasta % ingredientes.', v_style.name, v_style.included_ingredients;
      end if;
    end if;

    if cardinality(v_extras) > 10 then
      raise exception 'Máximo 10 ingredientes extra por porción.';
    end if;

    if cardinality(v_ingredients) <> (select count(distinct x) from unnest(v_ingredients) as x)
       or cardinality(v_extras) <> (select count(distinct x) from unnest(v_extras) as x) then
      raise exception 'Los ingredientes de una porción no se pueden repetir.';
    end if;

    if (select count(*) from public.pizza_ingredients where id = any (v_ingredients) and active = true)
         <> cardinality(v_ingredients)
       or (select count(*) from public.pizza_ingredients where id = any (v_extras) and active = true)
         <> cardinality(v_extras) then
      raise exception 'Uno de los ingredientes no existe o no está activo.';
    end if;

    v_cheese := v_portion -> 'extra_cheese';
    if v_cheese is null or jsonb_typeof(v_cheese) = 'null' then
      v_cheese := 'false'::jsonb;
    elsif jsonb_typeof(v_cheese) <> 'boolean' then
      raise exception 'La configuración de la pizza es inválida.';
    end if;

    v_canonical := v_canonical || jsonb_build_object(
      'style_id', v_style.id,
      'ingredient_ids', (
        select coalesce(jsonb_agg(i.id order by i.sort_order, i.name), '[]'::jsonb)
        from public.pizza_ingredients i where i.id = any (v_ingredients)
      ),
      'extra_ingredient_ids', (
        select coalesce(jsonb_agg(i.id order by i.sort_order, i.name), '[]'::jsonb)
        from public.pizza_ingredients i where i.id = any (v_extras)
      ),
      'extra_cheese', v_cheese
    );
  end loop;

  return jsonb_build_object('size', v_size.code, 'portions', v_canonical);
end;
$$;

-- Prices a canonical configuration: the most expensive style for the size,
-- plus every extra ingredient and extra cheese charged in full per portion.
create or replace function public.price_pizza(p_config jsonb)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base integer;
  v_extra_ingredients integer;
  v_extra_cheeses integer;
  v_settings public.pizza_settings%rowtype;
begin
  select max(sp.price_cents) into v_base
  from jsonb_array_elements(p_config -> 'portions') as p
  join public.pizza_style_prices sp
    on sp.style_id = (p ->> 'style_id')::uuid and sp.size_code = p_config ->> 'size';

  if v_base is null then
    raise exception 'No hay precio para esta pizza.';
  end if;

  select
    coalesce(sum(jsonb_array_length(p -> 'extra_ingredient_ids')), 0),
    count(*) filter (where (p ->> 'extra_cheese')::boolean)
  into v_extra_ingredients, v_extra_cheeses
  from jsonb_array_elements(p_config -> 'portions') as p;

  select * into v_settings from public.pizza_settings where id;

  return v_base
    + v_extra_ingredients * v_settings.extra_ingredient_cents
    + v_extra_cheeses * v_settings.extra_cheese_cents;
end;
$$;

-- Human-readable description of a canonical configuration, e.g.
-- 'Pizza Grande · Mitades: ½ Estilo Varas + Jalapeños | ½ Estilo Chuy''s'.
create or replace function public.describe_pizza(p_config jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_size text;
  v_count integer := jsonb_array_length(p_config -> 'portions');
  v_label text;
  v_fraction text;
  v_portion jsonb;
  v_desc text;
  v_list text;
  v_parts text[] := '{}';
begin
  select name into v_size from public.pizza_sizes where code = p_config ->> 'size';

  v_label := case v_count when 2 then 'Mitades' when 3 then 'Tercios' when 4 then 'Cuartos' end;
  v_fraction := case v_count when 2 then '½' when 3 then '⅓' when 4 then '¼' end;

  for v_portion in select * from jsonb_array_elements(p_config -> 'portions')
  loop
    select name into v_desc from public.pizza_styles where id = (v_portion ->> 'style_id')::uuid;

    select string_agg(i.name, ', ' order by o.ord) into v_list
    from jsonb_array_elements_text(v_portion -> 'ingredient_ids') with ordinality as o (id, ord)
    join public.pizza_ingredients i on i.id = o.id::uuid;
    if v_list is not null then
      v_desc := v_desc || ' (' || v_list || ')';
    end if;

    select string_agg(i.name, ', ' order by o.ord) into v_list
    from jsonb_array_elements_text(v_portion -> 'extra_ingredient_ids') with ordinality as o (id, ord)
    join public.pizza_ingredients i on i.id = o.id::uuid;
    if v_list is not null then
      v_desc := v_desc || ' + ' || v_list;
    end if;

    if (v_portion ->> 'extra_cheese')::boolean then
      v_desc := v_desc || ' + Extra queso';
    end if;

    v_parts := v_parts || case when v_count > 1 then v_fraction || ' ' || v_desc else v_desc end;
  end loop;

  if v_count = 1 then
    return 'Pizza ' || v_size || ': ' || v_parts[1];
  end if;

  return 'Pizza ' || v_size || ' · ' || v_label || ': ' || array_to_string(v_parts, ' | ');
end;
$$;

revoke all on function public.pizza_uuid_array(jsonb) from public, anon, authenticated;
revoke all on function public.validate_pizza(jsonb) from public, anon, authenticated;
revoke all on function public.price_pizza(jsonb) from public, anon, authenticated;
revoke all on function public.describe_pizza(jsonb) from public, anon, authenticated;

-- ============================================================================
-- D. Order lines and notes (internal helpers)
-- ============================================================================

-- Trims an order-level note; blank becomes null.
create or replace function public.normalize_order_notes(p_notes text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_notes text := nullif(btrim(p_notes), '');
begin
  if v_notes is not null and length(v_notes) > 300 then
    raise exception 'La nota del pedido es demasiado larga.';
  end if;

  return v_notes;
end;
$$;

-- Validates and inserts order lines. Each element is either
-- {"type"?: "product", "product_id", "quantity", "notes"?} or
-- {"type": "pizza", "pizza": {config}, "quantity", "notes"?}.
-- Product lines without notes merge into an existing line of the same
-- product; product lines with notes and every pizza line are separate rows.
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

      v_product_name := null;
      select name into v_product_name
      from public.products
      where id = v_product_id and active = true
      for share;

      if v_product_name is null then
        raise exception 'Uno de los productos no existe o no está activo.';
      end if;

      if v_notes is null then
        insert into public.order_items (order_id, item_type, product_id, product_name, quantity)
        values (p_order_id, 'product', v_product_id, v_product_name, v_quantity)
        on conflict (order_id, product_id) where item_type = 'product' and notes is null
        do update set quantity = order_items.quantity + excluded.quantity;
      else
        insert into public.order_items (order_id, item_type, product_id, product_name, quantity, notes)
        values (p_order_id, 'product', v_product_id, v_product_name, v_quantity, v_notes);
      end if;
    end if;
  end loop;
end;
$$;

drop function if exists public.insert_order_core(uuid, uuid, text, integer, text, jsonb);

-- Validates and inserts an open order with its lines. Table and customer name
-- are both optional, but at least one is required.
create or replace function public.insert_order_core(
  p_created_by uuid,
  p_waiter_id uuid,
  p_waiter_name text,
  p_table_number integer,
  p_customer_name text,
  p_items jsonb,
  p_notes text
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

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe incluir al menos un producto.';
  end if;

  insert into public.orders (table_number, customer_name, created_by, waiter_id, waiter_name, notes)
  values (p_table_number, v_customer_name, p_created_by, p_waiter_id, p_waiter_name, v_notes)
  returning id into v_order_id;

  perform public.insert_order_lines(v_order_id, p_items);

  return v_order_id;
end;
$$;

-- Adds lines to an open order.
create or replace function public.add_order_items_core(p_order_id uuid, p_items jsonb)
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

  -- Serialize against concurrent pay/cancel/add calls on the same order.
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

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes agregar al menos un producto.';
  end if;

  perform public.insert_order_lines(p_order_id, p_items);

  return p_order_id;
end;
$$;

-- Sets (or clears) the note of an open order.
create or replace function public.set_order_notes_core(p_order_id uuid, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notes text := public.normalize_order_notes(p_notes);
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

  update public.orders set notes = v_notes where id = p_order_id;

  return p_order_id;
end;
$$;

revoke all on function public.normalize_order_notes(text) from public, anon, authenticated;
revoke all on function public.insert_order_lines(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.insert_order_core(uuid, uuid, text, integer, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.add_order_items_core(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.set_order_notes_core(uuid, text) from public, anon, authenticated;

-- ============================================================================
-- D. Register RPCs (authenticated admin / cashier)
-- ============================================================================

drop function if exists public.create_order(integer, text, jsonb);

create or replace function public.create_order(
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
    public.insert_order_core(v_uid, null, null, p_table_number, p_customer_name, p_items, p_notes)
  );
end;
$$;

create or replace function public.set_order_notes(p_order_id uuid, p_notes text)
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
    raise exception 'Debes iniciar sesión para modificar un pedido.';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is null or v_role not in ('admin', 'cashier') then
    raise exception 'Los pedidos de meseros se registran desde un dispositivo autorizado.';
  end if;

  return jsonb_build_object('order_id', public.set_order_notes_core(p_order_id, p_notes));
end;
$$;

revoke all on function public.create_order(integer, text, jsonb, text) from public, anon;
revoke all on function public.set_order_notes(uuid, text) from public, anon;
grant execute on function public.create_order(integer, text, jsonb, text) to authenticated;
grant execute on function public.set_order_notes(uuid, text) to authenticated;

-- ============================================================================
-- E. Quote and pay (server pricing)
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
    select * from public.order_items where order_id = p_order_id order by product_name, id
  loop
    v_name := v_row.product_name;
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

revoke all on function public.order_lines_priced(uuid) from public, anon, authenticated;

create or replace function public.quote_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_lines jsonb;
  v_total integer;
  v_all_available boolean;
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para cobrar pedidos.' using errcode = '42501';
  end if;

  select status into v_status from public.orders where id = p_order_id;
  if v_status is null then
    raise exception 'El pedido no existe.';
  end if;

  v_lines := public.order_lines_priced(p_order_id);

  select
    coalesce(sum((l ->> 'line_total_cents')::integer), 0),
    coalesce(bool_and((l ->> 'available')::boolean), false)
  into v_total, v_all_available
  from jsonb_array_elements(v_lines) as l;

  return jsonb_build_object(
    'order_id', p_order_id,
    'status', v_status,
    'lines', v_lines,
    'total_cents', v_total,
    'payable', v_status = 'open' and v_all_available
  );
end;
$$;

-- Charges an open order. Prices come from order_lines_priced (products and
-- pizzas alike); the sale is written here instead of through create_sale.
-- Everything is one transaction: any failure leaves the order open.
create or replace function public.pay_order(p_order_id uuid, p_received_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_lines jsonb;
  v_line jsonb;
  v_unavailable text;
  v_total integer;
  v_session_id uuid;
  v_change integer;
  v_sale_id uuid;
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para cobrar pedidos.' using errcode = '42501';
  end if;

  if p_order_id is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if p_received_cents is null or p_received_cents < 0 then
    raise exception 'El monto recibido no es válido.';
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

  v_lines := public.order_lines_priced(p_order_id);

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'El pedido no tiene productos.';
  end if;

  select string_agg(l ->> 'name', ', ')
  into v_unavailable
  from jsonb_array_elements(v_lines) as l
  where not (l ->> 'available')::boolean;

  if v_unavailable is not null then
    raise exception 'Hay productos no disponibles en el pedido: %. Corrígelo en Pedidos.', v_unavailable;
  end if;

  select id into v_session_id from public.cash_sessions where closed_at is null limit 1;
  if v_session_id is null then
    raise exception 'No hay una caja abierta. Abre la caja antes de vender.';
  end if;

  select sum((l ->> 'line_total_cents')::integer)
  into v_total
  from jsonb_array_elements(v_lines) as l;

  if p_received_cents < v_total then
    raise exception 'El monto recibido es menor al total de la venta.';
  end if;

  v_change := p_received_cents - v_total;

  insert into public.sales (session_id, cashier_id, total_cents, received_cents, change_cents)
  values (v_session_id, v_uid, v_total, p_received_cents, v_change)
  returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    insert into public.sale_items (sale_id, product_id, product_name, unit_price_cents, quantity)
    select
      v_sale_id,
      i.product_id,
      (v_line ->> 'name') || coalesce(' — Nota: ' || (v_line ->> 'notes'), ''),
      (v_line ->> 'unit_price_cents')::integer,
      (v_line ->> 'quantity')::integer
    from public.order_items i
    where i.id = (v_line ->> 'order_item_id')::uuid;
  end loop;

  update public.orders
  set status = 'paid', paid_sale_id = v_sale_id, paid_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'total_cents', v_total,
    'change_cents', v_change,
    'order_id', p_order_id
  );
end;
$$;

revoke all on function public.quote_order(uuid) from public, anon;
revoke all on function public.pay_order(uuid, integer) from public, anon;
grant execute on function public.quote_order(uuid) to authenticated;
grant execute on function public.pay_order(uuid, integer) to authenticated;

-- ============================================================================
-- F. Device RPCs
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
          jsonb_build_object('id', p.id, 'name', p.name, 'category_id', p.category_id)
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
                  'notes', i.notes
                )
                order by i.product_name, i.id
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

drop function if exists public.device_create_order(text, uuid, integer, text, jsonb);

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
  v_device := public.resolve_order_device(p_device_secret);

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
  v_device := public.resolve_order_device(p_device_secret);
  perform 1 from public.resolve_waiter_shift(v_device.id, p_shift_token);

  return jsonb_build_object('order_id', public.set_order_notes_core(p_order_id, p_notes));
end;
$$;

revoke all on function public.device_list_catalog(text) from public;
revoke all on function public.device_list_open_orders(text) from public;
revoke all on function public.device_create_order(text, uuid, integer, text, jsonb, text) from public;
revoke all on function public.device_set_order_notes(text, uuid, uuid, text) from public;

grant execute on function public.device_list_catalog(text) to anon, authenticated;
grant execute on function public.device_list_open_orders(text) to anon, authenticated;
grant execute on function public.device_create_order(text, uuid, integer, text, jsonb, text) to anon, authenticated;
grant execute on function public.device_set_order_notes(text, uuid, uuid, text) to anon, authenticated;
