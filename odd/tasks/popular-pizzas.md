# Popular pizzas (pizzas rápidas)

Waiter Productos step shows the best-selling pizza configurations, computed automatically, above the product grid; one tap adds that pizza to the order.
Branch: feat/popular-pizzas. The user applies the migration in Supabase (CLI linked: `supabase db push`).

## Specs

- S1: "las mas vendidas calculadas solas" — the list is computed from paid orders (status 'paid') of the last 30 days, grouping identical pizza configurations (size, portions, styles, ingredients, extras, chiles; notes ignored) and summing quantities. Top 4, most sold first; ties: most recently sold first. Cancelled and open orders do not count.
- S2: A configuration that is no longer valid (inactive style, ingredient or extra, size without that style, bad portion count) is skipped, so the next one takes its place. Legacy stored shapes are normalized before grouping. A size with no dough left is not offered.
- S3: "al tocarlas que pasen directo ala comanda" — tapping a tile adds one pizza line to the draft, same as finishing the builder (name = pizza description, no notes); the builder does not open.
- S4: "aparecen arriba en la grilla de productos" — the tiles appear in Productos above the product grid, under a "Más vendidas" heading; with no sales the section is hidden.
- S6: "Podmos cambiar implemntar mejor agregar la  lista de pizzas en admin" + choice "Admin primero, completa con las más vendidas" — admins keep a fixed list of quick pizzas in Admin > Pizzas ("Pizzas rápidas"): add one by building it with the pizza builder, remove it, move it up or down. Up to 8 fixed pizzas. The waiter sees the fixed ones first in admin order, then best sellers (S1) fill the remaining places up to 4 total, skipping any already fixed. Invalid fixed pizzas are skipped for the waiter and shown as "No disponible" in Admin. The same pizza cannot be fixed twice.
- S5: Both waiter devices (device secret) and signed-in admin/cashier get the list; failing to load it never blocks the order screen. Only sale counts of pizzas are exposed, no money.

## Tasks

- T1 (S1, S2, S5) — migration `popular_pizzas` + RPCs `list_popular_pizzas()` (admin/cashier) and `device_list_popular_pizzas(secret)`, PGlite tests. Route: inline. Commit: `903710a` (done; PGlite RED 6/7 -> GREEN 7/7; db suite 407)
- T2 (S2-S5) — OrdersSource.loadPopularPizzas for both sources, Productos tiles, UI tests. Route: inline. Commit: `b58fab1` (done; RED 2/3 -> GREEN; 486 tests). Slice boundary: commits 1-2 ~508 lines; T2b is slice 2.
- T2b (S6) — fixed list: table + admin RPCs + merge into list RPCs, PGlite tests; Admin > Pizzas section, UI tests. Route: inline. Commit: `f43bbdc` (done; PGlite RED 7/7 -> GREEN 14/14; db suite 414; UI 358 green; full suite 1260, build OK; UI section RED not observed: the test failed on the missing module only)
- T3 (S1-S6) — verify (high risk: new security definer RPCs exposed to anon devices). Route: gentle-ai-verify. Done: PASS S1-S6; 372 focused tests, tsc 0, oxlint 12 (baseline); 11 extra scratch probes passed (grants, device kinds, 30-day boundary, legacy duplicate, exactly 4 fixed). Advisories: client hides sold-out/stale tiles after the server cut to 4, so fewer tiles can show; grants must be checked on real Supabase after db push. Commit: n/a

## Log

- L1: User: "Si vamos a aplicar las mas vendidas calculadas solas y al tocarlas que pasen directo ala comanda. Y aparecen arriba en la grilla de productos."
- L2: Defaults chosen by the agent (not asked): last 30 days, top 4, paid orders only. Adjustable.
- L3: User mid-task: "Podmos cambiar implemntar mejor agregar la  lista de pizzas en admin". Asked; user chose "Admin primero, completa con las más vendidas".
- L4: Agent defaults for S6: at most 8 fixed pizzas; total places 4 (fixed beyond 4 are all shown).
- L5: Verify PASS S1-S6, no blockers.
- L6: User: "Si aplica las dos migraciones, y reviso los cambio aquí en local y ya despues te digo cuando mergeas a main". Applied 20261127120000 and 20261128120000 with `supabase db push --remote --yes`; dry run then reports up to date. Read-only grant check on production: popular_pizzas and pizza_quick_picks closed to anon/authenticated; admin_* and list_popular_pizzas authenticated only; device_list_popular_pizzas anon+authenticated. Merge to main waits for the user.
