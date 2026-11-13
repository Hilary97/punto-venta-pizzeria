-- Reorder the product sections (category buttons):
-- Hamburguesas, Botanas, Bebidas, Bebidas preparadas, Rebanadas-Pizza, Ensaladas, Postres, Extras.
-- Every other category keeps its relative order after them.
-- Names are matched ignoring case, spaces and hyphens ("Rebanadas-Pizza" = "rebanadas pizza").
with priority(normalized_name, position) as (
  values
    ('hamburguesas', 1),
    ('botanas', 2),
    ('bebidas', 3),
    ('bebidaspreparadas', 4),
    ('rebanadaspizza', 5),
    ('ensaladas', 6),
    ('postres', 7),
    ('extras', 8)
),
ranked as (
  select
    c.id,
    row_number() over (
      order by coalesce(pr.position, 1000), c.sort_order, c.name
    ) as new_order
  from public.categories c
  left join priority pr
    on pr.normalized_name = regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g')
)
update public.categories c
set sort_order = r.new_order
from ranked r
where c.id = r.id;
