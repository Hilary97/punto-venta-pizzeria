-- Raise the product variants limit from 8 to 15. The other rules stay: each
-- entry trimmed, non-blank, <= 40 chars, no case-insensitive duplicates.
-- Loosening only, so every existing product still passes products_variants_valid.
create or replace function public.product_variants_valid(p_variants text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_variants is not null
    and coalesce(array_length(p_variants, 1), 0) <= 15
    and not exists (
      select 1 from unnest(p_variants) as v
      where v is null or v <> btrim(v) or v = '' or length(v) > 40
    )
    and (
      select count(distinct lower(v)) = count(*) from unnest(p_variants) as v
    );
$$;
