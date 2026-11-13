-- Pizza slices skip the pizza oven.
--
-- Slices are already baked, so a slice on its own ("sola", "sin papas") is
-- ready on arrival and goes straight to Entrega, like a plain drink. A slice
-- with fries ("con papas") goes to the burgers and snacks kitchen ('grill'),
-- which fries the potatoes.
--
-- A slice is a product line whose category name contains "rebanada". It has
-- fries when its product name or chosen option mentions "papa" or "papas"
-- ("Rebanada-Papa Francesa", "Rebanada-Papa Gajo") without "sin papa(s)". The rule runs as a row trigger before the line is stored, so it
-- holds for every path that inserts order lines. Lines already ordered are not
-- touched. Safe to run more than once.

create or replace function public.route_slice_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text;
begin
  if new.item_type <> 'product' or new.product_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = new.product_id
      and regexp_replace(lower(c.name), '[^a-z]', '', 'g') like '%rebanada%'
  ) then
    return new;
  end if;

  v_text := lower(coalesce(new.product_name, '') || ' ' || coalesce(new.variant, ''));

  if v_text ~ '\mpapas?\M' and v_text !~ '\msin\s+papas?\M' then
    new.station := 'grill';
    new.ready_at := null;
  else
    new.station := null;
    new.ready_at := coalesce(new.ready_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists order_items_route_slice on public.order_items;
create trigger order_items_route_slice
  before insert on public.order_items
  for each row execute function public.route_slice_line();
