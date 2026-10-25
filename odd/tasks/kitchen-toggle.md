# Feature: Kitchen on/off switch (paper stickers mode)

Branch: `feat/kitchen-toggle` (from `main` `35a9a9c`)
Admin can switch the kitchen screens off; orders and payment keep working and nothing piles up in Cocina/Entrega.

## Specs

- S1: "un boton para activar y desactivar la cocina para cuando no quieran usar stiker en lugar de pantallas par acontrolar la cocina" — an admin-only switch turns the kitchen screens on/off; the setting is stored in the database and applies to every device.
- S2: "nada mas que funcione el hacer pedidos y cobrar para que no se acumulen los pedidos y se tenga que preisonar como terminados y pasar a entrega" — while off, creating orders, adding items and paying work as today, but new lines never appear in Cocina or Entrega (they are stored as ready and delivered, the order token is freed, and paying ends the order).
- S3: User decision: "Se dan por terminados" — switching off marks every pending line of orders in service as ready and delivered, so the boards are left empty.
- S4: Switching back on restores today's flow for lines created afterwards.

## Tasks

- T1 (S1-S4) — migration + PGlite tests: `kitchen_settings`, `set_kitchen_enabled`, insert trigger, finish pending on switch-off. Route: inline. Commit: 9447def (PGlite RED 9/9 -> GREEN 10/10; queued_at fix pinned by the scheduled test; 310 db tests).
- T2 (S1) — admin switch on /cocina + repository + tests. Route: inline. Commit: fdb43f4 (RED observed: missing modules, then KitchenEntry admin/cashier; 961 tests, tsc 0, no new lint warnings, build OK).
- T3 — verify (high risk: rewrites stored order lines). Route: inline (independent verifier launch was refused by the runtime). Done: PASS S1-S4 by tests; review: only orders in service are touched, cancel/stock/sales untouched, finish_kitchen_lines and the trigger function revoked from clients. Notes: (a) while off, repeated non-kitchen products (drinks) become separate lines instead of merging quantity (merge index needs delivered_at is null); totals unaffected. (b) Switching off exactly while an item is being added to an existing order can raise a deadlock error on one side; Postgres aborts it and a retry works; no line is left behind.

## Log

- L1: "Ahora vamos a aplicar un boton para activar y desactivar la cocina para cuando no quieran usar stiker en lugar de pantallas par acontrolar la cocina, nada mas que funcione el hacer pedidos y cobrar para que no se acumulen los pedidos y se tenga que preisonar como terminados y pasar a entrega, los stiker fisicos donde se se esciben los pedidos remplazan eso. Se puede hacer algo así. ?"
- L2: User chose "Se dan por terminados" for pending orders when switching off.
