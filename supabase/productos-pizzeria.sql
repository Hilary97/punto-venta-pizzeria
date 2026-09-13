-- Seed del menu Chuy's & Liz Pizzeria
-- price_cents esta expresado en centavos: $250.00 MXN = 25000

insert into public.categories (name, sort_order) values
  ('Pizzas', 1),
  ('Hamburguesas', 2),
  ('Ensaladas', 3),
  ('Botanas', 4),
  ('Bebidas', 5),
  ('Extras', 6)
on conflict (name) do update
set sort_order = excluded.sort_order;

-- Productos con precio visible en el menu.
-- WHERE NOT EXISTS evita duplicados si vuelves a ejecutar el seed,
-- aun si products no tiene una restriccion UNIQUE.
insert into public.products (category_id, name, price_cents, active)
select c.id, p.name, p.price_cents, p.active
from (
  values
    -- PIZZAS BASE: incluye 2 ingredientes
    ('Pizzas', 'Pizza 2 ingredientes chica', 11000, true),
    ('Pizzas', 'Pizza 2 ingredientes mediana', 19000, true),
    ('Pizzas', 'Pizza 2 ingredientes grande', 21000, true),

    -- PIZZAS ESPECIALES
    ('Pizzas', 'Estilo Varas chica', 13000, true),
    ('Pizzas', 'Estilo Varas mediana', 22000, true),
    ('Pizzas', 'Estilo Varas grande', 25000, true),

    ('Pizzas', 'Estilo Chuy''s chica', 12000, true),
    ('Pizzas', 'Estilo Chuy''s mediana', 20000, true),
    ('Pizzas', 'Estilo Chuy''s grande', 23000, true),

    ('Pizzas', 'Estilo Seis Carnes chica', 13000, true),
    ('Pizzas', 'Estilo Seis Carnes mediana', 22000, true),
    ('Pizzas', 'Estilo Seis Carnes grande', 25000, true),

    ('Pizzas', 'Estilo Vegetariana chica', 13000, true),
    ('Pizzas', 'Estilo Vegetariana mediana', 21000, true),
    ('Pizzas', 'Estilo Vegetariana grande', 23000, true),

    ('Pizzas', 'Estilo Suprema chica', 13000, true),
    ('Pizzas', 'Estilo Suprema mediana', 22000, true),
    ('Pizzas', 'Estilo Suprema grande', 25000, true),

    ('Pizzas', 'Estilo El Primo chica', 12000, true),
    ('Pizzas', 'Estilo El Primo mediana', 20000, true),
    ('Pizzas', 'Estilo El Primo grande', 22000, true),

    ('Pizzas', 'Estilo Cuquío chica', 13000, true),
    ('Pizzas', 'Estilo Cuquío mediana', 22000, true),
    ('Pizzas', 'Estilo Cuquío grande', 25000, true),

    ('Pizzas', 'Estilo Cuatro Carnes chica', 12000, true),
    ('Pizzas', 'Estilo Cuatro Carnes mediana', 21000, true),
    ('Pizzas', 'Estilo Cuatro Carnes grande', 24000, true),

    ('Pizzas', 'Estilo Especial chica', 12000, true),
    ('Pizzas', 'Estilo Especial mediana', 20000, true),
    ('Pizzas', 'Estilo Especial grande', 23000, true),

    ('Pizzas', 'Estilo Margarita chica', 12000, true),
    ('Pizzas', 'Estilo Margarita mediana', 21000, true),
    ('Pizzas', 'Estilo Margarita grande', 25000, true),

    ('Pizzas', 'Estilo Mexicana chica', 13000, true),
    ('Pizzas', 'Estilo Mexicana mediana', 21000, true),
    ('Pizzas', 'Estilo Mexicana grande', 23000, true),

    ('Pizzas', 'Estilo Chuley chica', 18000, true),
    ('Pizzas', 'Estilo Chuley mediana', 26000, true),
    ('Pizzas', 'Estilo Chuley grande', 28000, true),

    ('Pizzas', 'Estilo El Ranchito chica', 18000, true),
    ('Pizzas', 'Estilo El Ranchito mediana', 26000, true),
    ('Pizzas', 'Estilo El Ranchito grande', 28000, true),

    -- HAMBURGUESAS
    ('Hamburguesas', 'Hamburguesa El Ranchito - sin papas', 6000, true),
    ('Hamburguesas', 'Hamburguesa El Ranchito - con papas francesa', 7500, true),
    ('Hamburguesas', 'Hamburguesa El Ranchito - con papas gajo', 8500, true),

    ('Hamburguesas', 'Hamburguesa Monster sencilla', 8000, true),
    ('Hamburguesas', 'Hamburguesa Monster sencilla - con papas francesa', 9500, true),
    ('Hamburguesas', 'Hamburguesa Monster sencilla - con papas gajo', 10500, true),
    ('Hamburguesas', 'Hamburguesa Monster doble carne', 10500, true),
    ('Hamburguesas', 'Hamburguesa Monster doble carne - con papas francesa', 11500, true),
    ('Hamburguesas', 'Hamburguesa Monster doble carne - con papas gajo', 12500, true),

    -- ENSALADAS
    ('Ensaladas', 'Ensalada César con pollo', 7500, true),

    -- BOTANAS
    ('Botanas', 'Alitas 5 pzas', 6000, true),
    ('Botanas', 'Papas a la francesa adobadas', 5000, true),
    ('Botanas', 'Papas gajo', 5000, true),
    ('Botanas', 'Aros de cebolla 10 pzas', 6000, true),
    ('Botanas', 'Nuggets de pollo 10 pzas', 7000, true),
    ('Botanas', 'Dedos de queso 5 pzas', 5000, true),
    ('Botanas', 'Tiritas de pollo', 6000, true),

    -- EXTRAS
    ('Extras', 'Extra queso', 3000, true),
    ('Extras', 'Doble carne para hamburguesa', 2500, true)
) as p (category_name, name, price_cents, active)
join public.categories c
  on c.name = p.category_name
