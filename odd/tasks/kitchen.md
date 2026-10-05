# Feature: Kitchen stations and delivery

Branch: `feat/kitchen` (from `main` `9198826`)
Waiter orders flow automatically to a kitchen screen split into two stations (pizzas, burgers/snacks). Each station marks its part done; finished orders move to a delivery screen.

## Specs

- S1: "al hacer el pedido ... en automatico se valla a seccion cocina" — every order created (or items added) in /pedidos appears automatically in Cocina, no manual step.
- S2: "la cocina se divide en dos apartamentos para hacer pizzas y para hacer lo que es hambuerguesas y botonas" — two stations: `pizza` and `grill` (burgers/snacks).
- S3: "lo importante es que en el pedido se identifique que era a cada seecion de cocina" — each order line knows its station. Pizza builder lines and Pizzas/Rebanadas-Pizza categories -> `pizza`; Hamburguesas, Botanas, Ensaladas -> `grill`; Bebidas, Extras and anything else -> no station (not cooked).
- S4: "se renderiza una targeta con toda la infromación del pedido notas y todo" — a station card shows table/customer, waiter, time, only that station's lines with quantity, variant, pizza description and item notes, plus the order notes.
- S5: "terminada la elaboración se preisna en ese boton o recuadro con palomimta dodne se ira a entrega" — a checkmark button marks that station's lines ready; the card leaves that station.
- S6: User decision: mixed orders are split by station; the order reaches Entrega only when every station is done. Orders without kitchen lines go straight to Entrega.
- S7: User decision: Cocina runs on admin-authorized devices (like waiter devices), each assigned to one station; no login.
- S8: User decision: new Entrega section lists ready orders; the waiter marks "Entregado"; the order then stays pending for payment as today. Items added later go back through the kitchen.

## Design notes

- No realtime today; Cocina and Entrega poll (about every 10 s) plus a manual refresh.
- New migration only (never edit applied ones): `categories.kitchen_station`, `order_items.station` (snapshot at insert), `order_items.ready_at`, `order_items.delivered_at`, `order_devices.kind` (`waiter` | `kitchen_pizza` | `kitchen_grill`), device RPCs for kitchen/delivery plus authenticated (admin/cashier) variants.
- The user applies migrations by hand in the Supabase SQL Editor.

## Tasks

- T1 (S2, S3, S6, S7, S8) — migration + PGlite tests: stations, ready/delivered timestamps, device kind, kitchen and delivery RPCs. Route: worker. Commit: c0f1782 (done; PGlite RED->GREEN, 92 db tests, tsc clean). Note: re-adding a cooked product creates a new line instead of bumping quantity.
- T2 (S3, S4) — orders domain + repository: station/ready/delivered fields, kitchen and delivery source functions. Route: worker. Commit: b3ada7e (done; RED->GREEN, 351 src tests, tsc clean).
- T3 (S7) — admin devices: choose device type (Mesero, Cocina Pizzas, Cocina Hamburguesas/Botanas) on authorization; stored device keeps kind. Route: worker. Commit: f6ae2e9 (done; 354 src tests, tsc clean; tests written first but RED not observed). Routing by kind moved to T4.
- T4 (S1, S4, S5) — Cocina screen: polling station cards with checkmark. Route: worker. Commit: 8f0b7ea (done; RED->GREEN, 372 src tests, tsc clean). Also routes devices by kind.
- T5 (S6, S8) — Entrega screen for waiter devices and admin/cashier, "Entregado" action. Route: worker.
- T6 — verify: tests, tsc, lint. Route: verify.

## Log

- L1: "Necesito implementar nuevas feature, necesito pasar los pedidos a una nueva ruta que se llame cocina, para su elabaracion la cocina se divide en dos apartamentos para hacer pizzas y para hacer lo que es hambuerguesas y botonas. Necesito que al hacer el pedido el mesero en automatico se valla a seccion concian donde se renderiza una targeta con toda la infromación del pedido notas y todo y ya en concian se procedera al elaboración y habra una opcion donde terminada la elaboración se preisna en ese boton o recuadro con palomimta dodne se ira a entrega, esto en las dos secciones de cocina, lo importante es que en el pedido se identifique que era a cada seecion de cocina"
- L2: User chose: authorized kitchen device; split by station; new Entrega section; Bebidas/Extras skip the kitchen (Ensaladas/Botanas -> grill, Rebanadas -> pizza).
