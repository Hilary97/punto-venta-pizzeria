-- The split elaboration fee (halves, thirds or quarters) is charged only when
-- a portion's style is marked "Cobra elaboración" by the admin. This replaces
-- the "more than two ingredients" rule of 20261116120000.
--
--   * pizza_styles.charges_elaboration, editable per style from the admin.
--   * Seeded from the old rule so no price changes when this runs: a special
--     style with more than two fixed ingredients, or a custom style that
--     includes more than two ingredients of the customer's choice.
--   * The ingredients the customer chooses no longer matter for the fee.
--   * pizza_styles.fixed_ingredients is kept but no longer used for pricing.
--   * The distinct-style average, its rounding, whole and single-style pizzas
--     and extras are unchanged. Only new quotes change.
--
-- Runs as one script (Supabase SQL Editor).

alter table public.pizza_styles
  add column charges_elaboration boolean not null default true;

update public.pizza_styles
set charges_elaboration = case
  when kind = 'custom' then included_ingredients > 2
  else fixed_ingredients > 2
end;

-- Same as 20261116120000_pizza_split_fee_simple_styles.sql with
-- p_charges_elaboration instead of p_fixed_ingredients: null keeps the stored
-- value on update and marks a new style.
drop function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb, integer);

create function public.admin_save_pizza_style(
  p_style_id uuid,
  p_name text,
  p_description text,
  p_kind text,
  p_included_ingredients integer,
  p_sort_order integer,
  p_active boolean,
  p_prices jsonb,
  p_charges_elaboration boolean default null
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
      insert into public.pizza_styles (name, description, kind, included_ingredients, charges_elaboration, sort_order, active)
      values (v_name, v_description, p_kind, v_included, coalesce(p_charges_elaboration, true), v_sort_order, coalesce(p_active, true))
      returning id into v_id;
    else
      update public.pizza_styles
      set name = v_name,
          description = v_description,
          kind = p_kind,
          included_ingredients = v_included,
          charges_elaboration = coalesce(p_charges_elaboration, charges_elaboration),
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

revoke all on function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb, boolean)
  from public, anon;
grant execute on function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb, boolean)
  to authenticated;

-- Same as 20261116120000_pizza_split_fee_simple_styles.sql; the fee depends on
-- the styles' mark instead of their ingredients.
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

  -- Portions whose style the admin marked as charging the elaboration fee.
  select count(*) into v_complex
  from jsonb_array_elements(p_config -> 'portions') as p
  join public.pizza_styles s on s.id = (p ->> 'style_id')::uuid
  where s.charges_elaboration;

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
