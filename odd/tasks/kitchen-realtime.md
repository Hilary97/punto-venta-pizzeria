# Feature: Realtime kitchen and delivery boards

Branch: `feat/kitchen-realtime` (from `main` `60fb33e`)
Cocina and Entrega boards refetch when orders change (Supabase Realtime Broadcast signal) instead of polling every 10 s; polling stays as a slow fallback.

## Specs

- S1: "me gustaria agregar el paso 2 cocina y tiempos para bajar la cantidad de request" — scope chosen: "Solo tiempo real" (Broadcast + polling de respaldo cada 60 s en Cocina y Entrega. Nada más.).
- S2: Design decision (stated to the user): kitchen devices have no Supabase user, so `postgres_changes` (RLS) would not reach them and opening SELECT to `anon` is not allowed. A database trigger sends an empty Broadcast signal (`realtime.send`) on the public `kitchen` channel whenever `orders` or `order_items` change; the signal carries no order data.
- S3: On the signal, Cocina and Entrega boards reload through the same RPCs they use today; security of the reads does not change.
- S4: Fallback polling every 60 s when the board is subscribed, plus a reload when the channel (re)subscribes. Boards without a realtime subscription keep polling every 10 s.
- S5: A failing `realtime.send` never blocks creating, updating, paying or cancelling an order.

## Design notes

- Sent at most once per transaction (`app.kitchen_signal_sent` local setting).
- The client channel stays open for the app lifetime (realtime-js reuses a leaving channel for the same topic).
- Statement-level AFTER INSERT/UPDATE/DELETE triggers on `orders` and `order_items` call `public.notify_kitchen_changed()`, which calls `realtime.send('{}', 'changed', 'kitchen', false)` inside `begin ... exception when others`.
- Client: `subscribeKitchenChanges(onChange)` in `kitchenRepository` opens `supabase.channel('kitchen')` and listens to broadcast `changed`; sources expose optional `subscribe`. `useOrderBoard` merges signals into one reload 300 ms after the first and uses the 60 s fallback interval when `subscribe` exists.
- The user applies migrations by hand in the Supabase SQL Editor. PGlite tests stub `realtime.send`.
- Residual: a public channel lets anyone with the anon key see when orders change (no content) or send fake signals (extra refetches only).

## Tasks

- T1 (S2, S5) — migration + PGlite tests: trigger function, triggers, failure isolation. Route: inline. Commit: `8251d6c` (done; PGlite RED->GREEN, 108 db tests; mutation check: removing the exception handler fails the failure-isolation test).
- T2 (S3, S4) — UI: subscription in repository, sources, `useOrderBoard`, boards, device apps. Route: inline. Commit: `400cf00` (done; RED->GREEN incl. device-app forwarding mutation check; 511 tests, tsc clean, oxlint only pre-existing warnings, build OK).
- T3 — verify: tests, tsc, lint, build. Route: verify (high risk: database triggers, public realtime channel). Done: first pass S4 FAIL; findings fixed RED->GREEN in `bc09add` (one signal per transaction, cascades included) and `cfc62a5` (channel kept open for the app lifetime so a station switch never lands on a leaving channel; no listener leak when subscribe throws; signals no longer postpone the reload). Re-check: PASS S1-S5; 515 tests, tsc clean, oxlint 10 warnings (same as main), build OK. Residual: not run against real Supabase (public channel access, `postgres` calling `realtime.send`, rejoin after network drop).

## Log

- L1: "Ahora dime como se podria mojorar este proyecto, que otra logica podriamos implementar"
- L2: "cobramos con puro efectivo, me gustaria agregar el paso 2 cocina y tiempos para bajar la cantidad de request"
- L3: Scope answer: "Solo tiempo real".
- L4: Verify finding: dead channel on quick resubscribe (station switch), N+1 signals on cascades, listener leak, debounce postponement — all fixed.
