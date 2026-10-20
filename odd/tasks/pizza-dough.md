# Feature: Daily pizza dough per size

Branch: `feat/pizza-dough` (from `feat/supplies` `09a6869`)
Each morning the admin loads how many doughs were prepared per pizza size. Every pizza ordered takes one dough of its size; when a size runs out the waiter sees it as "Agotado" in the pizza builder and the server rejects it. The day's numbers also show how many pizzas of each size were made.

## Specs

- S1: User request: "Podemos agregar algo así como inventaro de pizzas para saber cuantas se hacen y se pueden vender el día? para que el mesero tambien vea si ya estan agotadas?"
- S2: What is counted: "Masas por tamaño (recomendado)" — "Chica, Mediana y Grande tienen cada una sus masas del día. Cada pizza descuenta 1 de su tamaño." Proposal accepted: "Si se cancela el pedido, la masa vuelve." Styles and portions do not matter: one pizza line of quantity N takes N doughs of its size.
- S3: Daily load: "A mano cada mañana (recomendado)" — "Al abrir, el admin pone cuántas masas preparó de cada tamaño. Si no carga nada, las pizzas quedan sin límite."
- S4: Waiter: "para que el mesero tambien vea si ya estan agotadas" — a size with no dough left shows "Agotado" in the pizza builder and cannot be chosen; the server also rejects it ("igual que con los refrescos"), and the whole order write rolls back.
- S5: "saber cuantas se hacen" — for today, per size: doughs prepared, pizzas made (taken), and left.

## Design notes

- Business day: the local date in America/Mexico_City, with the day changing at 05:00 local (`(now() at time zone 'America/Mexico_City' - interval '5 hours')::date`), so service after midnight stays on the same day. Stated to the user.
- Table `pizza_dough_days`: `business_day date`, `size_code text references pizza_sizes(code)`, `prepared integer >= 0`, `used integer >= 0`, `check (used <= prepared)`, primary key `(business_day, size_code)`. No row for today and a size = unlimited (no deduction).
- `order_items.dough_day date null`: the business day whose dough the pizza line took (null when unlimited), so cancelling gives back to that day's row.
- `insert_order_lines`: after the existing up-front lock of tracked products (id order), lock today's dough rows of the sizes in the payload in `size_code` order and check the total pizzas per size against `prepared - used` with the message 'No hay masas de pizza <Size name>: quedan <n>.'; then each pizza line adds its quantity to `used` and stores `dough_day`. Payload parsing for the up-front check must skip malformed items (the per-line loop rejects them) exactly like the product pre-check.
- `cancel_order_core`: after the products, lock the dough rows the order took (`business_day, size_code` order) and subtract the lines' quantity from `used`.
- Admin RPC `admin_set_pizza_dough(p_size_code, p_prepared)`: sets today's prepared count (upsert), rejecting values below what is already used ('No puedes cargar menos masas de las que ya se usaron (<used>).'), negative or null ('La cantidad de masas no es válida.'), unknown size ('El tamaño de pizza no existe.'), non-admin ('Solo un administrador puede cargar las masas.'). There is no "remove limit" action: once loaded, a size stays limited for that day; the admin can load a larger number instead.
- Today's dough per size is exposed to: the admin (`admin_list_pizza_dough()` → today's business_day plus per size {size_code, name, prepared, used, left} with null counts for sizes without a row) and the waiter catalogs (`device_list_catalog` sizes get `dough_left` = left or null when unlimited; the authenticated pizza catalog reads it through a small RPC or view, never by opening the table to waiters).
- Admin UI lives on `/admin/inventario` in a "Masas del día" section: per size Preparadas / Pizzas hechas / Quedan, and "Cargar masas" (sets today's prepared total).
- The user applies the migration by hand in the Supabase SQL Editor.

## Tasks

- T1 (S2-S5) — migration + PGlite tests: table, `order_items.dough_day`, deduction and block in `insert_order_lines`, restore in `cancel_order_core`, admin RPCs, catalog `dough_left`. Route: gentle-ai-worker. Commit: see `feat(db): daily pizza dough per size` (done; PGlite RED 30/33 -> GREEN 33/33; 716 tests, tsc 0; parent updated pizza.test.ts catalog expectation with `dough_left: null`). Lock order: products (id) -> today's dough rows (size_code) -> per line; cancel: order -> products -> dough rows (business_day, size_code). Business day only via `pizza_business_day_at(timestamptz)`. Deviations: `admin_list_pizza_dough` rejects non-admins with 'Solo un administrador puede ver las masas.'; sizes listed Grande, Mediana, Chica (existing sort_order); `order_lines_priced` not restated (no dough logic). New RPCs: `admin_set_pizza_dough`, `admin_list_pizza_dough`, `list_pizza_dough_left` (any authenticated role).
- T2 (S3-S5) — UI: pizza builder shows "Agotado" sizes disabled (device and authenticated catalogs); `/admin/inventario` "Masas del día" section with load action. Route: gentle-ai-worker. Commit: pending.
- T3 — verify. Route: verify (high risk: order writes, stock concurrency). Pending.

## Log

- L1: "Podemos agregar algo así como inventaro de pizzas para saber cuantas se hacen y se pueden vender el día? para que el mesero tambien vea si ya estan agotadas?"
- L2: Answers: "¿Qué querés contar para saber cuántas pizzas se pueden vender en el día?" — "Masas por tamaño (recomendado)"; "¿Cómo se cargan las masas cada día?" — "A mano cada mañana (recomendado)".
- L3: Design decision told to the user: the dough day changes at 5:00 am Mexico City time.
