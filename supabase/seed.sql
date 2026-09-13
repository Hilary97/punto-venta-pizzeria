-- Sample catalog for local testing / first-run data.
-- Run once, after applying supabase/migrations/20260912120000_init.sql, in
-- the Supabase SQL editor or via `npx supabase db push` (which applies both
-- migrations and this seed when linked to a project with seeding enabled).
--
-- This file intentionally does NOT create any auth user or admin account —
-- create your first user by signing up through the app (or the Supabase
-- Auth dashboard), then promote it to admin with the SQL update documented
-- in README.md. Never hardcode credentials here.

insert into public.categories (name, sort_order) values
  ('Pizzas', 1),
  ('Bebidas', 2),
  ('Extras', 3)
on conflict (name) do nothing;

-- Re-running this block after the first time will insert duplicate products
-- (there is no uniqueness constraint on product name), so it is meant to be
-- run once against a fresh database.
insert into public.products (category_id, name, price_cents, active)
select c.id, p.name, p.price_cents, true
from (
  values
    ('Pizzas', 'Pizza Margarita chica', 9900),
    ('Pizzas', 'Pizza Margarita grande', 14900),
    ('Pizzas', 'Pizza Pepperoni chica', 10900),
    ('Pizzas', 'Pizza Pepperoni grande', 15900),
    ('Pizzas', 'Pizza Hawaiana grande', 15900),
    ('Bebidas', 'Refresco de lata', 2000),
    ('Bebidas', 'Agua embotellada 600ml', 1800),
    ('Bebidas', 'Jarra de agua de sabor', 4500),
    ('Extras', 'Orilla de queso', 3000),
    ('Extras', 'Pan de ajo', 4000)
) as p (category_name, name, price_cents)
join public.categories c on c.name = p.category_name;
