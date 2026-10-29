-- The split elaboration fee (halves, thirds or quarters) is set per style by
-- the admin. This replaces the global fees of 20261115120000 and the
-- "Cobra elaboración" mark of 20261117120000.
--
--   * pizza_styles.split_{halves,thirds,quarters}_fee_cents, $0 to $100,000.
--     $0 means the style charges nothing for that split.
--   * A split pizza with different styles pays one fee: the highest among its
--     styles for its number of portions.
--   * Seeded from the current rule so no price changes when this runs: a
--     marked style gets the current global fees, the rest $0.
--   * pizza_settings.split_*_fee_cents and pizza_styles.charges_elaboration
--     are kept but no longer used for pricing.
--   * The distinct-style average, its rounding, whole and single-style pizzas
--     and extras are unchanged. Only new quotes change.
--
-- Runs as one script (Supabase SQL Editor).

alter table public.pizza_styles
  add column split_halves_fee_cents integer not null default 0
    check (split_halves_fee_cents between 0 and 10000000),
  add column split_thirds_fee_cents integer not null default 0
    check (split_thirds_fee_cents between 0 and 10000000),
  add column split_quarters_fee_cents integer not null default 0
    check (split_quarters_fee_cents between 0 and 10000000);

update public.pizza_styles s
set split_halves_fee_cents = ps.split_halves_fee_cents,
    split_thirds_fee_cents = ps.split_thirds_fee_cents,
    split_quarters_fee_cents = ps.split_quarters_fee_cents
from public.pizza_settings ps
where ps.id and s.charges_elaboration;

-- Same as 20261117120000_pizza_style_elaboration_flag.sql with p_split_fees
-- ({"halves", "thirds", "quarters"} in cents) instead of p_charges_elaboration.
drop function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb, boolean);

create function public.admin_save_pizza_style(
  p_style_id uuid,
  p_name text,
  p_description text,
  p_kind text,
  p_included_ingredients integer,
  p_sort_order integer,
  p_active boolean,
  p_prices jsonb,
  p_split_fees jsonb default null
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
  v_fee_key text;
  v_fee jsonb;
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

  -- Null keeps the stored fees on update and gives a new style $0 fees.
  if p_split_fees is not null then
    foreach v_fee_key in array array['halves', 'thirds', 'quarters']
    loop
      v_fee := case when jsonb_typeof(p_split_fees) = 'object' then p_split_fees -> v_fee_key end;
      if v_fee is null
         or jsonb_typeof(v_fee) <> 'number'
         or v_fee::numeric <> trunc(v_fee::numeric)
         or v_fee::numeric not between 0 and 10000000 then
        raise exception 'El cargo por elaboración de % no es válido.',
          case v_fee_key when 'halves' then 'Mitades' when 'thirds' then 'Tercios' else 'Cuartos' end;
      end if;
    end loop;
  end if;

  begin
    if p_style_id is null then
      insert into public.pizza_styles (
        name, description, kind, included_ingredients, sort_order, active,
        split_halves_fee_cents, split_thirds_fee_cents, split_quarters_fee_cents
      )
      values (
        v_name, v_description, p_kind, v_included, v_sort_order, coalesce(p_active, true),
        coalesce((p_split_fees ->> 'halves')::numeric::integer, 0),
        coalesce((p_split_fees ->> 'thirds')::numeric::integer, 0),
        coalesce((p_split_fees ->> 'quarters')::numeric::integer, 0)
      )
      returning id into v_id;
    else
      update public.pizza_styles
      set name = v_name,
          description = v_description,
          kind = p_kind,
          included_ingredients = v_included,
          split_halves_fee_cents = coalesce((p_split_fees ->> 'halves')::numeric::integer, split_halves_fee_cents),
          split_thirds_fee_cents = coalesce((p_split_fees ->> 'thirds')::numeric::integer, split_thirds_fee_cents),
          split_quarters_fee_cents = coalesce((p_split_fees ->> 'quarters')::numeric::integer, split_quarters_fee_cents),
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

revoke all on function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb, jsonb)
  from public, anon;
grant execute on function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb, jsonb)
  to authenticated;

-- Same as 20261117120000_pizza_style_elaboration_flag.sql; the fee comes from
-- the styles instead of pizza_settings.
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
  v_fee integer;
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

  -- One elaboration fee per pizza: the highest of its styles for this many portions.
  select coalesce(max(case
           when v_portions = 2 then s.split_halves_fee_cents
           when v_portions = 3 then s.split_thirds_fee_cents
           else s.split_quarters_fee_cents
         end), 0)
  into v_fee
  from public.pizza_styles s
  where s.id in (
    select (p ->> 'style_id')::uuid from jsonb_array_elements(p_config -> 'portions') as p
  );

  select * into v_settings from public.pizza_settings where id;

  if v_styles = 1 then
    v_base := v_total;
  else
    v_base := ceil(v_total::numeric / v_styles / 1000) * 1000 + v_fee;
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
