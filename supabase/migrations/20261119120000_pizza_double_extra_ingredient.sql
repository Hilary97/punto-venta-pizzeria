-- An extra ingredient can be ordered twice on the same portion ("doble extra").
--
--   * extra_ingredient_ids may repeat an ingredient at most twice; three or
--     more is rejected. Included ingredients still cannot repeat.
--   * The canonical config keeps the repeat, in catalog order, so price_pizza
--     (which counts array elements) charges the extra ingredient twice.
--   * describe_pizza lists each extra ingredient once; a doubled one reads
--     "Extra <ingrediente>", e.g. "Pizza Chica: Estilo Varas + Extra Jalapeños".
--   * Stored order lines are not rewritten. Only new quotes change.
--
-- Runs as one script (Supabase SQL Editor).

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

    if cardinality(v_ingredients) <> (select count(distinct x) from unnest(v_ingredients) as x) then
      raise exception 'Los ingredientes de una porción no se pueden repetir.';
    end if;

    -- An extra ingredient may be doubled, never more.
    if exists (select 1 from unnest(v_extras) as x group by x having count(*) > 2) then
      raise exception 'Un ingrediente extra se puede pedir hasta 2 veces por porción.';
    end if;

    if (select count(*) from public.pizza_ingredients where id = any (v_ingredients) and active = true)
         <> cardinality(v_ingredients)
       or (select count(*) from public.pizza_ingredients where id = any (v_extras) and active = true)
         <> (select count(distinct x) from unnest(v_extras) as x) then
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
        from unnest(v_extras) as e (id)
        join public.pizza_ingredients i on i.id = e.id
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
  v_extras text;
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

    -- Each extra ingredient once, in first-seen order; a doubled one reads "Extra <name>".
    select string_agg(case when e.times > 1 then 'Extra ' || i.name else i.name end, ', ' order by e.ord) into v_list
    from (
      select o.id, min(o.ord) as ord, count(*) as times
      from jsonb_array_elements_text(v_portion -> 'extra_ingredient_ids') with ordinality as o (id, ord)
      group by o.id
    ) as e
    join public.pizza_ingredients i on i.id = e.id::uuid;
    if v_list is not null then
      v_desc := v_desc || ' + ' || v_list;
    end if;

    v_parts := v_parts || case when v_count > 1 then v_fraction || ' ' || v_desc else v_desc end;
  end loop;

  select string_agg(x.name, ', ' order by o.ord) into v_extras
  from jsonb_array_elements_text(coalesce(p_config -> 'extra_ids', '[]'::jsonb)) with ordinality as o (id, ord)
  join public.pizza_extras x on x.id = o.id::uuid;

  if v_count = 1 then
    return 'Pizza ' || v_size || ': ' || v_parts[1] || coalesce(' + ' || v_extras, '');
  end if;

  return 'Pizza ' || v_size || ' · ' || v_label || ': ' || array_to_string(v_parts, ' | ')
    || coalesce(' · Extras: ' || v_extras, '');
end;
$$;

revoke all on function public.validate_pizza(jsonb) from public, anon, authenticated;
revoke all on function public.describe_pizza(jsonb) from public, anon, authenticated;
