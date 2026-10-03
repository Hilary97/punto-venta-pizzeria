# Feature: Returns screen shows the day's sales as cards

Branch: `feat/returns-sales-cards` (from `main` `50b74aa`)
The Devoluciones screen lists every sale of the open cash session as a detailed card.

## Specs

- S1: "necesito que hay aparescan las ventas registradas de todo el dia antes de el corte de caja" — Devoluciones lists every sale of the currently open cash session (all sales since the last cash cut).
- S2: "ya cuando se haga el corte de caja se quita todo el historial de ventas" — after the cash cut (session closed), those sales no longer appear in Devoluciones. User decision: hide them, do NOT delete them from the database; they stay in cash history/admin reports.
- S3: "en este hisotrial necsito que aparescan toda la informacin de la venta el nombre a quien se le atendio, la mesa que se atendio, todos los productos el dinero que se recibio y el cambio que se le dio" — each sale shows: customer name ("a quien se le atendió"), table (mesa), all products (name, quantity), amount received, and change given.
- S4: "Puedes distruibrlos por targetas con todo esa información" — sales are rendered as cards. Revised by L4: each card shows a summary (customer, table, time, total) and a "Ver detalles" button opens a modal with all the S3 information (all products, received, change, waiter, folio).
- S5: "ya el boton devoluciones va a cambiar por nombre Hisotrial de Ventas" — the nav button and screen title read "Historial de Ventas" instead of "Devoluciones".
- S6: "el boton no hara devoluciones solo sera para ver detalles de la venta" — the screen no longer creates returns; the card button only shows the sale details.

## Design notes

- Customer name, table and waiter live on `orders` (linked via `orders.paid_sale_id`), not on `sales`. Cashiers cannot read paid orders under current RLS, so expose them through a new migration (security-definer RPC or view scoped to cash roles), never by editing an applied migration.
- POS sales without an order have no customer/table; the card shows a neutral fallback.
- Returning items from a card keeps working (existing return flow).

## Tasks

- T1 (S1, S3) — new migration + repository: session sales include customer name, table, waiter, items, received, change. Route: worker. Commit: e01b92a (done; PGlite RED->GREEN, 77 tests, tsc clean).
- T2 (S1, S2, S3, S4) — Devoluciones UI renders sale cards with all info; return flow still reachable from each card. Route: worker. Commit: 15d2897 (done; RTL RED->GREEN, 13 tests, tsc/oxlint clean).
- T4 (S4, S5, S6) — rename to Historial de Ventas, summary cards + details modal, remove return flow from the screen. Route: worker. Commit: ca660db (done; RED->GREEN, 400 tests, tsc clean, lint 0 errors).
- T3 (S1-S4) — verify: tests, tsc, lint. Route: verify. Done: PASS S1-S4, 399 tests, tsc and lint clean.

## Log

- L1: "Vamos a cambiar la logica de devoluciones, necesito que hay aparescan las ventas registradas de todo el dia antes de el corte de caja, ya cuando se haga el corte de caja se quita todo el historial de ventas, en este hisotrial necsito que aparescan toda la informacin de la venta el nombre a quien se le atendio, la mesa que se atendio, todos los productos el dinero que se recibio y el cambio que se le dio, Puedes distruibrlos por targetas con todo esa información"
- L2: User chose "Ocultarlas de Devoluciones (recomendado)" — sales are hidden after the cut, not deleted.
- L3: "Va muy bien pero ya el boton devoluciones va a cambiar por nombre Hisotrial de Ventas, y el boton no hara devoluciones solo sera para ver detalles de la venta."
- L4: User chose "Tarjeta resumida + botón \"Ver detalles\" (recomendado)" — card shows customer, table, time and total; the button opens a modal with all products, received, change, waiter and folio.
