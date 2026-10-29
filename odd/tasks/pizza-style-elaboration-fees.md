# Feature: Elaboration fee per style

Branch: `feat/pizza-style-elaboration-fees` (from `main` `1130afe`)
Each style gets its own halves, thirds and quarters elaboration fee, edited in the style form. Replaces the global fees and the "Cobra elaboración" mark.

## Specs

- S1: "que se pueda edtiar por estilo el precio por elaboración asi como esta en mitades, tercios y cuartos" — `pizza_styles` stores three fees (halves, thirds, quarters, in cents, 0 to 10,000,000). A fee of $0 means the style charges nothing for that split. `admin_save_pizza_style` takes `p_split_fees` (`{"halves", "thirds", "quarters"}`) instead of `p_charges_elaboration`: null keeps the stored fees on update and gives a new style $0 fees; an invalid fee is rejected with "El cargo por elaboración de Mitades|Tercios|Cuartos no es válido." and nothing is saved.
- S2: "Solo un cobro por elabarión por pieza" — a split pizza with different styles pays one fee: the highest fee among its styles for its number of portions. Distinct-style average, its rounding, whole and single-style pizzas and extras are unchanged.
- S3: "Reemplazar (Recomendado)" — the global fees section and the "Cobra elaboración al dividir" checkbox are removed from the admin. The migration seeds each style from today's rule (marked style: current global fees; unmarked: $0) so no price changes when it runs. The old columns stay in the database, unused.
- S4: Admin > Pizzas: the style form has "Cargo por elaboración" inputs Mitades, Tercios, Cuartos (MXN); the styles table shows each style's fees, or "Sin cargo por elaboración" when all three are $0.

## Tasks

- T1 (S1-S3) — migration `20261118120000_pizza_style_split_fees.sql` + PGlite tests; replaces the superseded `pizzaElaborationFee` and `pizzaStyleElaborationFlag` tests. Route: inline. Commit: this one (RED 16 failing -> GREEN 20; supabase suite 374/374).
- T2 (S1, S3-S4) — app: domain schema, repository, style form, page, types; remove global fees modal; tests. Route: inline. Commit: this one (RED 8 domain/repo + whole page suite failing -> GREEN 122 pizza tests; tsc -b OK).
- T3 — verify: full tests, tsc, oxlint, build. Route: inline. Done: 1076 tests pass (90 files), tsc -b OK, oxlint 0 errors and the same 12 warnings as main (none in pizza), build OK. Independent verifier not admitted by the runtime; RDD assess: medium, reviewDue false. Commit: this one.

## Log

- L1: "Vamos a ver entonces en el ultimo cambio que hubo se agrego que por estilo se hiba a gregar costo de elaboración me gustaria que tambien se pueda edtiar por estilo el precio por elaboración asi como esta en mitades, tercios y cuartos"
- L2: "No a lo que me refiero es que se pueda editar por estilo cuanot se cobra por elaboración personalizado en lugar de global se entiende?? que si ha al estilo que se le agregue el costo de elaboración personalizado al aplicarlo en mitades tercios y cuartos se le agreue ese costo personaliado?" Global fees: "Reemplazar (Recomendado)".
- L3: "Solo un cobro por elabarión por pieza". Decision (agent default, user may change): the one fee is the highest among the pizza's styles.
