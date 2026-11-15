-- Each portion (mitad, tercio, cuarto) of a built pizza can carry its own note.
--
--   * A portion carries an optional "note". validate_pizza trims it, drops it when blank and rejects
--     one longer than 80 characters ("La nota de cada porción admite hasta 80 caracteres."). Pizzas
--     stored without notes stay valid. The note does not change the price.
--   * describe_pizza puts the note right after its portion: "½ Estilo Hawaiana — sin piña en la orilla".
--     That text is the stored line name, so kitchen, delivery and receipts show it under the portion.
--   * Más vendidas (popular_picks, popular_pizzas) and the fixed quick pizzas ignore portion notes:
--     they are stripped before grouping and never returned or stored.
--   * Stored order lines are not rewritten.
--
-- Runs as one script (Supabase SQL Editor).

-- The note of a portion, or null when it is absent or blank.
create or replace function public.pizza_portion_note(p_portion jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_note text;
begin
  if not (p_portion ? 'note') or jsonb_typeof(p_portion -> 'note') = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_portion -> 'note') <> 'string' then
    raise exception 'La configuración de la pizza es inválida.';
  end if;
  v_note := nullif(btrim(p_portion ->> 'note', E' \t\r\n'), '');
  if char_length(v_note) > 80 then
    raise exception 'La nota de cada porción admite hasta 80 caracteres.';
  end if;
  return v_note;
end;
$$;

