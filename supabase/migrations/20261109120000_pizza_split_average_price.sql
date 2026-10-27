-- Split pizzas (mitades, tercios, cuartos) are charged the average price of
-- their portions instead of the most expensive style.
--
--   * Every portion weighs the same: ⅓ Varas + ⅓ Varas + ⅓ Chuy's averages
--     Varas twice.
--   * An inexact average is rounded up to the whole peso (24333.33 cents ->
--     24400), so the register never charges less than the average.
--   * A whole pizza keeps its exact style price, centavos included.
--   * Extra ingredients (per portion) and extras (once per pizza) are still
--     added on top of the base, unchanged.
--   * Only new quotes change: stored sale lines keep the price they were
--     charged at.

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
  v_total integer;
  v_base integer;
  v_extra_ingredients integer;
  v_extras integer;
  v_settings public.pizza_settings%rowtype;
begin
  select count(sp.price_cents), sum(sp.price_cents) into v_priced, v_total
  from jsonb_array_elements(p_config -> 'portions') as p
  join public.pizza_style_prices sp
    on sp.style_id = (p ->> 'style_id')::uuid and sp.size_code = p_config ->> 'size';

  if v_portions is null or v_portions = 0 or v_priced <> v_portions then
    raise exception 'No hay precio para esta pizza.';
  end if;

  if v_portions = 1 then
    v_base := v_total;
  else
    v_base := ceil(v_total::numeric / v_portions / 100) * 100;
  end if;

  select coalesce(sum(jsonb_array_length(p -> 'extra_ingredient_ids')), 0)
  into v_extra_ingredients
  from jsonb_array_elements(p_config -> 'portions') as p;

  select coalesce(sum(x.price_cents), 0)
  into v_extras
  from jsonb_array_elements_text(coalesce(p_config -> 'extra_ids', '[]'::jsonb)) as e (id)
  join public.pizza_extras x on x.id = e.id::uuid;

  select * into v_settings from public.pizza_settings where id;

  return v_base
    + v_extra_ingredients * v_settings.extra_ingredient_cents
    + v_extras;
end;
$$;

revoke all on function public.price_pizza(jsonb) from public, anon, authenticated;
