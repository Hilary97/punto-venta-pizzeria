# Feature: Elaboration fee per style

Branch: `feat/pizza-style-elaboration-fees` (from `main` `1130afe`)
Each style gets its own halves, thirds and quarters elaboration fee, edited in the style form. Replaces the global fees; the "Cobra elaboración" checkbox turns the style's fee on or off.

## Specs

- S1: "que se pueda edtiar por estilo el precio por elaboración asi como esta en mitades, tercios y cuartos" — `pizza_styles` stores three fees (halves, thirds, quarters, in cents, 0 to 10,000,000). A fee of $0 means the style charges nothing for that split. `admin_save_pizza_style` takes `p_split_fees` (`{"halves", "thirds", "quarters"}`) and keeps `p_charges_elaboration`: null keeps the stored fees and mark on update; a new style gets $0 fees and is not marked; an invalid fee is rejected with "El cargo por elaboración de Mitades|Tercios|Cuartos no es válido." and nothing is saved.
- S2: "Solo un cobro por elabarión por pieza" — a split pizza with different styles pays one fee: the highest fee, for its number of portions, among its styles whose "Cobra elaboración" is on (S5). Distinct-style average, its rounding, whole and single-style pizzas and extras are unchanged.
- S3: "Reemplazar (Recomendado)" — the global fees section is removed from the admin. The migration gives every style today's global fees and keeps its mark, so no price changes when it runs. `pizza_settings.split_*_fee_cents` stays in the database, unused.
- S4: Admin > Pizzas: the style form has the "Cobra elaboración al dividir" checkbox and "Cargo por elaboración" inputs Mitades, Tercios, Cuartos (MXN), disabled while the checkbox is off; the styles table shows each style's fees, or "Sin cargo por elaboración" when the checkbox is off.
- S5: "Se puede dejar el checlist para activar y desactivar el cobro por elaboracion que remplace mejor el $0 para desactive?" — `pizza_styles.charges_elaboration` turns the style's fee on or off; an unmarked style charges nothing whatever its amounts, and its amounts are kept.

## Tasks

- T1 (S1-S3) — migration `20261118120000_pizza_style_split_fees.sql` + PGlite tests; replaces the superseded `pizzaElaborationFee` and `pizzaStyleElaborationFlag` tests. Route: inline. Commit: this one (RED 16 failing -> GREEN 20; supabase suite 374/374).
- T2 (S1, S3-S4) — app: domain schema, repository, style form, page, types; remove global fees modal; tests. Route: inline. Commit: this one (RED 8 domain/repo + whole page suite failing -> GREEN 122 pizza tests; tsc -b OK).
- T4 (S1-S5) — bring back the checkbox: migration edited in place (unpublished), app, tests. Route: DB inline (RED 27 -> GREEN, supabase 376/376); app gentle-ai-worker (context backstop; RED 7 -> GREEN 125, tsc OK). Commit: this one.
- T3 — verify: full tests, tsc, oxlint, build. Route: inline. Done: 1076 tests pass (90 files), tsc -b OK, oxlint 0 errors and the same 12 warnings as main (none in pizza), build OK. Independent verifier not admitted by the runtime; RDD assess: medium, reviewDue false. Commit: this one.

## Log

- L1: "Vamos a ver entonces en el ultimo cambio que hubo se agrego que por estilo se hiba a gregar costo de elaboración me gustaria que tambien se pueda edtiar por estilo el precio por elaboración asi como esta en mitades, tercios y cuartos"
- L2: "No a lo que me refiero es que se pueda editar por estilo cuanot se cobra por elaboración personalizado en lugar de global se entiende?? que si ha al estilo que se le agregue el costo de elaboración personalizado al aplicarlo en mitades tercios y cuartos se le agreue ese costo personaliado?" Global fees: "Reemplazar (Recomendado)".
- L3: "Solo un cobro por elabarión por pieza". Decision (agent default, user may change): the one fee is the highest among the pizza's styles.
- L4: "Se puede dejar el checlist para activar y desactivar el cobro por elaboracion que remplace mejor el $0 para desactive?" Decision: edit the unpublished migration 20261118120000 in place; every style is seeded with the global fees so turning the checkbox on has amounts.
