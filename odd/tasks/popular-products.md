# Popular products in Más vendidas

Extends Más vendidas (odd/tasks/popular-pizzas.md): best-selling non-pizza products (with their variant) are mixed with the pizzas, 8 tiles total.
Branch: main (user commits on request; "Todavía no" for now). Migration not applied to production until the user asks.

## Specs

- S1: Choice "Mezclados en 'Más vendidas' (Recomendado)" — "Una sola fila arriba: pizzas y productos juntos, ordenados por ventas." Fixed admin pizzas ("Pizzas rápidas") stay first in admin order; then best-selling pizzas and products of the last 30 days of paid orders, most sold first, ties most recently sold first.
- S2: Choice "8 en total (Recomendado)" — "Dos filas en tablet; deja lugar a pizzas y productos." The section shows up to 8 tiles.
- S3: A product tile is one product + variant (e.g. "Coca (600 ml)"); tapping adds one, like tapping it in the grid; holding removes one; the badge shows the quantity in the order. Inactive, sold-out ("Agotado"), legacy pizza products and variants no longer offered are not shown; the next best seller takes the place, so 8 tiles show whenever 8 valid items exist.
- S4: Without the pizza builder available, pizza tiles are hidden but product tiles still show. Failing to load never blocks the order screen; with nothing sold the section is hidden. Waiter devices and admin/cashier both get it; only sale counts, no money.

## Tasks

- T1 (S1, S2, S3, S4) — migration `popular_picks`: `popular_picks(limit)`, `list_popular_picks()`, `device_list_popular_picks(secret)`; PGlite tests. Route: inline. Done: PGlite RED 9/9 -> GREEN 9/9 (popularPizzas, quickPizzas, migrations still green). Commit: pending (user).
- T2 (S1-S4) — client: source `loadPopularPicks`, schema, tiles for products in ProductsStep/OrdersWorkspace, filter then cut to 8; UI tests. Route: inline. Done: RED (sources 2/2, OrdersPage missing module) -> GREEN; 1286 tests, tsc 0, oxlint 12 (baseline), build OK. Old client listPopularPizzas removed (server RPCs kept). Commit: pending (user).
- T3 (S1-S4) — verify (high risk: new security definer RPC exposed to anon devices). Route: gentle-ai-verify. Done: S1, S2, S4 met; security met; S3 unmet: pizzas of a size with no dough left fill the 16 server slots, products never reach the client (F1 blocker). Advisory F2: 8 fixed pizzas + no builder. Commit: n/a.
- T4 (S3, F1) — server skips pizzas whose size has no dough left (same rule as list_pizza_dough_left); add verifier probes as regression tests. Route: gentle-ai-worker (context backstop). Done: internal pizza_size_has_dough(size) (no row = no limit), used for fixed and best sellers; PGlite RED 3/3 -> GREEN 12/12; probes in popularPicksProbes.test.ts and OrdersPage.test.tsx; 1302 tests, tsc 0, oxlint 12, build OK. Residual F2 advisory (8 fixed pizzas + no builder) not addressed. Commit: pending (user).

## Log

- L1: User: "Va con el orden que propopusiste" — item 8 of the pending list: "\"Más pedidos\" en el paso Productos: quedó diferida porque no había datos de lo más vendido. Ahora sí los hay gracias a \"Más vendidas\" de pizzas, así que se podría hacer lo mismo con hamburguesas, bebidas, etc."
- L3: Verify T3: F1 blocker (dough-out pizzas crowd out products), fixed in T4.
- L2: Answers: "¿Dónde se muestran los productos más pedidos (hamburguesas, bebidas, botanas…)?" — "Mezclados en 'Más vendidas' (Recomendado)"; "¿Cuántos atajos en total?" — "8 en total (Recomendado)"; commit of the Entrega PIN fix — "Todavía no".
