-- Add the Naturales (no sauce) flavor to 5-piece wings.
-- Also normalizes the early misspelled seed (Bufalo, BQ, Mango-Abanero) in
-- case it was applied. Idempotent: custom variant lists are left untouched.
update public.products
set variants = '{Búfalo,BBQ,Mango-Habanero,Naturales}'
where variants in ('{Búfalo,BBQ,Mango-Habanero}', '{Bufalo,BQ,Mango-Abanero}')
  and name = 'Alitas 5 pzas'
  and category_id in (select id from public.categories where name = 'Botanas');
