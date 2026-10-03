-- Wings require a sauce flavor, picked by the waiter like burger Res/Pollo.
-- Idempotent: products that already have variants are left untouched.
update public.products
set variants = '{Búfalo,BBQ,Mango-Habanero}'
where variants = '{}'
  and name = 'Alitas 5 pzas'
  and category_id in (select id from public.categories where name = 'Botanas');
