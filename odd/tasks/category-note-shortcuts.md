# Note shortcuts per product category

Admins keep a shortcut list per product category (Hamburguesas first); waiters tap them under a product line's note in Revisar.
Branch: feat/category-note-shortcuts, stacked on feat/pizza-portion-notes (PR #11); its own PR. Builds on odd/tasks/pizza-portion-notes.md (S5-S8), whose migrations are already in production, so this needs a NEW migration.

## Specs

- S1: User: "Muy bien vamos agregar atajos  para las notas de hambuerguesa tambien" + choice "Por categoría (Recomendado)" — "En Admin elegís la categoría (Hamburguesas, Botanas, Bebidas preparadas…) y le armás su lista. Hoy cargás solo Hamburguesas; mañana 'Sin hielo' para bebidas sin otra migración. Una categoría sin atajos no muestra nada."
- S2: Admin: in Admin > Productos, a section "Atajos de notas por categoría" with a category picker; for the chosen category: add, remove, reorder (same rules as the pizza/order lists: trimmed, 1-40 chars, case-insensitive unique within that category, up to 12 per category, Spanish errors from the server). Deleting a category deletes its shortcuts.
- S3: Waiter: in Revisar, under a product line's note field ("Nota para …", MAX_ITEM_NOTES_LENGTH 200), the shortcuts of that product's category show as the same subtle chips (NoteShortcutChips: tap appends with ", ", tap again removes, free text stays, disabled when it would exceed the limit). Pizza lines keep using the builder's pizza shortcuts; the order note keeps the order list. A category without shortcuts, or a failed load, shows no chips.
- S4: Same read rules as before: admin/cashier session and waiter devices read labels only (now also per category); only admins write; anon otherwise denied; revoked/kitchen devices rejected. The existing pizza and order lists and their RPCs keep working unchanged for the app already in production.

## Tasks

- T1 (S1-S4) — migration 20261203120000_category_note_shortcuts.sql (category scope on pizza_note_shortcuts or equivalent, per-category uniqueness/cap, admin RPCs for a category, read RPCs return the category lists additively), PGlite tests; Admin > Productos section; chips in Revisar product line notes; tests. Route: gentle-ai-worker (context backstop). Done: category_id + scope 'category', admin_list/add_category_note_shortcut, admin_move_note_shortcut and note_shortcut_labels redefined (reads add `categories`); client RED observed, DB RED NOT observed; 1453 tests, tsc 0, oxlint 12, build OK. Commit: see PR (feat/category-note-shortcuts).
- T2 (S1-S4) — verify (high risk: new admin/anon-device RPC surface; redefining RPCs already used in production). Route: gentle-ai-verify. Done: PASS S1-S4; DB RED observed by the verifier (24 failed without the migration); upgrade from the production baseline keeps pizza/order rows and reads identical plus `categories: {}`; grants hold under Supabase default privileges. Advisory fixed by the parent: line category chips hidden while the order is sent (RED -> GREEN). Probes kept: supabase/tests/categoryNoteShortcutsUpgrade.test.ts, OrdersPage 'category note chips (verify probes)'. 1465 tests, tsc 0, oxlint 12, build OK. Commit: n/a.

## Log

- L1: "Muy bien vamos agregar atajos  para las notas de hambuerguesa tambien"
- L2: Answers: "¿Los atajos son solo para hamburguesas o para cualquier categoría de productos?" — "Por categoría (Recomendado)"; "¿Lo sumo al PR #11 que estás revisando o va en un PR aparte?" — "PR aparte (Recomendado)". Parent decision: the admin section lives in Admin > Productos, where categories are managed.
- L3: Verify T2 PASS; advisory (chips enabled while sending) fixed. Migration 20261203120000 NOT applied to production yet.
- L4: User: "si aplica la migracion" — 20261203120000_category_note_shortcuts.sql applied to production (dry-run first); grants and RLS checked there; the 5 existing pizza/order shortcuts kept, none with a category.
