-- Admin editing of the pizza builder catalog.
-- Sizes, ingredients and settings are written directly through the existing
-- admin RLS policies; a style and its prices are saved together through
-- admin_save_pizza_style so a style never ends up without a price per size.

alter table public.pizza_sizes
  add constraint pizza_sizes_allowed_portions_check
    check (cardinality(allowed_portions) > 0 and allowed_portions <@ array[1, 2, 3, 4]),
  add constraint pizza_sizes_name_check check (btrim(name) <> '');

alter table public.pizza_ingredients
  add constraint pizza_ingredients_name_check check (btrim(name) <> '');

-- Creates (p_style_id null) or updates a style and sets its price for every
-- size. p_prices is an object of cents keyed by size code, e.g.
-- {"chica": 11000, "mediana": 19000, "grande": 21000}. Special styles always
-- store 0 included ingredients; custom ones need 1-4. Returns {style_id}.
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

  if p_kind = 'special' then
    v_included := 0;
  elsif p_included_ingredients is null or p_included_ingredients not between 1 and 4 then
    raise exception 'Los ingredientes incluidos deben estar entre 1 y 4.';
  else
    v_included := p_included_ingredients;
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

revoke all on function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb)
  from public, anon;
grant execute on function public.admin_save_pizza_style(uuid, text, text, text, integer, integer, boolean, jsonb)
  to authenticated;
