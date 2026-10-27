-- Split pizzas with different styles round their average up to the next
-- multiple of $10 (1000 cents): $233.33 -> $240, $241 -> $250.
--
--   * Same distinct-style average as 20261111120000.
--   * A whole pizza and a split of a single style keep their exact price.
--   * Extra ingredients and extras are added on top, unrounded.
--   * Only new quotes change: stored sale lines keep their price.

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

  if v_styles = 1 then
    v_base := v_total;
  else
    v_base := ceil(v_total::numeric / v_styles / 1000) * 1000;
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
