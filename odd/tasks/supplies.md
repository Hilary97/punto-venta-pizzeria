# Feature: Supplies inventory with purchase costs

Branch: `feat/supplies` (from `feat/inventory` `c072931`)
Manual inventory of supplies (cheese, flour, meat, boxes): admins register purchases with what they paid and periodic counts; sales never deduct. Supplies at or below their minimum show up as "to buy", and a purchase history shows the total spent in a date range.

## Specs

- S1: Scope chosen by the user: "Si también implementala con canto pague". The proposal accepted was: "Inventario manual de insumos: cargás lo que compraste y hacés un conteo cada tanto, sin que las ventas descuenten nada. Sirve para saber qué falta comprar y cuánto gastaste." Supplies are a separate list from products; orders, kitchen and payments never touch them.
- S2: Permissions: "Solo el admin (recomendado)" — "Igual que el inventario de productos. Vos controlás qué se carga y cuánto se pagó." Only admins read or write supplies, purchases and counts.
- S3: Units: "Lista fija (recomendado)" — "kg, g, L, ml y piezas. Evita que uno escriba 'kilo' y otro 'kg' y los números no se puedan comparar."
- S4: Each supply has its own minimum. Purchase ("Compra"): quantity received plus amount paid, added to the stock ("llegaron 10 kg de queso"). Count ("Conteo"): sets the counted stock ("quedan 3 kg de queso"). Supplies at or below their minimum appear in a "Para comprar" list.
- S5: Spending: "Historial con total por fechas (recomendado)" — "Lista de compras (insumo, cantidad, cuánto pagaste, quién y cuándo), con un filtro de fechas y el total gastado en ese rango."

## Design notes

- Migration `20261022120000_supplies.sql`, applied by hand by the user in the Supabase SQL Editor.
- `supplies`: `id`, `name` (unique, case-insensitive), `unit` check in (`kg`,`g`,`l`,`ml`,`pz`), `stock numeric(12,3) >= 0`, `stock_min numeric(12,3) >= 0`, `active`, `created_at`. Admin-only RLS for select/insert/update; no delete (deactivate instead). Forms write name, unit, minimum and active, never `stock`.
- `supply_movements`: `id`, `supply_id`, `kind` (`purchase` | `count`), `quantity numeric(12,3)` (received units, or the counted value), `cost_cents integer` (required for purchases, `>= 0`; null for counts), `stock_after`, `created_by` (default `auth.uid()`), `created_at`. Admin-only select; written only by the RPCs.
- RPCs (admin only, `is_admin()` inside): `admin_record_supply_purchase(supply, quantity > 0, cost_cents >= 0)` adds atomically; `admin_count_supply(supply, counted >= 0)` sets the stock; both lock the supply row and insert a movement in the same transaction. `admin_list_supply_purchases(from timestamptz, to timestamptz)` returns purchases in `[from, to)` with supply name, unit, quantity, cost, buyer name and time, newest first.
- Date range: the client turns local dates into `[start of from-day, start of the day after to-day)`; default range is the current month.
- UI copy in Spanish; unit labels: kg, g, L, ml, pz.

## Tasks

- T1 (S1-S5) — migration + PGlite tests: tables, constraints, RLS, the three RPCs. Route: gentle-ai-worker (context backstop). Commit: `69ef9e2` (done; PGlite RED 27 -> GREEN). Deviations accepted: column-level grants (clients insert/update only name, unit, stock_min, active; no delete; supply_movements select-only), purchase/count RPCs return {supply_id, stock}, extra checks (non-blank name, stock_after >= 0, per-kind quantity/cost rules), quantities beyond 3 decimals rounded by numeric(12,3).
- T2 (S3-S5) — domain (units, status, form schemas, money), repository + tests. Route: same worker as T1. Commit: `c209fcb` (done; 631 tests, tsc 0, oxlint 11).
- T3 (S2-S4) — `/admin/insumos`: supplies table with stock, minimum, status, "Para comprar" alert, new/edit supply form, "Compra" and "Conteo" modals, nav link "Insumos". Route: gentle-ai-worker. Commit: see `feat(supplies): admin supplies page with purchases history` (done; 670 tests, tsc 0, oxlint 12: the page adds the same set-state-in-effect warning as AdminProductsPage). Parent fix: a duplicate name now reads "Ya existe un insumo con ese nombre." (unique violation 23505) instead of the generic write error. Dates use toLocaleString('es-MX') like CashHistoryPage.
- T4 (S5) — purchases history on `/admin/insumos`: date range (default this month), list and total spent. Route: same worker as T3. Commit: same commit as T3 (done).
- T5 — verify. Route: verify (high risk: new stored data and admin-only permissions). Pending.

## Log

- L1: "Si también implementala con canto pague"
- L2: Answers: "¿Quién puede registrar compras y conteos de insumos?" — "Solo el admin (recomendado)"; "¿En qué unidades se miden los insumos?" — "Lista fija (recomendado)"; "¿Cómo querés ver cuánto gastás?" — "Historial con total por fechas (recomendado)".
