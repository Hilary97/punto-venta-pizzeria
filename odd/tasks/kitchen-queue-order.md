# Feature: Kitchen queue in arrival order

Branch: `feat/kitchen-queue-order` (from `main` `2621fa7`)
Each station lists its work as tickets in exact arrival order, numbered #1, #2..., so cooks know what came in first.

## Specs

- S1: "necesito que tengan orden paaa que los cocineros sepan cual entro primero segundo para que los vallan cocinando en orden, en las dos categorias de pizza y hamburguesas y botana" — both stations (`pizza`, `grill`) list pending work oldest first by the time the lines reached the kitchen, not by when the order was opened.
- S2: "Si una targeta aparte para repetar el el orden de llegada exacto" — items added later to an open order show up as a separate ticket at the end of the queue; the same table may appear on two tickets. A ticket groups the pending lines of one order sent in one create/add action.
- S3: Step 1 (accepted proposal): new migration adds `order_items.created_at`; existing lines take their order's `created_at`.
- S4: Step 2 (accepted proposal): tickets are ordered by arrival time and the card shows that arrival time.
- S5: Step 3 (accepted proposal): each card shows a big turn number (#1, #2...) counted separately per station.

## Design notes

- `now()` is the transaction time, so every line inserted by one create/add RPC shares one `created_at`; a ticket is `(order_id, created_at)`.
- RPC `created_at` on a kitchen ticket becomes the batch arrival time; `id` stays the order id so mark-ready (which takes shown line ids) is unchanged.
- Entrega stays one card per order.
- The user applies migrations by hand in the Supabase SQL Editor.

## Tasks

- T1 (S1, S2, S3) — migration + PGlite tests: `order_items.created_at` with backfill; `kitchen_orders_core` returns one ticket per arrival batch, oldest first. Route: inline. Commit: 200b4e7 (done; PGlite RED->GREEN, 101 db tests).
- T2 (S2, S4, S5) — UI: ticket key per batch (two tickets of one order coexist), turn number #N on Cocina cards. Route: inline. Commit: see "feat(kitchen): number tickets in arrival order" (done; RED->GREEN, 485 tests, tsc clean, oxlint warnings only, pre-existing).
- T3 — verify: tests, tsc, lint, build. Route: verify (high risk: migration). Pending.

## Log

- L1: "Ya corri la migración de supabase. Lo que necesito es revisar la logica de como llegan los pedidos a cocina?, necesito que tengan orden paaa que los cocineros sepan cual entro primero segundo para que los vallan cocinando en orden, en las dos categorias de  pizza y  hamburguesas y botana"
- L2: "Si una targeta aparte para repetar el el orden de llegada exacto y armar los 3 pasos que propones"
- L3: Finding: `kitchen_orders_core` sorted by `orders.created_at`; `order_items` had no timestamp, so a pizza added late to an old table jumped ahead.
