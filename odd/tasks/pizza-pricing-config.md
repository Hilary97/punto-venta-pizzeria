# Feature: Configurable elaboration fee

Branch: `feat/pizza-pricing-config` (from `main` `7928f32`)
The split elaboration fee (hardcoded $10/$20/$30 in `price_pizza`) becomes three admin-editable amounts. Style prices stay as they are.

## Specs

- S1: "Tres montos separados (Recomendado)" — `pizza_settings` stores three fees: halves, thirds and quarters, defaulting to $10 / $20 / $30 (1000 / 2000 / 3000 cents). `price_pizza` charges the fee for the number of portions instead of the hardcoded `(portions - 1) * 1000`. The rest of the rule from `20261114120000` stays: distinct-style average rounded up to $10; whole pizzas and single-style splits pay no fee; extras on top.
- S2: Admin > Pizzas shows the three fees ("Cargo por elaboración": Mitades, Tercios, Cuartos) with an edit modal, like the extra-ingredient price. Only admins can change them (existing `pizza_settings` RLS). A fee may be $0 (turns it off); invalid or negative input is rejected and nothing is saved.
- S3: Dropped (L5). No style price is changed in code; the user adjusts prices from the admin.

## Tasks

- T1 (S1) — migration `20261115120000_pizza_split_fee_settings.sql`: fee columns + `price_pizza` reads them; PGlite tests. Route: inline. Commit: d02b7ee (done; RED 11 failing -> GREEN 11, supabase suite 365/365).
- T2 (S2) — admin UI: domain schema, repository, modal, page section, types; tests. Route: gentle-ai-worker (context backstop). Commit: d0e603f (done; RED 8 failing -> GREEN 121 pizza tests).
- T3 (S3) — dropped (L5). The tier migration commit ed939ec was removed from the unpushed branch.
- T4 — verify: full tests, tsc, oxlint, build. Route: inline. Done: 1069 tests pass with T3; after dropping T3, 1066 tests pass (90 files) and tsc -b OK; oxlint 0 errors and the same 12 warnings as main (none in pizza), build OK. Commit: this one.

## Log

- L1: "Si vamos a aplicar las mejoras opcionales" (the optional improvements: four price tiers, and the elaboration fee editable from the admin).
- L2: User chose "Tres montos separados (Recomendado)" for the fee and "Subir al nivel más cercano (Recomendado)" for the tiers.
- L3: Decision (agent default): a fee of $0 is allowed so a division can be charged without fee.
- L4: Discovery: seed sizes allow chica 1 portion only, mediana 1-2, grande 1-4.
- L5: "Bueno no toques los precios así como estan dejamelos para yo tocarlos desde el admin vamos a descartar eso de migración de niveles"
