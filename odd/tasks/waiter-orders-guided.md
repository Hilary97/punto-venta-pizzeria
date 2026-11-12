# Waiter orders: guided steps

Implements design/waiter-orders/01-pasos-guiados.html (visual spec) on /pedidos: Mesa → Productos → Revisar with a visible step indicator and the order context always shown.
Branch feat/waiter-orders-guided (stacked on feat/pos-keypad-checkout). Waiters never see prices. Reusable code exists in commit 16de6d3 (parked artboard-04 work: Sheet, tableOccupancy, inline tile steppers/variants).

## Specs

- S1 Step indicator at the top: "1 Mesa", "2 Productos", "3 Revisar"; the current step is highlighted (brand red), completed steps show a check and can be tapped to go back.
- S2 Step 1 "Mesa": "¿Dónde es el pedido?" with a large "Aquí / Para llevar" toggle; "Elige la mesa" grid M-1..M-9 where free tables say "Libre" and occupied ones say "Ocupada" with "Ficha 7 · 25 min · Jorge" (status by text, not only color); a line under the grid explains the choice ("M-4 está libre. Se abrirá un pedido nuevo."); choosing an occupied table offers "Agregar a este pedido" (enters the existing add-to-order mode). "Nombre del cliente (opcional en mesa · obligatorio para llevar)". Primary "Siguiente: productos →" is enabled only when the step is valid.
- S3 Step 2 "Productos": sticky context bar "M-4 · Aquí · Familia Ortega" with "Cambiar" (back to step 1); search; category pills ≥44px; "Armar pizza" prominent tile (current pizza builder unchanged); product tiles ≥64px with a quantity badge once added ("×2"); products with variants choose inline on the tile ("Elige: Res / Pollo"); "Agotado" tiles disabled with label. Sticky bottom bar "3 productos · Revisar pedido →".
- S7 Dark mode: every surface of the guided flow (step indicator, table tiles free/occupied/selected, context bar, product tiles and variant chips, ×N badges, bottom bars, review lines and buttons, undo snackbar, missing list, sheets and open-orders cards) must be readable in dark mode with no light pastel backgrounds and with AA contrast. PR #9 comment (verbatim): "Necsitamos correregir los colores en modo obuscuro, y ocultar la seccion de todo".
- S8 Productos step has no "Todos" pill; it starts on the first category. The search still searches all products (user choice: "Quitar la pastilla \"Todos\" (Recomendado)").
- S4 Step 3 "Revisar": context summary with "Cambiar"; each line with large − qty +, "Agregar nota" / "Editar nota" and a separate "Quitar" that shows an undo snackbar ("Quitaste Papas gajo · Deshacer"); "Nota del pedido (opcional)"; "Hora para recoger (opcional)"; a list of what is missing when the order can't be sent (e.g. "Falta: nombre del cliente"); primary "Enviar a cocina".
- S5 Existing rules keep working: service required; table or valid name; one open order per table; notes limits; pickup time "La hora del pedido debe ser más tarde hoy."; add-to-order mode; open orders (including takeaway) reachable with their actions (Agregar productos, Editar nota, Cancelar pedido with confirmation, Cobrar for cashiers); success message after sending.
- S6 Out of scope now: the "Más pedidos" quick row (needs most-ordered data) and "Pizzas rápidas"; the pizza builder redesign.

## Tasks

- T1 [S1, S2, S5] Step indicator + Mesa step with table occupancy — route: worker — done (full suite 1200 green) — commit: pending
- T2 [S3, S5] Productos step: context bar, inline variants and quantity badges, bottom bar — route: worker — done — commit: pending
- T3 [S4, S5] Revisar step: lines, notes, undo, missing list, Enviar a cocina — route: worker — done; unused OrderFab/TableSelector/OrderDraftPanel/VariantPickerModal removed by parent — commit: pending
- T5 [S7, S8] PR #9 review: dark mode colors and no "Todos" pill — route: worker + parent (ErrorBanner, Button danger) — done (1199 tests green; dark screenshots checked) — commit: see git log
- T4 [S1-S5] Visual check vs artboard at 375px, full suite, tsc, lint — route: parent + worker — done (10 layout fixes; 1198 tests green, tsc/lint 0; screenshots 320/375/1280) — commit: n/a

## Log

- L1 User request (verbatim): "Vamos a revisar que mejora podemos hacer en pedidos para que mejore la interfaz, para que los meseros se familiaricen facil y que sea efiente hacer los pedidos cuando esten frente a los clientes. usa gentle:disaign igual"
- L2 User (verbatim): "Sabes de que vamos a implementar otro diseno del cambas de las 4 opciones que me diste se puede?" → chose "01 · Pasos guiados"; previous artboard-04 work parked in 16de6d3 on feat/waiter-orders-redesign.
- L3 Handoff: "Implement the design artboard design/waiter-orders/01-pasos-guiados.html" — chosen artboard 01; 02, 03, 04 are alternatives.
- L5 Worker decisions to confirm with the user: Para llevar hides the table grid (name required); occupied table blocks Siguiente and only offers Agregar a este pedido; open orders in a sheet from "Pedidos abiertos (n)" in step 1; step 2 defaults to Todos; undo window 8 s (last removal only); highlight red; single-column layout on desktop.
- L6 User (verbatim): "si estoy de acuerdo con las 6 decisiones". Committed: 4dc0a8c (domain + Sheet, T1-T3 support), f28c9bd (guided steps UI, T1-T4). Slice boundary: one PR stacked on feat/pos-keypad-checkout, reviewed commit by commit (OrdersPage.test.tsx rewrite accounts for ~1400 lines).
- L7 PR #9 comment by Hilary97 (verbatim): "Necsitamos correregir los colores en modo obuscuro, y ocultar la seccion de todo". Clarified: "Quitar la pastilla \"Todos\" (Recomendado)" — replaces the earlier decision that step 2 starts on "Todos".
- L4 Earlier decision kept: "Pizzas rápidas" → "Dejarlas para después (Recomendado)". "Más pedidos" deferred by the same reasoning (no most-ordered data yet).
