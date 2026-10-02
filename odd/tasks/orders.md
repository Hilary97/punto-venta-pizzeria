# Feature: Waiter orders (/pedidos) synced with the cash register

Branch: `feat/orders`

## Goal

Waiters register orders by table (M-1 … M-9) and customer name, picking products
from the catalog without prices. Orders stay open (editable: add products, cancel)
until the customer asks for the bill; then a "Cobrar" button opens the POS with the
order loaded and the cashier charges it as a regular sale in the open cash session.

## Decisions

- New role `waiter`: only sees `/pedidos`; cannot charge or see cash screens.
- Orders never store prices. `pay_order` RPC builds items from `order_items`, calls
  the existing `create_sale` (server-side prices) and marks the order paid, atomically.
- Orders are editable while open (add products, cancel).
- Assumptions: several open orders per table allowed; the loaded order is read-only
  in the POS cart; sync via shared DB + manual refresh (no realtime yet).

## Tasks

- [x] 1. DB migration: `waiter` role, `orders`/`order_items`, RLS, RPCs
      `create_order`, `add_order_items`, `cancel_order`, `pay_order`; update
      `database.types.ts`.
- [x] 2. Orders domain + repository (draft order logic, table labels, tests).
- [x] 3. Role plumbing: `UserRole` waiter, multi-role `RequireRole`, waiter routing in
      Nav/HomeRoute, guard cash routes, `/pedidos` route.
- [x] 4. `/pedidos` UI: table buttons, name input, price-less product grid, open
      orders list with add products / cancel / Cobrar.
- [x] 5. POS: load order via `?pedido=<id>`, read-only cart, checkout through `pay_order`.
- [x] 7. Table OR customer name is enough to register an order (new migration relaxing
      constraints + `create_order`; nullable types; `orderLabel` helper; UI enable rule).
- [x] 8. POS (Venta) lists open orders labeled by table and/or name, each with Cobrar.
- [x] 9. Venta screen shows only pending orders (no product grid); charging an order
      shows its priced cart + checkout. Direct sales without an order are removed from the UI.
- [x] 6. Harden cash RPCs server-side so `waiter` cannot open/sell/return/close.

## Evidence

(commit ids recorded per task)

- Task 1: `f9c0906` — tsc ok, lint no new warnings; SQL not executed against Postgres.
- Task 2: `abb9635` — RED (missing modules) → GREEN 18 tests; tsc ok; lint clean.
- Task 4 (done before 3 so no commit routes to an empty page): `b0584df` — RED (missing page) → GREEN 54 tests incl. mobile FAB; tsc/lint clean.
- Task 3: `5408bc9` — RED 5 failing → GREEN full suite 144 tests; tsc ok; no new lint warnings.
- Task 5: `29d47c0` — RED 7 order-mode tests → GREEN 155 tests; tests caught a double-charge window (fixed); tsc/lint clean.
- Task 6: `e89db5d` — rename-to-`_unchecked` + role-checking wrappers; verified no internal cross-calls; SQL not executed.

- Task 7: `ea899ba` — RED 7 domain tests → GREEN 167; new migration 20261002140000 (not executed).
- Task 8: `4a919b9` — RED 4 → GREEN 173; empty state keeps Actualizar reachable.
- Task 9: `a13bc39` — RED 15 → GREEN 164; catalog and direct sales removed from Venta.

## Pending (user)

- Apply the three migrations in order (20261002120000, 20261002130000, 20261002140000) in Supabase (none were executed here).
- Set `role = 'waiter'` on waiter profiles.
- Manual smoke test: create order → add items → Cobrar → corte includes the sale.
