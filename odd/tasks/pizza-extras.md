# Feature: Admin-managed pizza extras (Extra queso and more)

Branch: `feat/pizza-extras` (from `main` `aad4092`)
The admin can add more extras besides "Extra queso", each with its own price. Extras are toggled per portion in "Armar pizza" and charged per portion, like Extra queso today. Extra queso becomes one more extra of the list.

## Specs

- S1: User request: "En la ruta donde se edita la pizza podemos agregar para poder agregar mas extras como en extra quedo ponemos otros extras con sus precios." Page: `/admin/pizzas`, section "Extras".
- S2: User decision: "Como Extra queso" — "Cada extra tiene nombre y precio; en el armador se activa por porción y se cobra por porción. El admin los crea, edita y desactiva."
- S3: User decision: "Migrarlo a la lista" — "Pasa a ser un extra más de la lista, editable igual que los nuevos. Los pedidos viejos se siguen leyendo bien."
- S4: Admin "Extras" section lists every extra (active and inactive) with order, name, price per portion and state; "Nuevo extra" creates one; "Editar" changes name, price, order and state; "Activar"/"Desactivar" toggles it. Nothing is hard-deleted (stored order lines reference extras). Duplicate name → 'Ya existe un extra con ese nombre.' Price > 0 → 'El precio debe ser mayor a cero.'
- S5: The extra ingredient price (per extra ingredient per portion) stays editable in the same section.
- S6: In "Armar pizza" every active extra shows as a toggle chip per portion; the server charges each selected extra's price once per portion and the line description lists them (`+ Extra queso, Orilla rellena`). Inactive extras disappear from the builder.
- S7: Existing order lines and clients that still send `extra_cheese: true` keep working: they mean the migrated "Extra queso" extra (same price, same description).

## Design notes

- Migration `20261107120000_pizza_extras.sql`: table `pizza_extras` (RLS like `pizza_ingredients`), "Extra queso" seeded with fixed id `00000000-0000-4000-8000-000000000001` and the current `extra_cheese_cents`; `order_items.pizza` portions rewritten from `extra_cheese` to `extra_ids`; `pizza_settings.extra_cheese_cents` dropped; `validate_pizza`, `price_pizza`, `describe_pizza`, `device_list_catalog` replaced.
- Prices stay server-side (catalog for the builder has no prices), like styles.
- The user applies the migration by hand in the Supabase SQL Editor, then deploys the frontend.

## Tasks

- T1 (S2, S3, S6, S7) — migration + PGlite tests. Route: inline. Commit: `a49eb6c` feat(db) (RED 12/12 -> GREEN; supabase suite 322/322). Slice boundary: db alone (~700 lines, mostly replaced SQL functions copied whole).
- T2a (S6, S7) — builder side: domain `extraIds`, catalog `extras`, repository mapping, PortionEditor/PizzaBuilderModal + tests. Route: inline. Commit: `52baa42` feat(pizza) (RED 12 -> GREEN; pizza+orders 185/185, tsc clean on its files). Slice boundary: builder side alone (~215 lines).
- T2b (S1, S4, S5) — admin side: admin domain/repository, `/admin/pizzas` Extras section, modals + tests. Route: gentle-ai-worker (context backstop). Commit: `3082cd3` feat(pizza) (RED 16 -> GREEN 41/41). Full front: tsc 0, 675/675 tests, oxlint no new findings.
- T3 — verify (high risk: data rewrite, pricing contract). Route: gentle-ai-verify. Done: PASS S1-S7; supabase 322/322, src 675/675, tsc 0; differential before/after migration identical totals and names for 6 shapes. Findings: M1 re-running only the rewrite statement wiped extra_ids; M2 admin could hard-delete an extra (delete policy + grant); L1 non-object portion aborted the migration; L2 string extra_cheese silently dropped; L3 deactivating Extra queso blocks paying open orders that have it (same as ingredients, accepted); L4 pizza_cheese_extra_id without search_path. Not verified: real Supabase SQL Editor.
- T4 (M1, M2, L1, L2, L4) — fix: idempotent rewrite (skip portions with extra_ids, non-objects, non-boolean extra_cheese), no delete policy/grant on pizza_extras, search_path on the id function. Route: inline. Commit: `e850994` fix(db) (RED 3 -> GREEN; supabase suite 325/325).

## Log

- L1: "En la ruta  donde se edita la pizza podemos agregar para poder agregar mas extras como en extra quedo ponemos otros extras con sus precios."
- L2: Answers: tipo "Como Extra queso (Recomendado)"; Extra queso "Migrarlo a la lista (Recomendado)".
- L3: Verify findings M1, M2, L1, L2, L4 fixed in T4; L3 (deactivating an extra blocks paying open orders that have it) accepted, same as ingredients and styles.
