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

- [x] 1. PGlite harness: dev dependency, auth/extensions stubs, apply all migrations,
      smoke tests of existing order/pay/device flows.
- [x] 2. Migration: pizza catalog (sizes, styles + prices, ingredients, settings) seeded
      from the menu; order item type/pizza config/notes; order notes; server pricing,
      quote and pay; device/catalog RPC updates; PGlite pricing tests.
- [x] 3. Domain + repositories: pizza config types, description formatter, catalog
      loaders, order lines with pizza payload and notes, quote.
- [ ] 4. Waiter UI: pizza builder + item/order notes; hide legacy pizza products.
- [ ] 5. Cash register UI: server-quoted lines with pizza descriptions and notes.

## Evidence

- Task 1: `beade83` — all 10 existing migrations apply on PGlite; 9 smoke tests green (first real SQL execution); 262 tests; tsc 0 (supabase/tests type-checked); build 0.
- Task 2: `e76550c` — pizza catalog migration on PGlite; 41 pricing/quote/pay tests green; 303 tests (32 files); tsc 0; build 0; lint 0 errors (9 pre-existing warnings).
- Task 3: `6f43e88` — pizza domain (validate/describe mirroring SQL), catalog loaders (tables + device RPC), order notes, pizza line payloads, quoteOrder; RED observed (missing pizza.ts/normalizeNotes); 321 tests (34 files); tsc 0; lint 0 errors.

## Pending (user)

- Apply the new migration in Supabase together with the deploy.
