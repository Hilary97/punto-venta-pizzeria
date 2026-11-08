-- Kitchen cards show, under each special style of a pizza, the ingredients it carries by default
-- (its description, e.g. 'Jamón y piña'). Every kitchen line now carries `style_descriptions`:
-- style name -> description for the special styles of its pizza with a non-empty description;
-- `{}` for products and custom styles. The function now reads pizza_styles, so it is stable.
create or replace function public.kitchen_line_json(i public.order_items)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', i.id,
    'product_name', i.product_name,
    'quantity', i.quantity,
    'item_type', i.item_type,
    'pizza', i.pizza,
    'notes', i.notes,
    'variant', i.variant,
    'station', i.station,
    'style_descriptions', coalesce((
      select jsonb_object_agg(s.name, btrim(s.description))
      from public.pizza_styles s
      where s.kind = 'special'
        and btrim(s.description) <> ''
        and s.id::text in (
          select portion ->> 'style_id'
          from jsonb_array_elements(coalesce(i.pizza -> 'portions', '[]'::jsonb)) portion
        )
    ), '{}'::jsonb)
  );
$$;
