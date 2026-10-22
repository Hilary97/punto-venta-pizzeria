# Feature: Dine-in or takeaway orders (Aquí / Para llevar)

Branch: `feat/order-service-type` (from `main` `4498f6b`)
Waiters mark each new order as dine-in or takeaway so the kitchen knows whether to plate or pack it.

## Specs

- S1: "que se agregue a los pedidos para que marquen los meseros si es para Aqui o para llevar" — a new order carries a service type, `Aquí` or `Para llevar`, chosen once for the whole order ("Por pedido", L2). Items added later belong to the same order and keep it.
- S2: The choice is required, with no default ("Obligatorio, sin default", L2): the new order form shows `Aquí` / `Para llevar`, and `Registrar pedido` stays disabled until one is chosen. After registering, the choice resets.
- S3: "para que en cocina sepan si van a empacar para llevar o van a poner plato para comer hay en el restarurante" — Cocina tickets (including waiting scheduled ones), Entrega cards and the waiter's open orders show the order's service type.
- S4: Orders created before this feature (or by an app version without it) have no service type and show none.

## Design notes

- `orders.service text null check (service in ('dine_in', 'takeaway'))`; null for legacy orders.
- `insert_order_core`, `create_order`, `device_create_order` take `p_service text default null`, so cached app versions keep working; an unknown value is rejected (`El tipo de pedido no es válido.`). The UI enforces the required choice.
- List RPCs add `service`: `kitchen_orders_core` (20261027), `ready_orders_core` (20261026), `device_list_open_orders` (20261025); `ORDER_SELECT` reads it.
- The user applies migrations by hand in the Supabase SQL Editor.

## Tasks

- T1 (S1, S4) — migration + PGlite tests: column, create RPCs with p_service, service in list RPCs. Route: inline. Commit: see "feat(db): store dine-in or takeaway on orders" (done; PGlite RED->GREEN 7 tests, 261 db tests).
- T2 (S1-S4) — UI: domain/repositories/sources, form choice (required), labels on OrderTicketCard and OpenOrdersList. Route: gentle-ai-worker (context backstop) + inline hint fix. Commit: see "feat(orders): let waiters mark orders as dine-in or takeaway" (done; RED->GREEN, createOrder now takes one object).
- T3 — verify: tests, tsc, lint, build. Route: verify (high risk: migration, RPC signatures). Done: PASS S1-S4; 850 tests, tsc clean, build OK, no new oxlint warnings. Fixed findings: order dialog now says `Elige si es para aquí o para llevar.` until chosen; submit guard throws instead of a silent no-op. Residual: migration not run in Supabase; slice boundary: T1 commit ~580 lines, mostly redefined SQL functions copied verbatim.

## Log

- L1: "Ahora necesito que se agregue a los pedidos para que marquen los meseros  si es para Aqui o para llevar, para que en cocina sepan si van a empacar para llevar o van a poner plato para comer hay en el restarurante"
- L2: Answers: "¿Dónde se marca si es para aquí o para llevar?" — "Por pedido (Recomendado)"; "¿Cómo se elige al registrar el pedido?" — "Obligatorio, sin default (Recomendado)".
- L3: Verify finding: on mobile the order dialog gave no hint why `Registrar pedido` was disabled; added the hint inside the form.
