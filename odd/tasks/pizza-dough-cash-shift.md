# Feature: Pizza dough limit resets on cash close

Branch: `feat/pizza-dough-cash-shift` (from `main` `fc79c34`)
The daily dough limit (odd/tasks/pizza-dough.md) stops depending on the 05:00 clock: it belongs to a "dough shift" that ends when the cash register is closed. The pizza-dough migration is already applied in production, so this is a new migration that converts existing data.

## Specs

- S1: User request: "Si pues los horarios laborales no son precisos mejor cuando se reinicie la caja que se termino la venta que se reincie el limite de las pizzas"
- S2: Closing the cash register (`close_cash_session`) starts a new dough shift; the new shift has no rows, so every size is unlimited ("sin límite") until the admin loads doughs again. The clock (05:00) no longer changes anything: a register left open past 05:00 keeps its limit.
- S3: Doughs loaded while no register is open (e.g. in the morning before opening) belong to the current shift, which continues once the register opens. Closing and reopening the register mid-day (shift change) also resets the limit (told to the user).
- S4: Cancelling an order gives the dough back to the shift that supplied it, even after the register was closed.
- S5: Existing data migrates without loss: today's loaded rows stay the current limit, past business days become past shifts, and open orders that took dough still give it back on cancel. Deleting a cash session never changes the current shift.
- S6: Admin "Masas del día" section shows when the current shift started instead of the business day, and states that the doughs reset when the register is closed.

## Design notes

- New table `pizza_dough_shifts (id bigint identity primary key, started_at timestamptz not null default now(), business_day date null)`; the current shift is `max(id)`. `business_day` is set only on shifts created from legacy rows. Admin read only; no direct writes.
- An `after update` trigger on `cash_sessions` inserts a new shift when `closed_at` goes from null to not null (no restatement of `close_cash_session`; does not depend on sessions that can be deleted).
- `pizza_dough_days`: add `shift_id bigint references pizza_dough_shifts`, backfill, set not null, primary key `(shift_id, size_code)`; `business_day` becomes nullable legacy. `order_items`: add `dough_shift bigint`, backfill from `dough_day`; `dough_day` stays as legacy.
- Backfill: one shift per distinct legacy business_day in date order; if no legacy row is on `pizza_business_day()` (today), add a fresh empty shift last so today stays unlimited.
- Restated: `insert_order_lines`, `cancel_order_core`, `device_list_catalog`, `admin_set_pizza_dough`, `admin_list_pizza_dough` (returns `shift_started_at` instead of `business_day`), `list_pizza_dough_left`. Only the dough key changes; lock order stays products (id) -> dough rows (size_code); cancel: dough rows (shift_id, size_code).

## Tasks

- T1 (S2-S5) — migration `20261024120000_pizza_dough_cash_shift.sql` + PGlite tests (update pizzaDough.test.ts, add backfill test). Route: inline. Commit: pending.
- T2 (S6) — admin UI + repository: `shiftStartedAt`, subtitle. Route: inline. Commit: pending.
- T3 (S1-S6) — verify (high risk: data format change, order writes). Route: gentle-ai-verify. Commit: n/a.

## Log

- L1: "Vamos a en el fueature de cargar masas en el día como funciona. Al cerrar cajas se vuelve a poner sin limite o que hace que cambie a sin limite?"
- L2: "Si pues los horarios laborales no son precisos mejor cuando se reinicie la caja que se termino la venta que se reincie el limite de las pizzas"
- L3: Migration 20261023120000_pizza_dough.sql already applied in production ("Sí, ya está aplicada"): new migration converting data.
