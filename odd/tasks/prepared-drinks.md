# Feature: Prepared drinks station

Branch: `feat/prepared-drinks` (from `main` `da8ee67`)
Shakes and coffees need preparation, so they get their own kitchen station "Bebidas preparadas" with a checkmark, like pizza and grill.

## Specs

- S1: "Si vamos ahora si aplicar la migración para la estación de malteadas, y pues que se agregue los cafes también" — new station `drinks` labelled "Bebidas preparadas". Its lines start pending (no `ready_at`) and the order reaches Entrega only once they are marked ready, like the other stations.
- S2: User chose "Nueva categoría \"Bebidas preparadas\" (recomendada)": the migration creates category "Bebidas preparadas" (`kitchen_station = 'drinks'`) placed right after "Bebidas" (only when a "Bebidas" category exists), and moves the products of "Bebidas" whose name starts with "Malteada" or "Café" into it. Other drinks stay in "Bebidas", ready on arrival. A new prepared drink is added by choosing that category in Productos.
- S3: Kitchen devices: new device kind `kitchen_drinks` ("Cocina - Bebidas preparadas") in Admin > Dispositivos; such a device opens /cocina on the drinks station; /cocina for admin/cashier gets a "Bebidas preparadas" tab.
- S4: Entrega: ready prepared-drink lines show in the "Bebidas y otros" section.
- S5: Existing lines and open orders are not changed by the migration.

## Tasks

- T1 (S1, S2, S5) — migration `20261101120000_prepared_drinks_station.sql` + PGlite tests. Route: inline. Commit: e9d5c64 (done; PGlite RED->GREEN 9 tests, categoryOrder green). Slice is 499 lines: one migration (two copied core functions with a widened guard) plus its tests, not splittable.
- T2 (S3, S4) — frontend: station/device kind enums, labels, /cocina tab, Entrega section. No docs mention stations. Route: inline. Commit: see git log (feat(kitchen): show prepared drinks station). RED->GREEN 9 tests.
- T3 — verify: full tests, tsc, oxlint, build. Route: inline.

## Log

- L1: "Si vamos ahora si aplicar la migración para la estación de malteadas, y pues que se agregue los cafes también como prodriamos agregarle a esa estación en cocina. Bebidas preparadas?"
- L2: User chose "Nueva categoría \"Bebidas preparadas\" (recomendada)" over a per-product station field.
- L3: Decision (agent default): prepared drinks are picked up in Entrega's "Bebidas y otros" section; no fourth section.
