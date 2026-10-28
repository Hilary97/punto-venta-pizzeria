-- The split elaboration fee becomes three admin-editable amounts in
-- pizza_settings instead of the hardcoded $10 per extra portion of
-- 20261114120000. Defaults keep today's prices: halves $10, thirds $20,
-- quarters $30. A fee may be $0; the existing pizza_settings RLS lets only
-- admins change it.
--
--   * Same rule otherwise: distinct-style average rounded up to the next $10,
--     whole pizzas and single-style splits pay no fee, extras on top.
--   * Only new quotes change: stored sale lines keep their price.

alter table public.pizza_settings
  add column split_halves_fee_cents integer not null default 1000
    check (split_halves_fee_cents between 0 and 10000000),
  add column split_thirds_fee_cents integer not null default 2000
    check (split_thirds_fee_cents between 0 and 10000000),
  add column split_quarters_fee_cents integer not null default 3000
    check (split_quarters_fee_cents between 0 and 10000000);

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

  select * into v_settings from public.pizza_settings where id;

  if v_styles = 1 then
    v_base := v_total;
  else
    v_base := ceil(v_total::numeric / v_styles / 1000) * 1000 + case v_portions
      when 2 then v_settings.split_halves_fee_cents
      when 3 then v_settings.split_thirds_fee_cents
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
