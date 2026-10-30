# Feature: Double extra ingredient in "Armar pizza"

Branch: `feat/pizza-double-extra` (from `main` `c294025`)
An extra ingredient can be added twice to the same portion; it is charged twice and shown as "Extra <ingrediente>".

## Specs

- S1: User request: "En armar pizza vamo agregar que podamos agregar dos veces el mismo ingrediente para cuando se pida extra de ingrediente, se cobrara las dos veces, y para indentificar que es es extra del ingredienet cambiara de color el ingrediente con otro contexto que indica el extra de ese ingrediente."
- S2: User decision (interaction): "Tocar ciclo: 1 → 2 → quitar" — "1er toque: extra (rojo). 2do toque: doble extra (otro color + leyenda), se cobra 2 veces. 3er toque: se quita."
- S3: User decision (description): "Que aparesca Extra(ingrediente-selecioando)" — a doubled extra ingredient is described as `Extra Jalapeños`; a single one stays `Jalapeños`. Example: `Pizza Chica: Estilo Varas + Extra Jalapeños`.
- S4: User decision (limit): "Sí, máximo 2" — "Normal o doble; el servidor rechaza 3 o más."
- S5: The server charges the extra ingredient price once per occurrence (doubled = 2 × `extra_ingredient_cents`). More than 2 of the same extra ingredient in a portion → 'Un ingrediente extra se puede pedir hasta 2 veces por porción.' Included ingredients still cannot repeat ('Los ingredientes de una porción no se pueden repetir.').

## Design notes

- Data: the doubled ingredient appears twice in `extra_ingredient_ids`; no new column. `price_pizza` already counts array elements.
- Migration `20261119120000_pizza_double_extra_ingredient.sql` replaces `validate_pizza` (allow ≤2, canonical keeps repeats in catalog order) and `describe_pizza` (one entry per ingredient, `Extra ` prefix when doubled). Client mirrors in `pizza.ts`.
- The user applies the migration by hand in the Supabase SQL Editor, then deploys the frontend.

## Tasks

- T1 (S3, S4, S5) — migration + PGlite tests. Route: inline. Commit: pending.
- T2 (S2, S3, S4, S5) — builder: domain validation/description, `toggleExtra` cycle, chip color + "Extra" hint, tests. Route: inline. Commit: pending.

## Log

- L1: "En armar pizza vamo agregar que podamos agregar dos veces el mismo ingrediente para cuando se pida extra de ingrediente, se cobrara las dos veces, y para indentificar que es es extra del ingredienet cambiara de color el ingrediente con otro contexto que indica el extra de ese ingrediente."
- L2: Answers: interacción "Tocar ciclo: 1 → 2 → quitar (Recomendado)"; texto "Que aparesca Extra(ingrediente-selecioando)"; límite "Sí, máximo 2 (Recomendado)".
