# Feature: Finished-goods inventory

Branch: `feat/inventory` (from `main` `e0381f1`)
Products bought ready to sell (drinks, extras) can track stock. Taking an order deducts it, cancelling the order restores it, a product at 0 is blocked as "Agotado", and each product has its own low-stock minimum.

## Specs

- S1: Scope chosen by the user: "Si vamos a implementar la de productos terminados la que me recomiendas". The proposal was: "Inventario de productos terminados: cada producto tiene su stock y cada venta lo descuenta. Por ejemplo: 24 refrescos, se vende 1 y quedan 23. Sirve para lo que comprás hecho, como bebidas, cervezas o postres", plus "una alerta de 'stock bajo'". Stock tracking is opt-in per product; untracked products (pizzas, cooked food) behave exactly as today.
- S2: When stock is deducted: "Al tomar el pedido (recomendado)" — "El mesero ve 'Agotado' al instante y no vende lo que no hay. Si se cancela el pedido, el stock vuelve."
- S3: At zero: "Se bloquea (recomendado)" — "Sale 'Agotado' y el sistema no deja pedirlo. Obliga a cargar el stock al día." The server rejects an order line that asks for more than the remaining stock, and the whole order write is rolled back (no stock or line changes).
- S4: Low stock: "Mínimo por producto (recomendado)" — "Cada producto tiene su propio mínimo: refresco 12, cerveza 24, etc."
- S5: The admin can load stock without racing sales: an entry adds units ("llegaron 24") and a count sets the counted value. Only admins change stock outside orders.

## Design notes

- `products.track_stock boolean not null default false`, `products.stock integer not null default 0 check (stock >= 0)`, `products.stock_min integer not null default 0 check (stock_min >= 0)`.
- `order_items.stocked_quantity integer not null default 0`: units actually deducted for that line, so cancelling restores exactly what was taken even if tracking was switched on or off in between.
- `insert_order_lines`: for a tracked product, an atomic `update ... set stock = stock - q where stock >= q`; no row -> error "No hay suficiente <producto>: quedan <n>." Lines merged by `on conflict` add to `stocked_quantity` too.
- `cancel_order_core` adds `stocked_quantity` back per product before marking the order cancelled.
- `pay_order` / `create_sale` do not touch stock (stock already left at order time).
- Admin RPCs (`is_admin()` inside): `admin_receive_stock(product, quantity > 0)` and `admin_count_stock(product, stock >= 0)`. The product form writes `track_stock` and `stock_min`, never `stock`.
- `device_list_catalog` and the authenticated product list expose `track_stock` and `stock` so the grid shows "Agotado".
- Residual: a waiter grid is not refreshed when someone else takes the last unit; the server still rejects the order with the message above.
- The user applies the migration by hand in the Supabase SQL Editor.

## Tasks

- T1 (S1-S3, S5) — migration + PGlite tests: columns, deduction, block, cancel restore, admin stock RPCs, catalog fields. Route: inline. Commit: `b154f3b` (done; PGlite RED 16/16 -> GREEN, 547 tests; mutation check: dropping the merged-line `stocked_quantity` sum fails the restore test). Slice is ~630 lines because the migration must restate the full bodies of `insert_order_lines`, `cancel_order_core` and `device_list_catalog`; one migration cannot be split without shipping half a schema. Residual: the `for no key update` row lock is not exercised (PGlite has one connection).
- T2 (S1, S3, S4) — domain, repositories and product form (tracking + minimum); waiter and cashier grids show "Agotado" disabled. Route: inline. Commit: `1c6098d` (done; RED 12 -> GREEN, 560 tests, tsc clean, oxlint 10 warnings same as main). The form never sends `stock`; a hidden minimum keeps its saved value.
- T3 (S4, S5) — `/admin/inventario`: tracked products with stock, minimum and status (OK / Stock bajo / Agotado), low-stock alert, "Entrada" and "Conteo" actions, nav link. Route: inline. Commit: pending.
- T4 — verify: tests, tsc, lint, build, per-S# verdict. Route: verify (high risk: stored data and concurrent stock writes). Pending.

## Log

- L1: "Si vamos a implementar la de productos terminados la que me recomiendas"
- L2: Answers: "¿En qué momento se descuenta el stock?" — "Al tomar el pedido (recomendado)"; "¿Qué pasa cuando un producto llega a 0?" — "Se bloquea (recomendado)"; "¿Cómo se define el 'stock bajo'?" — "Mínimo por producto (recomendado)".