-- A pizza config without the note of any portion.
create or replace function public.pizza_strip_portion_notes(p_config jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
           when jsonb_typeof(p_config -> 'portions') = 'array' then
             jsonb_set(
               p_config,
               '{portions}',
               coalesce(
                 (select jsonb_agg(p - 'note' order by o.ord)
                  from jsonb_array_elements(p_config -> 'portions') with ordinality as o (p, ord)
                  where jsonb_typeof(o.p) = 'object'),
                 '[]'::jsonb
               )
             )
           else p_config
         end;
$$;

revoke all on function public.pizza_portion_note(jsonb) from public, anon, authenticated;
revoke all on function public.pizza_strip_portion_notes(jsonb) from public, anon, authenticated;

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
  v_chiles text[];
  v_note text;
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

    -- Estilo Mexicana may pick one or two chiles; none keeps its 3 chiles.
    v_chiles := public.pizza_portion_chiles(v_portion);
    if cardinality(v_chiles) > 0 then
      if not public.pizza_style_has_chiles(v_style.name) then
        raise exception 'Solo el Estilo Mexicana permite elegir chile.';
      end if;
      if exists (select 1 from unnest(v_chiles) as c where c is null or c not in ('morron', 'serrano', 'jalapeno'))
         or cardinality(v_chiles) <> (select count(distinct c) from unnest(v_chiles) as c) then
        raise exception 'El chile elegido no es válido.';
      end if;
      if cardinality(v_chiles) > 2 then
        raise exception 'Elige uno o dos chiles, o los 3 chiles.';
      end if;
    end if;

    -- Optional note of the portion: trimmed, dropped when blank, at most 80 characters.
    v_note := public.pizza_portion_note(v_portion);

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

    v_canonical := v_canonical || (jsonb_build_object(
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
    ) || case when cardinality(v_chiles) = 0 then '{}'::jsonb
              else jsonb_build_object('chiles', public.pizza_chiles_sorted(v_chiles)) end
      || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end);
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
revoke all on function public.validate_pizza(jsonb) from public, anon, authenticated;

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
  v_style_name text;
  v_chile text;
  v_list text;
  v_note text;
  v_extras text;
  v_parts text[] := '{}';
begin
  select name into v_size from public.pizza_sizes where code = p_config ->> 'size';

  v_label := case v_count when 2 then 'Mitades' when 3 then 'Tercios' when 4 then 'Cuartos' end;
  v_fraction := case v_count when 2 then '½' when 3 then '⅓' when 4 then '¼' end;

  for v_portion in select * from jsonb_array_elements(p_config -> 'portions')
  loop
    select name into v_style_name from public.pizza_styles where id = (v_portion ->> 'style_id')::uuid;
    v_desc := v_style_name;

    -- An included ingredient that is also an extra is doubled: "Extra <name>".
    select string_agg(
             case when coalesce(v_portion -> 'extra_ingredient_ids', '[]'::jsonb) ? o.id
                  then 'Extra ' || i.name else i.name end,
             ', ' order by o.ord) into v_list
    from jsonb_array_elements_text(v_portion -> 'ingredient_ids') with ordinality as o (id, ord)
    join public.pizza_ingredients i on i.id = o.id::uuid;

    -- Estilo Mexicana ends its included list with its chile.
    if public.pizza_style_has_chiles(v_style_name) then
      v_chile := public.pizza_chiles_label(public.pizza_portion_chiles(v_portion));
      v_list := coalesce(v_list || ', ', '') || v_chile;
    end if;
    if v_list is not null then
      v_desc := v_desc || ' (' || v_list || ')';
    end if;

    -- Each extra ingredient once, in first-seen order; a doubled one reads "Extra <name>".
    -- An included ingredient already took one of its extras above.
    select string_agg(case when e.times > 1 then 'Extra ' || i.name else i.name end, ', ' order by e.ord) into v_list
    from (
      select o.id, min(o.ord) as ord,
             count(*) - case when coalesce(v_portion -> 'ingredient_ids', '[]'::jsonb) ? o.id then 1 else 0 end as times
      from jsonb_array_elements_text(v_portion -> 'extra_ingredient_ids') with ordinality as o (id, ord)
      group by o.id
    ) as e
    join public.pizza_ingredients i on i.id = e.id::uuid
    where e.times > 0;
    if v_list is not null then
      v_desc := v_desc || ' + ' || v_list;
    end if;

    -- The portion note follows its portion; a "|" would read as a portion separator.
    v_note := nullif(btrim(v_portion ->> 'note', E' \t\r\n'), '');
    if v_note is not null then
      v_desc := v_desc || ' — ' || replace(v_note, '|', '/');
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
revoke all on function public.describe_pizza(jsonb) from public, anon, authenticated;

-- Fixed quick pizzas never keep portion notes.
create or replace function public.admin_list_quick_pizzas()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.pizza_quick_picks;
  v_available boolean;
  v_result jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede editar las pizzas.';
  end if;

  for v_row in select * from public.pizza_quick_picks order by sort_order, created_at loop
    begin
      perform public.validate_pizza(v_row.pizza);
      v_available := true;
    exception when others then
      v_available := false;
    end;
    v_result := v_result || jsonb_build_array(
      jsonb_build_object('id', v_row.id, 'pizza', public.pizza_strip_portion_notes(v_row.pizza), 'available', v_available)
    );
  end loop;
  return v_result;
end;
$$;

create or replace function public.admin_add_quick_pizza(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede editar las pizzas.';
  end if;

  v_config := public.pizza_strip_portion_notes(public.validate_pizza(p_config));

  -- Serializes concurrent adds so the limit and the order hold.
  perform pg_advisory_xact_lock(hashtext('public.pizza_quick_picks'));

  if exists (select 1 from public.pizza_quick_picks where pizza = v_config) then
    raise exception 'Esa pizza ya está en la lista.';
  end if;
  if (select count(*) from public.pizza_quick_picks) >= 8 then
    raise exception 'Puedes fijar hasta 8 pizzas rápidas.';
  end if;

  insert into public.pizza_quick_picks (pizza, sort_order)
  values (v_config, coalesce((select max(sort_order) from public.pizza_quick_picks), 0) + 1)
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

-- Best sellers ignore portion notes: pizzas that differ only by them are one.
create or replace function public.popular_picks(p_limit integer default 16)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_config jsonb;
  v_key text;
  v_fixed jsonb := '[]'::jsonb;
  v_fixed_keys text[] := '{}';
  v_acc jsonb := '{}'::jsonb;
  v_left integer;
begin
  for v_row in select pizza from public.pizza_quick_picks order by sort_order, created_at loop
    begin
      v_config := public.pizza_strip_portion_notes(public.validate_pizza(v_row.pizza));
    exception when others then
      continue;
    end;
    if not public.pizza_size_has_dough(v_config ->> 'size') then
      continue;
    end if;
    if not (v_config::text = any (v_fixed_keys)) then
      v_fixed_keys := v_fixed_keys || v_config::text;
      v_fixed := v_fixed || jsonb_build_array(jsonb_build_object('kind', 'pizza', 'pizza', v_config, 'sold', null));
    end if;
  end loop;

  v_left := p_limit - jsonb_array_length(v_fixed);
  if v_left <= 0 then
    return v_fixed;
  end if;

  -- Pizzas: grouped by their canonical config, so legacy stored shapes merge.
  for v_row in
    select oi.pizza, sum(oi.quantity)::integer as sold, max(o.paid_at) as last_paid_at
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.status = 'paid'
      and o.paid_at >= now() - interval '30 days'
      and oi.item_type = 'pizza'
      and oi.pizza is not null
    group by oi.pizza
  loop
    begin
      v_config := public.pizza_strip_portion_notes(public.validate_pizza(v_row.pizza));
    exception when others then
      continue;
    end;

    if not public.pizza_size_has_dough(v_config ->> 'size') then
      continue;
    end if;

    v_key := 'pizza:' || v_config::text;
    if v_config::text = any (v_fixed_keys) then
      continue;
    end if;
    if v_acc ? v_key then
      v_acc := jsonb_set(
        v_acc,
        array[v_key],
        jsonb_build_object(
          'item', jsonb_build_object('kind', 'pizza', 'pizza', v_config),
          'sold', (v_acc -> v_key ->> 'sold')::integer + v_row.sold,
          'last_paid_at', greatest((v_acc -> v_key ->> 'last_paid_at')::timestamptz, v_row.last_paid_at)
        )
      );
    else
      v_acc := v_acc || jsonb_build_object(
        v_key,
        jsonb_build_object(
          'item', jsonb_build_object('kind', 'pizza', 'pizza', v_config),
          'sold', v_row.sold,
          'last_paid_at', v_row.last_paid_at
        )
      );
    end if;
  end loop;

  -- Products: one entry per product and its current spelling of the variant.
  v_acc := v_acc || coalesce(
    (
      select jsonb_object_agg(
        'product:' || s.product_id::text || ':' || coalesce(s.variant, ''),
        jsonb_build_object(
          'item', jsonb_build_object('kind', 'product', 'product_id', s.product_id, 'variant', s.variant),
          'sold', s.sold,
          'last_paid_at', s.last_paid_at
        )
      )
      from (
        select l.product_id, l.variant, sum(l.quantity)::integer as sold, max(l.paid_at) as last_paid_at
        from (
          select p.id as product_id,
                 case
                   when coalesce(cardinality(p.variants), 0) = 0 then null
                   else (select v from unnest(p.variants) v where lower(v) = lower(oi.variant) limit 1)
                 end as variant,
                 coalesce(cardinality(p.variants), 0) > 0 as has_variants,
                 oi.quantity,
                 o.paid_at
          from public.order_items oi
          join public.orders o on o.id = oi.order_id
          join public.products p on p.id = oi.product_id
          join public.categories c on c.id = p.category_id
          where o.status = 'paid'
            and o.paid_at >= now() - interval '30 days'
            and oi.item_type = 'product'
            and p.active
            and not coalesce(c.legacy_pizza, false)
            and not (coalesce(p.track_stock, false) and coalesce(p.stock, 0) <= 0)
        ) l
        where not l.has_variants or l.variant is not null
        group by l.product_id, l.variant
      ) s
    ),
    '{}'::jsonb
  );

  return v_fixed || coalesce(
    (
      select jsonb_agg((t.value -> 'item') || jsonb_build_object('sold', (t.value ->> 'sold')::integer) order by t.ord)
      from (
        select e.value,
               row_number() over (
                 order by (e.value ->> 'sold')::integer desc, (e.value ->> 'last_paid_at')::timestamptz desc, e.key
               ) as ord
        from jsonb_each(v_acc) e
      ) t
      where t.ord <= v_left
    ),
    '[]'::jsonb
  );
end;
$$;
revoke all on function public.popular_picks(integer) from public, anon, authenticated;

create or replace function public.popular_pizzas(p_limit integer default 4)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_config jsonb;
  v_key text;
  v_fixed jsonb := '[]'::jsonb;
  v_fixed_keys text[] := '{}';
  v_acc jsonb := '{}'::jsonb;
  v_left integer;
begin
  for v_row in select pizza from public.pizza_quick_picks order by sort_order, created_at loop
    begin
      v_config := public.pizza_strip_portion_notes(public.validate_pizza(v_row.pizza));
    exception when others then
      continue;
    end;
    if not (v_config::text = any (v_fixed_keys)) then
      v_fixed_keys := v_fixed_keys || v_config::text;
      v_fixed := v_fixed || jsonb_build_array(jsonb_build_object('pizza', v_config, 'sold', null));
    end if;
  end loop;

  v_left := p_limit - jsonb_array_length(v_fixed);
  if v_left <= 0 then
    return v_fixed;
  end if;

  for v_row in
    select oi.pizza, sum(oi.quantity)::integer as sold, max(o.paid_at) as last_paid_at
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.status = 'paid'
      and o.paid_at >= now() - interval '30 days'
      and oi.item_type = 'pizza'
      and oi.pizza is not null
    group by oi.pizza
  loop
    begin
      v_config := public.pizza_strip_portion_notes(public.validate_pizza(v_row.pizza));
    exception when others then
      continue;
    end;

    v_key := v_config::text;
    if v_key = any (v_fixed_keys) then
      continue;
    end if;
    if v_acc ? v_key then
      v_acc := jsonb_set(
        v_acc,
        array[v_key],
        jsonb_build_object(
          'pizza', v_config,
          'sold', (v_acc -> v_key ->> 'sold')::integer + v_row.sold,
          'last_paid_at', greatest((v_acc -> v_key ->> 'last_paid_at')::timestamptz, v_row.last_paid_at)
        )
      );
    else
      v_acc := v_acc || jsonb_build_object(
        v_key,
        jsonb_build_object('pizza', v_config, 'sold', v_row.sold, 'last_paid_at', v_row.last_paid_at)
      );
    end if;
  end loop;

  return v_fixed || coalesce(
    (
      select jsonb_agg(jsonb_build_object('pizza', t.value -> 'pizza', 'sold', (t.value ->> 'sold')::integer) order by t.ord)
      from (
        select e.value,
               row_number() over (
                 order by (e.value ->> 'sold')::integer desc, (e.value ->> 'last_paid_at')::timestamptz desc
               ) as ord
        from jsonb_each(v_acc) e
      ) t
      where t.ord <= v_left
    ),
    '[]'::jsonb
  );
end;
$$;
revoke all on function public.popular_pizzas(integer) from public, anon, authenticated;
