# Feature: Product variants (burger Res/Pollo)

Branch: `feat/product-variants` (stacked on `feat/pizza-builder`, from `0bb7c5e`)

## Goal

Products can require a choice among variants. First use: every burger in the
`Hamburguesas` category requires "Res" or "Pollo". The waiter picks the variant when
adding the product; it is stored on the order line and shown in orders, caja, sales
and returns as `Hamburguesa Monster sencilla (Pollo)`.

## Decisions (user)

- Variant is a required choice; same price for every variant.
- Modeled as product variants (not duplicated products); admin can configure them per
  product.

## Design notes

- `products.variants text[] not null default '{}'`; `order_items.variant text null`.
- `insert_order_lines` requires a variant when the product has variants, rejects one
  otherwise; merge-by-quantity key includes `coalesce(variant, '')`.
- `order_items.product_name` stays the base name; `order_lines_priced` appends
  ` (Variant)`, so quote, sale items and returns inherit it.
- Legacy lines with null variant stay payable; validation only at insert.
- New migration file; the pizza-builder migration is not edited.
- Seed: burgers in category `Hamburguesas` get `{Res,Pollo}` when they have no variants.

## Tasks

- [x] 1. Migration + PGlite tests: columns, merge index, insert_order_lines,
      order_lines_priced, device catalog/open orders, burger seed.
- [x] 2. Domain + repositories + types: product variants, order line variant, draft
      merge rule, payloads, device mapping.
- [ ] 3. Waiter UI: variant picker on product tap; show variant in draft, open
      orders and pending orders.
- [ ] 4. Admin: edit variants in the product form; show them in the products table.

## Evidence

- Task 1: `9a32b98` — migration `20261006120000_product_variants.sql` (columns + checks, coalesce merge index, insert_order_lines, order_lines_priced suffix, device RPCs, burger seed); RED observed (14/14 failing on missing column); 14 variants tests green; 359 tests (36 files); tsc 0. `create_sale` has no UI caller (dead path), so it cannot bypass variants.
- Task 2: `906ee5a` — Product.variants + form schema + parseVariantsInput, OrderItem.variant, productLineLabel, draft merge by variant, payload/row/device mapping; RED observed (12 tests); 371 tests (37 files); tsc 0; lint 0 errors. Until task 4, admin product saves write `variants: []`.

## Pending (user)

- Apply the new migration in Supabase together with the deploy (after the pizza-builder
  migration).
