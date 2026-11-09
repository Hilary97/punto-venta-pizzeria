-- Marks the category that holds the legacy fixed pizza products (one product per style and size).
-- Pizzas are now sold and priced through the pizza builder; the screens hide this category by
-- this flag instead of matching its name, so renaming it does not bring the old pizzas back.
alter table public.categories
  add column if not exists legacy_pizza boolean not null default false;

update public.categories
set legacy_pizza = true
where lower(trim(name)) = 'pizzas';

-- Waiter devices load categories through this RPC: it now also sends the flag so they hide
-- the legacy pizzas too. Same body as 20261107120000_pizza_extras.sql plus legacy_pizza.
create or replace function public.device_list_catalog(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_waiter_device(p_device_secret);

  return jsonb_build_object(
    'categories',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', c.id, 'name', c.name, 'sort_order', c.sort_order, 'legacy_pizza', c.legacy_pizza)
          order by c.sort_order, c.name
        )
        from public.categories c
      ),
      '[]'::jsonb
    ),
    'products',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'category_id', p.category_id,
            'variants', to_jsonb(p.variants),
            'track_stock', p.track_stock,
            'stock', p.stock
          )
          order by p.name
        )
        from public.products p
        where p.active = true
      ),
      '[]'::jsonb
    ),
    'pizza',
    jsonb_build_object(
      'sizes',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'code', s.code,
              'name', s.name,
              'allowed_portions', to_jsonb(s.allowed_portions),
              'sort_order', s.sort_order,
              'dough_left', (
                select d.prepared - d.used from public.pizza_dough_days d
                where d.shift_id = public.pizza_dough_shift() and d.size_code = s.code
              )
            )
            order by s.sort_order
          )
          from public.pizza_sizes s
        ),
        '[]'::jsonb
      ),
      'styles',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', st.id,
              'name', st.name,
              'description', st.description,
              'kind', st.kind,
              'included_ingredients', st.included_ingredients,
              'sort_order', st.sort_order
            )
            order by st.sort_order, st.name
          )
          from public.pizza_styles st
          where st.active = true
        ),
        '[]'::jsonb
      ),
      'ingredients',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('id', i.id, 'name', i.name, 'sort_order', i.sort_order)
            order by i.sort_order, i.name
          )
          from public.pizza_ingredients i
          where i.active = true
        ),
        '[]'::jsonb
      ),
      'extras',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('id', x.id, 'name', x.name, 'sort_order', x.sort_order)
            order by x.sort_order, x.name
          )
          from public.pizza_extras x
          where x.active = true
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;
revoke all on function public.device_list_catalog(text) from public;
grant execute on function public.device_list_catalog(text) to anon, authenticated;
