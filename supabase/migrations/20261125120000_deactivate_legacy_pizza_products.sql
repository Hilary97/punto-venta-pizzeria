-- Deactivates the legacy fixed pizza products (category flagged legacy_pizza): pizzas are sold
-- and priced only through the pizza builder. The rows stay so past orders keep their names.
-- A product still on an open order stays active, because inactive products cannot be charged
-- (order_lines_priced marks them "Producto no disponible"). Supabase applies a migration once:
-- to deactivate the ones kept, run this same UPDATE in the SQL Editor after those orders are
-- paid or cancelled. It never reactivates a product, so running it again is safe.
update public.products p
set active = false
from public.categories c
where c.id = p.category_id
  and c.legacy_pizza = true
  and p.active = true
  and not exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id = p.id
      and o.status = 'open'
  );
