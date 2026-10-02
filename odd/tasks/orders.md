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

- [ ] 1. DB migration: `waiter` role, `orders`/`order_items`, RLS, RPCs
      `create_order`, `add_order_items`, `cancel_order`, `pay_order`; update
      `database.types.ts`.
- [ ] 2. Orders domain + repository (draft order logic, table labels, tests).
- [ ] 3. Role plumbing: `UserRole` waiter, multi-role `RequireRole`, waiter routing in
      Nav/HomeRoute, guard cash routes, `/pedidos` route.
- [ ] 4. `/pedidos` UI: table buttons, name input, price-less product grid, open
      orders list with add products / cancel / Cobrar.
- [ ] 5. POS: load order via `?pedido=<id>`, read-only cart, checkout through `pay_order`.
- [ ] 6. Harden cash RPCs server-side so `waiter` cannot open/sell/return/close.

## Evidence

(commit ids recorded per task)