where not exists (
  select 1
  from public.products existing
  where existing.category_id = c.id
    and lower(existing.name) = lower(p.name)
);

-- BEBIDAS: el menu muestra los nombres, pero NO muestra sus precios.
-- Se cargan inactivas con precio 0 para no inventar precios ni permitir ventas accidentales.
insert into public.products (category_id, name, price_cents, active)
select c.id, p.name, 0, false
from (
  values
    ('Bebidas', 'Refresco Coca-Cola'),
    ('Bebidas', 'Café Nescafé Clásico'),
    ('Bebidas', 'Café Vainilla'),
    ('Bebidas', 'Café Moka'),
    ('Bebidas', 'Malteada Moka'),
    ('Bebidas', 'Malteada Vainilla'),
    ('Bebidas', 'Fuze Tea Frutos Rojos'),
    ('Bebidas', 'Fuze Tea Mango Manzanilla'),
    ('Bebidas', 'Fuze Tea Durazno'),
    ('Bebidas', 'Naranjada'),
    ('Bebidas', 'Sangría'),
    ('Bebidas', 'Agua Natural'),
    ('Bebidas', 'Agua Mineral'),
    ('Bebidas', 'Cerveza Corona'),
    ('Bebidas', 'Cerveza Modelo (lata)'),
    ('Bebidas', 'Jugo del Valle Durazno'),
    ('Bebidas', 'Jugo del Valle Manzana Néctar'),
    ('Bebidas', 'Jugo del Valle Manzana'),
    ('Bebidas', 'Jugo del Valle Mango'),
    ('Bebidas', 'Jugo del Valle Guayaba')
) as p (category_name, name)
join public.categories c
  on c.name = p.category_name
where not exists (
  select 1
  from public.products existing
  where existing.category_id = c.id
    and lower(existing.name) = lower(p.name)
);

