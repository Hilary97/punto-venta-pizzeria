-- Show pizza sizes from largest to smallest in the pizza builder.
-- The first size is also the one preselected when the builder opens.
update public.pizza_sizes s
set sort_order = o.sort_order
from (values ('grande', 1), ('mediana', 2), ('chica', 3)) as o (code, sort_order)
where s.code = o.code;
