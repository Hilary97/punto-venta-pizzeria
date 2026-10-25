-- Admin-managed pizza extras.
--
-- Extra cheese used to be a fixed flag (`extra_cheese`) with its price in
-- pizza_settings.extra_cheese_cents. Now every extra (Extra queso, Orilla
-- rellena, ...) is a row in pizza_extras with its own price, toggled per
-- portion and charged once per portion, like extra cheese was.
--
--   * "Extra queso" is seeded with a fixed id and the current cheese price.
--   * Canonical portions carry `extra_ids` (sorted by catalog order) instead
--     of `extra_cheese`. Stored order lines are rewritten once here; a client
--     that still sends `extra_cheese: true` gets Extra queso.
--   * Extras are never hard-deleted (order lines reference them): deactivate.
--   * Prices stay server-side: the builder catalog has no prices.
--
-- Runs as one script (Supabase SQL Editor).

-- ============================================================================
-- A. Table, policies and seed
-- ============================================================================

create table public.pizza_extras (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  price_cents integer not null check (price_cents between 1 and 10000000),
  sort_order integer not null default 0,
  active boolean not null default true
);

alter table public.pizza_extras enable row level security;

create policy pizza_extras_select on public.pizza_extras
  for select to authenticated using (auth.role() = 'authenticated');
create policy pizza_extras_insert on public.pizza_extras
  for insert to authenticated with check (public.is_admin());
create policy pizza_extras_update on public.pizza_extras
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pizza_extras_delete on public.pizza_extras
  for delete to authenticated using (public.is_admin());

revoke all on public.pizza_extras from anon;
grant select, insert, update, delete on public.pizza_extras to authenticated;

-- Fixed id: legacy `extra_cheese: true` resolves to this row.
create or replace function public.pizza_cheese_extra_id()
returns uuid
language sql
immutable
as $$
  select '00000000-0000-4000-8000-000000000001'::uuid
$$;

revoke all on function public.pizza_cheese_extra_id() from public, anon, authenticated;

insert into public.pizza_extras (id, name, price_cents, sort_order)
select public.pizza_cheese_extra_id(), 'Extra queso', extra_cheese_cents, 1
from public.pizza_settings
where id;

-- ============================================================================
-- B. Stored order lines: extra_cheese -> extra_ids
-- ============================================================================

update public.order_items i
set pizza = jsonb_set(
  i.pizza,
  '{portions}',
  (
    select coalesce(
      jsonb_agg(
        (e.p - 'extra_cheese') || jsonb_build_object(
          'extra_ids',
          case
            when e.p -> 'extra_cheese' = 'true'::jsonb then jsonb_build_array(public.pizza_cheese_extra_id())
            else '[]'::jsonb
          end
        )
        order by e.ord
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements(i.pizza -> 'portions') with ordinality as e (p, ord)
  )
)
where i.item_type = 'pizza'
  and jsonb_typeof(i.pizza -> 'portions') = 'array';

alter table public.pizza_settings drop column extra_cheese_cents;

-- ============================================================================
-- C. Validation, pricing and description
-- ============================================================================

-- Validates a pizza configuration and returns its canonical form:
-- {"size": "...", "portions": [{"style_id", "ingredient_ids",
-- "extra_ingredient_ids", "extra_ids"}]}. Ingredient and extra lists are
-- sorted by the catalog order so equal pizzas always serialize equally.
-- A legacy `extra_cheese: true` adds Extra queso to `extra_ids`.
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
  v_options uuid[];
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
    v_options := public.pizza_uuid_array(v_portion -> 'extra_ids');

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
    if v_cheese is not null and jsonb_typeof(v_cheese) not in ('null', 'boolean') then
      raise exception 'La configuración de la pizza es inválida.';
    end if;

    if cardinality(v_options) <> (select count(distinct x) from unnest(v_options) as x) then
      raise exception 'Los extras de una porción no se pueden repetir.';
    end if;

    if v_cheese = 'true'::jsonb and not (public.pizza_cheese_extra_id() = any (v_options)) then
      v_options := v_options || public.pizza_cheese_extra_id();
    end if;

    if (select count(*) from public.pizza_extras where id = any (v_options) and active = true)
         <> cardinality(v_options) then
      raise exception 'Uno de los extras no existe o no está activo.';
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
      'extra_ids', (
        select coalesce(jsonb_agg(x.id order by x.sort_order, x.name), '[]'::jsonb)
        from public.pizza_extras x where x.id = any (v_options)
      )
    );
  end loop;

  return jsonb_build_object('size', v_size.code, 'portions', v_canonical);
end;
$$;

-- Prices a canonical configuration: the most expensive style for the size,
-- plus every extra ingredient and every extra charged in full per portion.
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
  v_extras integer;
  v_settings public.pizza_settings%rowtype;
begin
  select max(sp.price_cents) into v_base
  from jsonb_array_elements(p_config -> 'portions') as p
  join public.pizza_style_prices sp
    on sp.style_id = (p ->> 'style_id')::uuid and sp.size_code = p_config ->> 'size';

  if v_base is null then
    raise exception 'No hay precio para esta pizza.';
  end if;

  select coalesce(sum(jsonb_array_length(p -> 'extra_ingredient_ids')), 0)
  into v_extra_ingredients
  from jsonb_array_elements(p_config -> 'portions') as p;

  select coalesce(sum(x.price_cents), 0)
  into v_extras
  from jsonb_array_elements(p_config -> 'portions') as p
  cross join lateral jsonb_array_elements_text(coalesce(p -> 'extra_ids', '[]'::jsonb)) as e (id)
  join public.pizza_extras x on x.id = e.id::uuid;

  select * into v_settings from public.pizza_settings where id;

  return v_base
    + v_extra_ingredients * v_settings.extra_ingredient_cents
    + v_extras;
end;
$$;

-- Human-readable description of a canonical configuration, e.g.
-- 'Pizza Grande · Mitades: ½ Estilo Varas + Jalapeños + Extra queso | ½ Estilo Chuy''s'.
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

    select string_agg(x.name, ', ' order by o.ord) into v_list
    from jsonb_array_elements_text(coalesce(v_portion -> 'extra_ids', '[]'::jsonb)) with ordinality as o (id, ord)
    join public.pizza_extras x on x.id = o.id::uuid;
    if v_list is not null then
      v_desc := v_desc || ' + ' || v_list;
    end if;

    v_parts := v_parts || case when v_count > 1 then v_fraction || ' ' || v_desc else v_desc end;
  end loop;

  if v_count = 1 then
    return 'Pizza ' || v_size || ': ' || v_parts[1];
  end if;

  return 'Pizza ' || v_size || ' · ' || v_label || ': ' || array_to_string(v_parts, ' | ');
end;
$$;

revoke all on function public.validate_pizza(jsonb) from public, anon, authenticated;
revoke all on function public.price_pizza(jsonb) from public, anon, authenticated;
revoke all on function public.describe_pizza(jsonb) from public, anon, authenticated;

-- ============================================================================
-- D. Device catalog: active extras (no prices)
-- ============================================================================

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
      ),
      'extras',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('id', x.id, 'name', x.name, 'sort_order', x.sort_order)
            order by x.sort_order, x.name
          )
          from public.pizza_extras x
          where x.active = true
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;
revoke all on function public.device_list_catalog(text) from public;
grant execute on function public.device_list_catalog(text) to anon, authenticated;
