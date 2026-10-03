-- Add the Hawaiana, Italiana and Pepperoni styles to the pizza builder.
-- Idempotent: existing styles or prices with the same keys are left untouched.
with seed (sort_order, name, description, chica, mediana, grande) as (
  values
    (14, 'Estilo Hawaiana', 'Jamón y piña', 110, 190, 210),
    (15, 'Estilo Italiana', 'Pepperoni y champiñón', 110, 190, 210),
    (16, 'Estilo Pepperoni', 'Pepperoni', 110, 190, 210)
),
inserted as (
  insert into public.pizza_styles (name, description, kind, included_ingredients, sort_order)
  select name, description, 'special', 0, sort_order from seed
  on conflict (name) do nothing
  returning id, name
)
insert into public.pizza_style_prices (style_id, size_code, price_cents)
select i.id, p.size_code, p.pesos * 100
from inserted i
join seed s on s.name = i.name
cross join lateral (
  values ('chica', s.chica), ('mediana', s.mediana), ('grande', s.grande)
) as p (size_code, pesos)
on conflict (style_id, size_code) do nothing;
