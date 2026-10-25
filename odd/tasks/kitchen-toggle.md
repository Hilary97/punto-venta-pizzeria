# Feature: Kitchen on/off switch (paper stickers mode)

Branch: `feat/kitchen-toggle` (from `main` `35a9a9c`)
Admin can switch the kitchen screens off; orders and payment keep working and nothing piles up in Cocina/Entrega.

## Specs

- S1: "un boton para activar y desactivar la cocina para cuando no quieran usar stiker en lugar de pantallas par acontrolar la cocina" — an admin-only switch turns the kitchen screens on/off; the setting is stored in the database and applies to every device.
- S2: "nada mas que funcione el hacer pedidos y cobrar para que no se acumulen los pedidos y se tenga que preisonar como terminados y pasar a entrega" — while off, creating orders, adding items and paying work as today, but new lines never appear in Cocina or Entrega (they are stored as ready and delivered, the order token is freed, and paying ends the order).
- S3: User decision: "Se dan por terminados" — switching off marks every pending line of orders in service as ready and delivered, so the boards are left empty.
- S4: Switching back on restores today's flow for lines created afterwards.

## Tasks

- T1 (S1-S4) — migration + PGlite tests: `kitchen_settings`, `set_kitchen_enabled`, insert trigger, finish pending on switch-off. Route: inline. Commit: pending.
- T2 (S1) — admin switch on /cocina + repository + tests. Route: inline. Commit: pending.
- T3 — verify (high risk: rewrites stored order lines). Route: verify. Commit: n/a.

## Log

- L1: "Ahora vamos a aplicar un boton para activar y desactivar la cocina para cuando no quieran usar stiker en lugar de pantallas par acontrolar la cocina, nada mas que funcione el hacer pedidos y cobrar para que no se acumulen los pedidos y se tenga que preisonar como terminados y pasar a entrega, los stiker fisicos donde se se esciben los pedidos remplazan eso. Se puede hacer algo así. ?"
- L2: User chose "Se dan por terminados" for pending orders when switching off.
