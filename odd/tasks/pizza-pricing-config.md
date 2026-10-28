# Feature: Configurable elaboration fee and pizza price tiers

Branch: `feat/pizza-pricing-config` (from `main` `7928f32`)
The split elaboration fee (hardcoded $10/$20/$30 in `price_pizza`) becomes three admin-editable amounts, and the style list is normalized into four price tiers.

## Specs

- S1: "Tres montos separados (Recomendado)" — `pizza_settings` stores three fees: halves, thirds and quarters, defaulting to $10 / $20 / $30 (1000 / 2000 / 3000 cents). `price_pizza` charges the fee for the number of portions instead of the hardcoded `(portions - 1) * 1000`. The rest of the rule from `20261114120000` stays: distinct-style average rounded up to $10; whole pizzas and single-style splits pay no fee; extras on top.
- S2: Admin > Pizzas shows the three fees ("Cargo por elaboración": Mitades, Tercios, Cuartos) with an edit modal, like the extra-ingredient price. Only admins can change them (existing `pizza_settings` RLS). A fee may be $0 (turns it off); invalid or negative input is rejected and nothing is saved.
- S3: "Subir al nivel más cercano (Recomendado)" — a migration sets style prices to four tiers (chica / mediana / grande), never lowering a price:
  - Clásica 110/190/210: Arma tu combinación, Hawaiana, Italiana, Pepperoni
  - Especial 120/200/230: Chuy's, Especial, El Primo
  - Premium 130/220/250: Varas, Suprema, Cuquío, Seis Carnes, Margarita, Cuatro Carnes, Mexicana, Vegetariana
  - De la casa 180/260/280: Chuley, El Ranchito
  Stored sale lines keep their price.

## Tasks

- T1 (S1) — migration `20261115120000_pizza_split_fee_settings.sql`: fee columns + `price_pizza` reads them; PGlite tests. Route: inline. Commit: d02b7ee (done; RED 11 failing -> GREEN 11, supabase suite 365/365).
- T2 (S2) — admin UI: domain schema, repository, modal, page section, types; tests. Route: gentle-ai-worker (context backstop). Commit: see git log (feat(pizza): edit split elaboration fees from admin) (done; RED 8 failing -> GREEN 121 pizza tests).
- T3 (S3) — migration `20261116120000_pizza_style_price_tiers.sql` + PGlite test. Route: inline. Commit: ed939ec (done; RED 3 failing -> GREEN 3, supabase suite 368/368).
- T4 — verify: full tests, tsc, oxlint, build. Route: inline. Done: 1069 tests pass (91 files), tsc -b OK, oxlint 0 errors and the same 12 warnings as main (none in pizza), build OK. Commit: with T2.

## Log

- L1: "Si vamos a aplicar las mejoras opcionales" (the optional improvements: four price tiers, and the elaboration fee editable from the admin).
- L2: User chose "Tres montos separados (Recomendado)" for the fee and "Subir al nivel más cercano (Recomendado)" for the tiers.
- L3: Decision (agent default): a fee of $0 is allowed so a division can be charged without fee.
- L4: Discovery: seed sizes allow chica 1 portion only, mediana 1-2, grande 1-4.
