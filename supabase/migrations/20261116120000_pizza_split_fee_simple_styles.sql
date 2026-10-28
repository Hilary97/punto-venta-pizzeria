-- Split pizzas whose styles all have two or fewer ingredients pay no
-- elaboration fee (halves, thirds or quarters), e.g. ½ Hawaiana + ½ Pepperoni.
--
--   * Each style stores its fixed ingredients (pizza_styles.fixed_ingredients),
--     editable by the admin (0-20). Custom styles always store 0: for them the
--     ingredients the customer chose are counted instead.
--   * Free ingredients of the customer's choice on a special style and paid
--     extra ingredients do not count: only the style itself does.
--   * The distinct-style average and its rounding are unchanged; extras are
--     still added on top. Only new quotes change.
--
-- Runs as one script (Supabase SQL Editor).

alter table public.pizza_styles
  add column fixed_ingredients integer not null default 0
    check (fixed_ingredients between 0 and 20);

-- Seed from the description: items separated by commas or "y". A description
-- that mentions "todos" (e.g. "Todos los vegetales") or is empty counts as
-- more than two, so the fee keeps applying until the admin says otherwise.
update public.pizza_styles
set fixed_ingredients = case
  when btrim(description) = '' or description ~* '\mtodos\M' then
    greatest(3, cardinality(regexp_split_to_array(btrim(description), '\s*,\s*|\s+y\s+')))
  else least(20, cardinality(regexp_split_to_array(btrim(description), '\s*,\s*|\s+y\s+')))
end
where kind = 'special';

-- Same as 20261110120000_pizza_included_ingredients_all_styles.sql plus
-- p_fixed_ingredients: required for a new special style, null keeps the
-- stored value on update, and forced to 0 for custom styles.
drop function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb);

create function public.admin_save_pizza_style(
  p_style_id uuid,
  p_name text,
  p_description text,
  p_kind text,
  p_included_ingredients integer,
  p_sort_order integer,
  p_active boolean,
  p_prices jsonb,
  p_fixed_ingredients integer default null
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
  v_fixed integer;
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

  if p_kind = 'custom' then
    v_fixed := 0;
  elsif p_fixed_ingredients is not null then
    if p_fixed_ingredients not between 0 and 20 then
      raise exception 'Los ingredientes fijos deben estar entre 0 y 20.';
    end if;
    v_fixed := p_fixed_ingredients;
  elsif p_style_id is null then
    raise exception 'Los ingredientes fijos deben estar entre 0 y 20.';
  end if;

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
      insert into public.pizza_styles (name, description, kind, included_ingredients, fixed_ingredients, sort_order, active)
      values (v_name, v_description, p_kind, v_included, v_fixed, v_sort_order, coalesce(p_active, true))
      returning id into v_id;
    else
      update public.pizza_styles
      set name = v_name,
          description = v_description,
          kind = p_kind,
          included_ingredients = v_included,
          fixed_ingredients = coalesce(v_fixed, fixed_ingredients),
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

revoke all on function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb, integer)
  from public, anon;
grant execute on function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb, integer)
  to authenticated;

-- Same as 20261115120000_pizza_split_fee_settings.sql; the fee is skipped when
-- every portion has two or fewer ingredients.
create or replace function public.price_pizza(p_config jsonb)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_portions integer := jsonb_array_length(p_config -> 'portions');
  v_priced integer;
  v_styles integer;
  v_total integer;
  v_base integer;
  v_complex integer;
  v_extra_ingredients integer;
  v_extras integer;
  v_settings public.pizza_settings%rowtype;
begin
  select count(sp.price_cents) into v_priced
  from jsonb_array_elements(p_config -> 'portions') as p
  join public.pizza_style_prices sp
    on sp.style_id = (p ->> 'style_id')::uuid and sp.size_code = p_config ->> 'size';

  if v_portions is null or v_portions = 0 or v_priced <> v_portions then
    raise exception 'No hay precio para esta pizza.';
  end if;

  select count(*), sum(sp.price_cents) into v_styles, v_total
  from public.pizza_style_prices sp
  where sp.size_code = p_config ->> 'size'
    and sp.style_id in (
      select (p ->> 'style_id')::uuid from jsonb_array_elements(p_config -> 'portions') as p
    );

  -- Portions with more than two ingredients: the style's fixed ones, or the
  -- chosen ones for a custom style.
  select count(*) into v_complex
  from jsonb_array_elements(p_config -> 'portions') as p
  join public.pizza_styles s on s.id = (p ->> 'style_id')::uuid
  where case
    when s.kind = 'custom' then coalesce(jsonb_array_length(p -> 'ingredient_ids'), 0)
    else s.fixed_ingredients
  end > 2;

  select * into v_settings from public.pizza_settings where id;

  if v_styles = 1 then
    v_base := v_total;
  else
    v_base := ceil(v_total::numeric / v_styles / 1000) * 1000 + case
      when v_complex = 0 then 0
      when v_portions = 2 then v_settings.split_halves_fee_cents
      when v_portions = 3 then v_settings.split_thirds_fee_cents
      else v_settings.split_quarters_fee_cents
    end;
  end if;

  select coalesce(sum(jsonb_array_length(p -> 'extra_ingredient_ids')), 0)
  into v_extra_ingredients
  from jsonb_array_elements(p_config -> 'portions') as p;

  select coalesce(sum(x.price_cents), 0)
  into v_extras
  from jsonb_array_elements_text(coalesce(p_config -> 'extra_ids', '[]'::jsonb)) as e (id)
  join public.pizza_extras x on x.id = e.id::uuid;

  return v_base
    + v_extra_ingredients * v_settings.extra_ingredient_cents
    + v_extras;
end;
$$;

revoke all on function public.price_pizza(jsonb) from public, anon, authenticated;
