-- An included ingredient can be ordered double ("doble"): the portion keeps it
-- in ingredient_ids and adds it once to extra_ingredient_ids, so validate_pizza
-- and price_pizza already accept and charge it as one extra ingredient.
--
--   * describe_pizza shows such an ingredient as "Extra <ingrediente>" inside
--     the included list and does not repeat it after "+", e.g.
--     "Pizza Chica: Arma tu combinación (Pepperoni, Extra Jalapeños)".
--   * Further occurrences of that extra keep listing after "+" as before.
--   * Stored order lines are not rewritten. Only new quotes change.
--
-- Runs as one script (Supabase SQL Editor).

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

    -- An included ingredient that is also an extra is doubled: "Extra <name>".
    select string_agg(
             case when coalesce(v_portion -> 'extra_ingredient_ids', '[]'::jsonb) ? o.id
                  then 'Extra ' || i.name else i.name end,
             ', ' order by o.ord) into v_list
    from jsonb_array_elements_text(v_portion -> 'ingredient_ids') with ordinality as o (id, ord)
    join public.pizza_ingredients i on i.id = o.id::uuid;
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
