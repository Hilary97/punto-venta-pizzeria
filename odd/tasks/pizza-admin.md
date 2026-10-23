# Feature: Admin screen for the pizza builder catalog

Branch: `feat/pizza-admin` (from `main` `fe059e1`)
An admin page at `/admin/pizzas` edits everything the pizza builder ("Armar pizza") reads: sizes, styles with their prices, ingredients and the extra prices. Today these rows only change through migrations.

## Specs

- S1: User request: "Si vamos armarlo para editar desde pantalla, todo lo que tenga que ver con armar pizza." Context from the previous answer: "Se puede siendo admin editar ingredientes. agregar mas etc?" Only admins see and use the page (nav link "Pizzas", route `/admin/pizzas`).
- S2: Ingredients: list all (active and inactive) in order; create, edit name and order, activate/deactivate. Inactive ingredients disappear from the builder. Duplicate name → 'Ya existe un ingrediente con ese nombre.'
- S3: Styles: list all with kind, included ingredients, the three prices and state; create, edit name, description, kind (`special` "Estilo con ingredientes fijos" / `custom` "Arma tu combinación"), included ingredients (special: 0; custom: 1-4), order, the three prices (Chica, Mediana, Grande, all required, > 0), activate/deactivate. Style and prices save atomically. Duplicate name → 'Ya existe un estilo con ese nombre.'
- S4: Sizes: the three sizes are fixed (Chica, Mediana, Grande, tied to daily dough); edit name and allowed portions (subset of 1-4, at least one).
- S5: Extras: edit the extra ingredient price and the extra cheese price (> 0).
- S6: Nothing is hard-deleted: styles and ingredients are referenced by stored order lines (`order_items.pizza`), so "remove" is deactivate.

## Design notes

- Prices are computed at quote/pay time (`order_lines_priced` → `price_pizza`), like products: a price change also applies to open unpaid orders. Renames also show on open orders' descriptions. Told to the user.
- Migration `20261102120000_pizza_admin.sql`: RPC `admin_save_pizza_style(p_style_id uuid, p_name, p_description, p_kind, p_included_ingredients, p_sort_order, p_active, p_prices jsonb)` security definer, `is_admin()` check, validates and upserts style + 3 prices in one transaction, returns the style id. Size check constraint on `allowed_portions` (non-empty subset of {1,2,3,4}).
- Ingredients, sizes and settings write directly through the existing admin RLS policies (same pattern as products/supplies).
- The user applies the migration by hand in the Supabase SQL Editor.

## Tasks

- T1 (S3, S4, S6) — migration + PGlite tests. Route: inline. Commit: see `feat(db): admin save for pizza styles and catalog checks` (RED 15/17 -> GREEN 17/17; supabase suite 297). Also adds name checks on sizes and ingredients.
- T2 (S2-S5) — domain + repository (admin catalog list, writes) + tests. Route: inline. Commit: see `feat(pizza): admin catalog domain and repository` (RED: missing modules -> GREEN 17 new tests; pizza 74, tsc 0).
- T3 (S1-S5) — `/admin/pizzas` page, modals, nav, route + UI tests. Route: inline. Commit: see `feat(pizza): admin page for the pizza builder catalog` (RED: missing page + Nav link -> GREEN 18; new rows default to the next order). Slice boundary: T1 (db, high risk) is its own commit; T2+T3 are the app slice.
- T4 — verify (high risk: security definer RPC). Route: gentle-ai-verify. Commit: n/a.

## Log

- L1: "Si vamos armarlo para editar desde pantalla, todo lo que tenga que ver con armar pizza."
- L2: Decisions stated to the user: no hard delete (deactivate); sizes fixed to three (name and portions editable); price changes apply to open orders like products.
