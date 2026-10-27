-- Every pizza style includes 2 ingredients of the customer's choice per
-- portion in its price, special styles too (a Hawaiana can add Jalapeños and
-- Ajo at no cost). From the third one on they are charged as extra
-- ingredients, unchanged.
--
--   * Every style is set to 2 included ingredients; the admin can still
--     change it per style (special: 0-4, custom: 1-4).
--   * Special styles may leave their included ingredients empty; custom
--     styles still need at least one.
--   * Prices and descriptions need no change: included ingredients are free
--     and already listed in parentheses.
--
-- Runs as one script (Supabase SQL Editor).

update public.pizza_styles set included_ingredients = 2 where included_ingredients <> 2;

-- Validates a pizza configuration and returns its canonical form (see
-- 20261108120000_pizza_wide_extras.sql); only the included ingredient rule
-- changes.

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
  v_legacy uuid[];
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

  v_options := public.pizza_uuid_array(p_config -> 'extra_ids');
  if cardinality(v_options) <> (select count(distinct x) from unnest(v_options) as x) then
    raise exception 'Los extras de la pizza no se pueden repetir.';
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

    -- Included ingredients are optional on a special style, which already
    -- has its own; a custom style needs at least one.
    if v_style.kind = 'custom' and cardinality(v_ingredients) = 0 then
      raise exception 'Elige al menos un ingrediente para %.', v_style.name;
    end if;
    if cardinality(v_ingredients) > v_style.included_ingredients then
      raise exception '% incluye hasta % ingredientes.', v_style.name, v_style.included_ingredients;
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

    -- Legacy per-portion extras move to the pizza, once each.
    v_cheese := v_portion -> 'extra_cheese';
    if v_cheese is not null and jsonb_typeof(v_cheese) not in ('null', 'boolean') then
      raise exception 'La configuración de la pizza es inválida.';
    end if;

    v_legacy := public.pizza_uuid_array(v_portion -> 'extra_ids');
    if v_cheese = 'true'::jsonb then
      v_legacy := v_legacy || public.pizza_cheese_extra_id();
    end if;
    v_options := v_options || array(
      select distinct x from unnest(v_legacy) as x where not (x = any (v_options))
    );

    v_canonical := v_canonical || jsonb_build_object(
      'style_id', v_style.id,
      'ingredient_ids', (
        select coalesce(jsonb_agg(i.id order by i.sort_order, i.name), '[]'::jsonb)
        from public.pizza_ingredients i where i.id = any (v_ingredients)
      ),
      'extra_ingredient_ids', (
        select coalesce(jsonb_agg(i.id order by i.sort_order, i.name), '[]'::jsonb)
        from public.pizza_ingredients i where i.id = any (v_extras)
      )
    );
  end loop;

  if (select count(*) from public.pizza_extras where id = any (v_options) and active = true)
       <> cardinality(v_options) then
    raise exception 'Uno de los extras no existe o no está activo.';
  end if;

  return jsonb_build_object(
    'size', v_size.code,
    'portions', v_canonical,
    'extra_ids', (
      select coalesce(jsonb_agg(x.id order by x.sort_order, x.name), '[]'::jsonb)
      from public.pizza_extras x where x.id = any (v_options)
    )
  );
end;
$$;

-- Creates (p_style_id null) or updates a style and sets its price for every
-- size. Special styles take 0-4 included ingredients, custom ones 1-4.
create or replace function public.admin_save_pizza_style(
  p_style_id uuid,
  p_name text,
  p_description text,
  p_kind text,
  p_included_ingredients integer,
  p_sort_order integer,
  p_active boolean,
  p_prices jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_included integer;
  v_sort_order integer := coalesce(p_sort_order, 0);
  v_size public.pizza_sizes%rowtype;
  v_price jsonb;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede editar las pizzas.';
  end if;

  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'El nombre del estilo debe tener entre 1 y 80 caracteres.';
  end if;
  if length(v_description) > 300 then
    raise exception 'La descripción del estilo es demasiado larga.';
  end if;
  if p_kind is null or p_kind not in ('special', 'custom') then
    raise exception 'El tipo de estilo no es válido.';
  end if;

  if p_kind = 'special' and (p_included_ingredients is null or p_included_ingredients not between 0 and 4) then
    raise exception 'Los ingredientes incluidos deben estar entre 0 y 4.';
  elsif p_kind = 'custom' and (p_included_ingredients is null or p_included_ingredients not between 1 and 4) then
    raise exception 'Los ingredientes incluidos deben estar entre 1 y 4.';
  end if;
  v_included := p_included_ingredients;

  if v_sort_order not between 0 and 10000 then
    raise exception 'El orden no es válido.';
  end if;

  -- Sizes are checked in display order so the message names the first wrong one.
  for v_size in select * from public.pizza_sizes order by sort_order, code
  loop
    v_price := case when jsonb_typeof(p_prices) = 'object' then p_prices -> v_size.code end;
    if v_price is null
       or jsonb_typeof(v_price) <> 'number'
       or v_price::numeric <> trunc(v_price::numeric)
       or v_price::numeric not between 1 and 10000000 then
      raise exception 'El precio de % no es válido.', v_size.name;
    end if;
  end loop;

  begin
    if p_style_id is null then
      insert into public.pizza_styles (name, description, kind, included_ingredients, sort_order, active)
      values (v_name, v_description, p_kind, v_included, v_sort_order, coalesce(p_active, true))
      returning id into v_id;
    else
      update public.pizza_styles
      set name = v_name,
          description = v_description,
          kind = p_kind,
          included_ingredients = v_included,
          sort_order = v_sort_order,
          active = coalesce(p_active, active)
      where id = p_style_id
      returning id into v_id;

      if v_id is null then
        raise exception 'El estilo no existe.';
      end if;
    end if;
  exception
    when unique_violation then
      raise exception 'Ya existe un estilo con ese nombre.';
  end;

  insert into public.pizza_style_prices (style_id, size_code, price_cents)
  select v_id, s.code, (p_prices ->> s.code)::numeric::integer
  from public.pizza_sizes s
  on conflict (style_id, size_code) do update set price_cents = excluded.price_cents;

  return jsonb_build_object('style_id', v_id);
end;
$$;

revoke all on function public.validate_pizza(jsonb) from public, anon, authenticated;
revoke all on function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb)
  from public, anon;
grant execute on function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb)
  to authenticated;
