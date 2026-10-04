-- Reorder the category buttons shown when taking an order.
-- Priority categories come first; every other category keeps its relative order after them.
-- Names are matched ignoring case, spaces and hyphens ("Rebanadas-Pizza" = "rebanadas pizza").
with priority(key, position) as (
  values
    ('hamburguesas', 1),
    ('botanas', 2),
    ('bebidas', 3),
    ('extras', 4),
    ('rebanadaspizza', 5)
),
ranked as (
  select
    c.id,
    row_number() over (
      order by coalesce(p.position, 1000), c.sort_order, c.name
    ) as new_order
  from public.categories c
  left join priority p
    on p.key = regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g')
)
update public.categories c
set sort_order = r.new_order
from ranked r
where c.id = r.id;
