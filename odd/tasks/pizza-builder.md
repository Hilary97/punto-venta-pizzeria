# Feature: Pizza builder (phase 1)

Branch: `feat/pizza-builder`

## Goal

Waiters build pizzas instead of searching 39 fixed products: size → division →
per-portion style (13 specials or "Arma tu combinación" with 2 included ingredients)
→ per-portion extras → pizza note; plus an order-level note. The cash register
charges server-computed prices.

## Decisions (user)

- Mixed styles: charge the most expensive style for that size.
- Extras cost full price even on a single portion: extra ingredient $5, extra cheese $30
  (any size), stored in a settings table.
- Divisions: chica entera only; mediana entera or mitades; grande entera, mitades,
  tercios, cuartos.
- "Arma tu combinación": base price 110/190/210, 2 included ingredients per portion.
- Prices always computed server-side at quote/pay time; orders never store prices.
- Existing pizza products are kept (open orders stay payable) but hidden from the
  waiter product grid; the builder replaces them.
- SQL is verified with PGlite (dev-only) running every migration in tests.
- Phase 2 (later): admin editor for styles, prices, ingredients.

## Tasks

- [ ] 1. PGlite harness: dev dependency, auth/extensions stubs, apply all migrations,
      smoke tests of existing order/pay/device flows.
- [ ] 2. Migration: pizza catalog (sizes, styles + prices, ingredients, settings) seeded
      from the menu; order item type/pizza config/notes; order notes; server pricing,
      quote and pay; device/catalog RPC updates; PGlite pricing tests.
- [ ] 3. Domain + repositories: pizza config types, description formatter, catalog
      loaders, order lines with pizza payload and notes, quote.
- [ ] 4. Waiter UI: pizza builder + item/order notes; hide legacy pizza products.
- [ ] 5. Cash register UI: server-quoted lines with pizza descriptions and notes.

## Evidence

## Pending (user)

- Apply the new migration in Supabase together with the deploy.
