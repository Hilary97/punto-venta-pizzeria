# Feature: Scheduled orders (pedidos para una hora)

Branch: `feat/scheduled-orders` (from `main` `dafd02a`)
A waiter can set the time a customer will pick up an order. The order waits outside the kitchen and enters the station queue (as a new ticket, taking its physical token) a configurable number of minutes before that time.

## Specs

- S1: User request: "hay pedidos para una hora, apartan los clientes sus pedidos para una hora entonces necesito marcar eso para que los meseros al tomar el pedido tenga la disponibilidad de poner la hora del pedido y en cocina al hacercarse la hora del pedido se le agregue una ficha nueva y entre en cola para su elaboración al menos unos 20 minutos antes de que llega la hora."
- S2: When creating an order (waiter device or signed-in register), the waiter may optionally set a pickup time. Only today and a future time ("Solo hoy, hora futura", L2); the server rejects a past time or another day (America/Mexico_City). Without a time the order behaves exactly as today.
- S3: A scheduled order is not shown in Cocina and holds no physical token ("ficha") until it enters the queue, "Al entrar a cocina (20 min antes)" (L2). It enters the queue when `now >= scheduled time - lead time`; then it takes the lowest free token 1..50 (or none, "Sin ficha", as today) and its ticket appears in the station queue. A time already inside the lead window enters the queue at creation.
- S4: Lead time is "Configurable por el admin" (L2), default 20 minutes; changing it applies to scheduled orders not yet in the queue.
- S5: Kitchen delay alerts count "Desde que entra a la cola" (L2): the ticket time is when the order entered the queue. Kitchen cards and the waiter's open orders show the pickup time ("Para las HH:MM"); a waiting scheduled order shows it is scheduled instead of a token.
- S6: Lines added to a scheduled order before it enters the queue join its first ticket; cancelling a waiting scheduled order works as today (no token to free).

## Design notes

- `orders`: add `scheduled_for timestamptz null`, `queued_at timestamptz null`; backfill `queued_at = created_at`. Single-row `order_settings (scheduled_lead_minutes)` default 20, admin get/set RPCs.
- Token trigger skips orders created outside the lead window. `release_scheduled_orders()` (same advisory lock as tokens) sets `queued_at = now()` and the token on due orders; called by the kitchen and waiter list RPCs (not delivery: a waiting order has no ready lines, so delivery never shows it). Boards poll at least every 60 s and the order update fires the realtime signal, so lag is at most ~60 s.
- `kitchen_orders_core`: only queued orders; ticket time `greatest(line created_at, queued_at)`; returns `scheduled_for`.
- `create_order` / `device_create_order` gain `p_scheduled_for` (new signature; frontend and migration deploy together).

## Tasks

- T1 (S2-S4, S6) — migration `20261025120000_scheduled_orders.sql` + PGlite tests. Route: inline. Commit: `78a43f1` (done; RED 0/16 -> GREEN 16/16; full suite 781/781). Slice note: 779 lines, one high-risk unit (~440 migration, half restated functions; ~340 tests); kept whole on purpose so review takes the DB rules alone. Tests replace `public.app_now()` as the clock.
- T2 (S2, S5) — waiter UI: pickup time input on new orders, sources send it, open orders show "Para las HH:MM". Route: inline. Commit: `bff35bd` (done; RED 8 -> GREEN 197/197 orders+waiters; full suite 790/790; tsc 0, lint 0 in orders). Ordinary orders keep the 4-argument `createOrder` call and omit `p_scheduled_for`, so the old RPC still answers. Fix `687a142`: unused id in the T1 test. Deploy note: the admin open-orders select reads `scheduled_for, queued_at`, so the migration must be applied before this frontend.
- T3 (S5) — kitchen card shows "Para las HH:MM". Route: gentle-ai-worker (context backstop). Commit: `3f1b456` (done; RED 6 -> GREEN 64/64 kitchen; tsc 0; lint 0 errors).
- T4 (S4) — admin setting for lead minutes ("Pedidos programados" section on the inventory admin page). Route: gentle-ai-worker (context backstop). Commit: see `git log` (feat(orders): admin lead minutes) (done; RED module-missing -> GREEN 228/228 orders+products+pizza; full suite 803/803; tsc 0).
- T5 (S1-S6) — verify (high risk: token concurrency, RPC signature change). Route: gentle-ai-verify. Done: PASS S1-S6; 49/49 DB, 195/195 orders+kitchen, tsc 0; scratch PGlite probes: distinct tokens on a multi-release, old calls without `p_scheduled_for` resolve, grants match, `app_now`/helpers not executable by clients, no writes when nothing is due. Findings: low — orders entering together were not sorted by pickup time (fixed: `order by t.ticket_at, o.scheduled_for nulls first, o.id`, RED->GREEN test, commit below); low — the register's signed-in open-orders list reads the table and never releases, so a due order may show "Programado" up to ~60 s while a board or waiter device is polling (accepted); info — a waiting scheduled order can be paid and then never reaches the kitchen (same as ordinary orders; open product question). Not verified: real multi-connection concurrency, PostgREST schema reload, real browser/devices outside Mexico City time.

## Log

- L1: "Muy bien, bueno vamos a empezara a agregar un nueva fetarue en la ruta de pedidos, el problema que necesitamos resolver es que hay pedidos para una hora, apartan los clientes sus pedidos para una hora entonces necesito marcar eso para que los meseros al tomar el pedido tenga la disponibilidad de poner la hora del pedido y en cocina al hacercarse la hora del pedido se le agregue una ficha nueva y entre en cola para su elaboración al menos unos 20 minutos antes de que llega la hora."
- L2: Answers: token "Al entrar a cocina (20 min antes)"; lead "Configurable por el admin"; time "Solo hoy, hora futura"; alerts "Desde que entra a la cola".
- L3: Verify T5 PASS S1-S6; fixed the same-time ordering finding; register-list lag accepted as low.
