-- Reorder the styles shown in the pizza builder.
-- Custom styles ("Arma tu combinación") stay first, then Pepperoni, Hawaiana and Italiana;
-- every other style keeps its relative order after them.
-- Names are matched ignoring case and spaces.
with priority(key, position) as (
  values
    ('estilopepperoni', 1),
    ('estilohawaiana', 2),
    ('estiloitaliana', 3)
),
ranked as (
  select
    s.id,
    row_number() over (
      order by
        case when s.kind = 'custom' then 0 else 1 end,
        coalesce(p.position, 1000),
        s.sort_order,
        s.name
    ) as new_order
  from public.pizza_styles s
  left join priority p
    on p.key = regexp_replace(lower(s.name), '[^a-z0-9]', '', 'g')
)
update public.pizza_styles s
set sort_order = r.new_order
from ranked r
where s.id = r.id;
