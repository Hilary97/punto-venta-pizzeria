-- Kitchen and delivery lines report their station.
--
-- The two kitchens leave plates in separate pickup areas, each with its own
-- token set (red for pizzas, blue for burgers and snacks). The delivery card
-- groups lines by pickup place, so each line now carries `station`.
--
-- Runs as one script (Supabase SQL Editor).

create or replace function public.kitchen_line_json(i public.order_items)
returns jsonb
language sql
immutable
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
    'station', i.station
  );
$$;
