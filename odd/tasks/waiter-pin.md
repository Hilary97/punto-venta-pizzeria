# Feature: Waiter PIN shifts

Branch: `feat/waiter-pin`

## Goal

Waiter devices sign in once with a `waiter` account. Each waiter then starts a shift
by picking their name and entering a 4-digit PIN; every order they register records
the waiter's name, shown in `/pedidos` and Venta. Admins manage waiters and PINs.

## Decisions

- The PIN never replaces authentication: all waiter RPCs still require `auth.uid()`.
- PIN asked at shift start; stays active on the device until "Cambiar mesero" or expiry.
- 4 digits; stored as bcrypt hash (pgcrypto, `extensions` schema on Supabase);
  5 failed attempts lock that waiter for 5 minutes.
- Name + PIN (not PIN-only), so PINs need not be unique and lockout is per waiter.
- Server-issued shift token (random uuid, 12h, bound to the device `auth.uid()`);
  `create_order` derives the waiter from the token, so a client cannot forge it.
- `orders.waiter_name` snapshot avoids exposing the `waiters` table to clients.
- Waiter-role callers must send a valid shift token to create orders; admin/cashier
  may create orders without one (takeout at the register).

## Tasks

- [x] 1. Migration: `waiters`, `waiter_shifts`, `orders.waiter_id/waiter_name`,
      admin RPCs, `list_active_waiters`, `start_waiter_shift`, `end_waiter_shift`,
      new `create_order` with shift token; types.
- [x] 2. Waiters domain + repository (PIN validation, shift storage) with tests.
- [x] 3. Admin `/admin/meseros` page (create, rename, reset PIN, activate, unlock) + nav.
- [x] 4. `/pedidos` PIN gate for waiters (name list + keypad), shift header,
      token sent on create, waiter name on order cards in `/pedidos` and Venta.

### Revision: authorized devices (no waiter accounts)

User decision: waiters never sign in with an account. An admin authorizes each
device once ("Usar como dispositivo de pedidos"): the server issues a long random
device secret (stored hashed), the admin session is signed out, and the device opens
`/pedidos` directly. Waiters pick name + PIN. All device RPCs are callable by `anon`
but require a valid, non-revoked device secret, so the internet cannot list waiters or
try PINs. Admins list and revoke devices in `/admin/meseros`.

- [x] 5. Migration: `order_devices`, shifts bound to device, anon device RPCs
      (waiters, shift start/get/end, catalog without prices, open orders,
      create/add/cancel), admin register/list/revoke device; `create_order` for
      authenticated admin/cashier only; types.
- [x] 6. Device storage + device repository + orders data-source abstraction, tests.
- [x] 7. `/pedidos` outside `RequireAuth`: device mode (gate + workspace via device
      source, no app nav) vs signed-in admin/cashier; remove waiter-account gate.
- [x] 8. Admin devices section: authorize this device (then sign out), list, revoke.

## Evidence

- Task 1: `653a40c` — tsc ok; crypt/gen_salt extensions-qualified; no-profile callers rejected in create_order; SQL not executed.
- Task 2: `441e33d` — RED (missing modules) → GREEN 195; tsc 0 (fixtures got waiterName).
- Task 3: `29e9a2e` — RED (missing page) → GREEN 203; tsc 0; 1 lint warning matching AdminProductsPage pattern.
- Task 4: `7184f29` — RED (missing gate, 8 OrdersPage failures) → GREEN 218; tsc 0; build ok. Known: draft lost on shift expiry; network error during verify re-asks PIN.
- Tasks 5-7: `35be3cd` (single commit: migration removes RPCs the old data layer and UI used, so splitting would leave non-compiling commits) — RED (missing modules) → GREEN 238; tsc 0; build 0; lint warnings only. SQL not executed.
- Task 8: `c0b5b80` — RED (missing section) → GREEN 245; tsc 0; build 0.

## Pending (user)

- Merge/deploy, then apply migrations 20261003120000 and 20261003130000 in Supabase right after the deploy finishes (old UI cannot create orders once applied).
- Create waiters with PINs in `/admin/meseros`.
- On each waiter device: sign in as admin, "Usar este dispositivo para pedidos".
