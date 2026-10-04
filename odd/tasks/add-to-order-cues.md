# Feature: Visual cues while adding products to an open order (/pedidos)

When a waiter presses "Agregar productos" on an open order card, the screen must make it
obvious which open order is receiving the new products.

## Specs

- S1. Sticky "add mode" bar above "Armar pizza" (amber, distinct from the red app color):
  "**Agregando al pedido M-5 · Ana** — ya tiene 3 productos  [Cancelar]". It stays visible
  while scrolling categories; "Cancelar" exits add mode without opening the modal.
- S2. Bottom floating order button: today "Ver pedido (2)"; in add mode it reads
  "Agregar a M-5 (2)" and turns amber.
- S0. Pressing "Agregar productos" scrolls to the "Armar pizza" section.

## Tasks

- [x] T0 — S0 — inline — 4a0c822
- [x] T1 — S1 — inline — dfc718f (AddingToOrderBar + ProductGrid `stickyHeader` slot)
- [x] T2 — S2 — inline — dfc718f (OrderFab `targetLabel`)

## Log

- L1: "Necesito que en pedidos en el boton de agregar pedidos en targetas de pedidos abiertos, haga scroll a la seccion del de armar pizza para que se mas interactivo y facil para el mesero indetificar cuando se esta agregando un nuevo proudcto al pedido abierto"
- L2: "Bueno ademas del scroll necesito algo mas que identifique que se esta agregando producto a ese pedido abierto que se le presiono el boton que podriamos agregar?" — proposed options 1 (sticky bar), 2 (FAB label), 3 (card highlight).
- L3: "Si la 1 y 2"
- L4: ProductGrid already has a sticky top-0 header, so the bar renders inside it via a
  `stickyHeader` slot: it sits right below "Armar pizza" (not above) and sticks with the
  category pills. Verified: vitest 336/336, tsc, oxlint clean.
- L5: "Si agrega una rama" — branch `feat/add-to-order-cues`; scroll-only commit verified
  standalone (vitest 334/334, tsc).
