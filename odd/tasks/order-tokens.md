# Feature: Numbered order tokens (fichas)

Branch: `feat/order-tokens` (from `feat/kitchen-queue-order` `a1ddb0b`)
Each open order gets a physical token number (1-50) shown in Cocina, Entrega and the waiter's open orders, so a plate carries a token that matches its order.

## Specs

- S1: "como vamos a solucinar las entregas para identificar los productos fisicos con a quin se entregara" — every order has a stable token number shown on its Cocina card, Entrega card and the waiter's open orders list, labelled `Ficha N`.
- S2: "Si mejor las fichas numeradas" / "si unas 50 fichas" — tokens are 1..50.
- S3: Design decision (stated to the user): a new order takes the lowest token not held by another open order; paying or cancelling an order frees its token; items added later keep the order's token. Two open orders never share a token, even when created at the same time.
- S4: When all 50 tokens are held, the order is still created without a token and cards show `Sin ficha`.
- S5: Existing open orders get tokens in creation order when the migration runs.

## Design notes

- `orders.token smallint null check (token between 1 and 50)`; partial unique index on `token` where `status = 'open'`.
- BEFORE INSERT trigger assigns the token under a transaction advisory lock, so no create RPC changes.
- RPCs that list orders for these screens add `token`: `kitchen_orders_core`, `ready_orders_core`, `device_list_open_orders`; authenticated open orders read it through `ORDER_SELECT`.
- The user applies migrations by hand in the Supabase SQL Editor.

## Tasks

- T1 (S2, S3, S4, S5) — migration + PGlite tests: column, unique index, trigger, backfill, token in list RPCs. Route: inline. Commit: see "feat(db): assign numbered tokens to open orders" (done; PGlite RED->GREEN, 105 db tests).
- T2 (S1, S4) — UI: token in domain/repositories, `Ficha N` / `Sin ficha` on OrderTicketCard and OpenOrdersList. Route: inline. Commit: pending.
- T3 — verify: tests, tsc, lint, build. Route: verify (high risk: migration, concurrency). Pending.

## Log

- L1: "Ahora tengo un reto como vamos a solucinar las entregas para identificar los productos fisicos con a quin se entregara, antes del software los meseros pasaban un tiket plegable en fisico pero ahora que los pedidos pasan a cocina por su ruta como podriamos solucionar ese problema de identificar lso productos fisicos con su pedido"
- L2: "Si mejor las fichas numeradas, o que hacen en los restaurantes grandes que implemnetans software como manejan esto?"
- L3: "Si amra el feature y si unas 50  fichas"
- L4: Decision: lowest free token among open orders instead of a daily folio wrapping at 50, so open orders never collide and no day boundary is needed.
