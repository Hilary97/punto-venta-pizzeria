# Punto de Venta — Pizzería

A web point-of-sale (POS) app for a pizzeria: sell products, register cash-only
sales with change calculation, handle returns, and close the register (corte
de caja) at the end of a shift. Data is shared across devices through
Supabase, so a tablet at the counter and a phone in the kitchen see the same
open register.

## Stack

- Vite + React 19 + TypeScript (strict)
- Tailwind CSS 4 (`@tailwindcss/vite`)
- Supabase (Postgres + Auth) via `@supabase/supabase-js` v2
- React Router, Zod 4 for validation
- Vitest + Testing Library (domain logic is test-driven)
- `vite-plugin-pwa` (manifest only, so the app can be added to an iPhone/iPad home screen)

## Architecture

Screaming architecture by feature, with a container/presentational split
inside each feature's `ui/` folder:

```
src/
  features/
    auth/           login, session/profile context, RequireAuth, RequireRole
    products/       admin CRUD for categories/products
    sales/          cart, change calculation, POS screen, checkout modal
    returns/        return quantity validation, returns screen
    cash-register/  open register, corte de caja, cash session context
  shared/
    money.ts        cents-based arithmetic + MXN formatting
    supabase/       Supabase client, hand-written DB types, RPC helper
    ui/             Button, Input, Modal, MoneyText, Spinner, ErrorBanner
supabase/
  migrations/       hand-written SQL (schema, RLS, RPCs, trigger)
  seed.sql          sample categories/products
```

Each feature's `domain/` folder holds pure, unit-tested functions (money,
cart, change, returnable quantity, cash summary). `infrastructure/` wraps
Supabase calls. `ui/` has one container component per screen plus
presentational children.

**Money** is always an integer number of cents (`price_cents`,
`total_cents`, etc.) to avoid floating-point rounding errors. Currency is
MXN, timezone is `America/Mexico_City`, and there is a single shared
register (only one cash session can be open at a time).

## Security model

Sales, returns, and cash sessions are **never written directly** by the
client. They go through `SECURITY DEFINER` Postgres functions
(`create_sale`, `create_return`, `open_cash_session`, `close_cash_session`,
`get_cash_summary`) that:

- re-read prices from `products` on the server — a tampered client-side
  price is never trusted;
- validate business rules server-side (payment covers the total, return
  quantity does not exceed sold minus already-returned, only one open
  register);
- run with `search_path` pinned to `public` and check `auth.uid()` inside
  the function body.

Row Level Security is enabled on every table. `sales`, `sale_items`,
`returns`, `return_items`, and `cash_sessions` have **no** insert/update/
delete policies (writes only happen through the RPCs above), and
`INSERT`/`UPDATE`/`DELETE` grants on those tables are explicitly revoked
from `anon`/`authenticated` as defense in depth. See
`supabase/migrations/20260912120000_init.sql` for the full policy set.

## Prerequisites

- Node.js 24+ and npm
- A Supabase project ([supabase.com](https://supabase.com)) — the Supabase
  CLI/Docker are **not** required; the SQL in `supabase/` is applied by hand.

## Setup

```bash
npm install
cp env.sample .env
```

> This repo ships the env template as `env.sample` instead of `.env.example`
> because the sandbox this project was authored in blocks writing any
> `.env*` file. Rename/copy it to `.env.example` and/or `.env` locally —
> either name works the same way with Vite as long as your local `.env`
> exists with real values.

Fill in `.env` with your Supabase project's values (Project Settings → API):

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-public-key>
```

`VITE_SUPABASE_URL` must be the project's base URL (no `/rest/v1/` suffix) —
the Supabase client library appends the API path itself.

If these are missing, the app fails gracefully with a clear Spanish message
instead of crashing.

## Database setup

1. Create a Supabase project.
2. Apply the migration. Either:
   - **SQL editor**: open the Supabase dashboard → SQL Editor, paste the
     contents of `supabase/migrations/20260912120000_init.sql`, and run it.
     Then paste and run `supabase/seed.sql` for sample categories/products.
   - **Supabase CLI** (if you have it installed locally, unlike the
     environment this project was built in): `npx supabase link --project-ref <ref>`
     then `npx supabase db push`.
3. Create your first user by signing up through the app's login screen (or
   Authentication → Users → Add user in the dashboard). A `profiles` row is
   created automatically for every new `auth.users` row, defaulting to the
   `cashier` role.
4. Promote a user to `admin` with a plain SQL update (never hardcode
   credentials in a migration or seed file):

   ```sql
   update public.profiles
   set role = 'admin'
   where id = (select id from auth.users where email = 'owner@example.com');
   ```

5. If a user was created in Supabase Auth **before** the migration ran (or
   otherwise ended up without a matching `profiles` row), login fails with
   "Tu usuario no tiene un perfil registrado…". Backfill the missing rows
   with:

   ```sql
   insert into public.profiles (id, full_name, role)
   select id, '', 'cashier' from auth.users
   on conflict (id) do nothing;
   ```

## Scripts

```bash
npm run dev       # start the dev server
npm run test      # run Vitest once (pass -- --run explicitly in CI)
npm run lint      # oxlint
npm run build     # type-check (tsc -b) + production build
npm run preview   # preview the production build locally
```

## Deploying to Vercel

Deployment itself was intentionally left out of this build (no Vercel
project or Supabase cloud project was created here), but the repo is ready:

1. Import the repo into Vercel (framework preset: Vite).
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment
   variables in the Vercel project settings.
3. `vercel.json` already rewrites every route to `/index.html`, which this
   client-side-routed SPA needs (otherwise refreshing `/devoluciones` or any
   non-root route would 404).
4. After deploying, open the URL on iPhone, iPad, and a Windows browser to
   confirm the responsive POS/cart layout and the "Add to Home Screen" PWA
   install prompt.

## Manual end-to-end test plan

1. Log in as admin → create a category and a few products.
2. Log in as cashier on a second browser/device → confirm the cashier
   cannot reach `/admin/productos` or `/admin/historial`.
3. Open the register with a fondo of $500 → sell two items paying $1,000 →
   confirm the change shown is correct and the confirm button is disabled
   until enough cash is entered.
4. From the other device, confirm the sale is visible in Devoluciones →
   return one item → confirm the refund amount is correct and that
   returning more than was sold is rejected.
5. Corte de caja: confirm expected = fondo + ventas − devoluciones → enter
   counted cash → confirm the difference and that the session appears in
   the admin history after closing.
6. Try calling `create_sale` with a tampered price via the Supabase client
   directly (e.g. from the browser console) → confirm the server still
   charges the real DB price.

## Notes / known limitations

- Payment is cash-only, by design (no card/terminal integration).
- Only one cash register session may be open at a time (enforced by a
  partial unique index in Postgres), matching the single shared register.
- `src/shared/supabase/database.types.ts` was written by hand to match the
  migration, since `supabase gen types` requires the CLI/a linked project.
  Regenerate it once you have that available.
