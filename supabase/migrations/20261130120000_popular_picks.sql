-- Más vendidas mixes pizzas and products (see odd/tasks/popular-products.md).
-- popular_picks(p_limit) returns the valid fixed admin pizzas first, then the best-selling pizzas
-- and products (one per product and variant) of paid orders of the last 30 days, most sold first,
-- ties by the most recent sale. Items:
--   {kind:'pizza', pizza:<canonical config>, sold:int|null}
--   {kind:'product', product_id:uuid, variant:text|null, sold:int}
-- Inactive, sold-out, deleted and legacy pizza products are skipped, and so are variants the
-- product no longer offers. Pizzas (fixed and best sellers) of a size with no dough left in the
-- current dough shift are skipped too, like the app does (no configured limit means available).
-- The list RPCs return 16 so the app can still fill 8 tiles after it
-- drops anything that went stale since. The older popular_pizzas RPCs are kept for older clients.

-- Same rule as list_pizza_dough_left and the app's isSizeSoldOut: only a row of the current dough
-- shift with nothing left (prepared - used <= 0) is sold out; no row means no limit.
create or replace function public.pizza_size_has_dough(p_size text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.pizza_dough_days d
    where d.shift_id = public.pizza_dough_shift()
      and d.size_code = p_size
      and d.prepared - d.used <= 0
  )
$$;
revoke all on function public.pizza_size_has_dough(text) from public, anon, authenticated;

create or replace function public.popular_picks(p_limit integer default 16)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_config jsonb;
  v_key text;
  v_fixed jsonb := '[]'::jsonb;
  v_fixed_keys text[] := '{}';
  v_acc jsonb := '{}'::jsonb;
  v_left integer;
begin
  for v_row in select pizza from public.pizza_quick_picks order by sort_order, created_at loop
    begin
      v_config := public.validate_pizza(v_row.pizza);
    exception when others then
      continue;
    end;
    if not public.pizza_size_has_dough(v_config ->> 'size') then
      continue;
    end if;
    if not (v_config::text = any (v_fixed_keys)) then
      v_fixed_keys := v_fixed_keys || v_config::text;
      v_fixed := v_fixed || jsonb_build_array(jsonb_build_object('kind', 'pizza', 'pizza', v_config, 'sold', null));
    end if;
  end loop;

  v_left := p_limit - jsonb_array_length(v_fixed);
  if v_left <= 0 then
    return v_fixed;
  end if;

  -- Pizzas: grouped by their canonical config, so legacy stored shapes merge.
  for v_row in
    select oi.pizza, sum(oi.quantity)::integer as sold, max(o.paid_at) as last_paid_at
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.status = 'paid'
      and o.paid_at >= now() - interval '30 days'
      and oi.item_type = 'pizza'
      and oi.pizza is not null
    group by oi.pizza
  loop
    begin
      v_config := public.validate_pizza(v_row.pizza);
    exception when others then
      continue;
    end;

    if not public.pizza_size_has_dough(v_config ->> 'size') then
      continue;
    end if;

    v_key := 'pizza:' || v_config::text;
    if v_config::text = any (v_fixed_keys) then
      continue;
    end if;
    if v_acc ? v_key then
      v_acc := jsonb_set(
        v_acc,
        array[v_key],
        jsonb_build_object(
          'item', jsonb_build_object('kind', 'pizza', 'pizza', v_config),
          'sold', (v_acc -> v_key ->> 'sold')::integer + v_row.sold,
          'last_paid_at', greatest((v_acc -> v_key ->> 'last_paid_at')::timestamptz, v_row.last_paid_at)
        )
      );
    else
      v_acc := v_acc || jsonb_build_object(
        v_key,
        jsonb_build_object(
          'item', jsonb_build_object('kind', 'pizza', 'pizza', v_config),
          'sold', v_row.sold,
          'last_paid_at', v_row.last_paid_at
        )
      );
    end if;
  end loop;

  -- Products: one entry per product and its current spelling of the variant.
  v_acc := v_acc || coalesce(
    (
      select jsonb_object_agg(
        'product:' || s.product_id::text || ':' || coalesce(s.variant, ''),
        jsonb_build_object(
          'item', jsonb_build_object('kind', 'product', 'product_id', s.product_id, 'variant', s.variant),
          'sold', s.sold,
          'last_paid_at', s.last_paid_at
        )
      )
      from (
        select l.product_id, l.variant, sum(l.quantity)::integer as sold, max(l.paid_at) as last_paid_at
        from (
          select p.id as product_id,
                 case
                   when coalesce(cardinality(p.variants), 0) = 0 then null
                   else (select v from unnest(p.variants) v where lower(v) = lower(oi.variant) limit 1)
                 end as variant,
                 coalesce(cardinality(p.variants), 0) > 0 as has_variants,
                 oi.quantity,
                 o.paid_at
          from public.order_items oi
          join public.orders o on o.id = oi.order_id
          join public.products p on p.id = oi.product_id
          join public.categories c on c.id = p.category_id
          where o.status = 'paid'
            and o.paid_at >= now() - interval '30 days'
            and oi.item_type = 'product'
            and p.active
            and not coalesce(c.legacy_pizza, false)
            and not (coalesce(p.track_stock, false) and coalesce(p.stock, 0) <= 0)
        ) l
        where not l.has_variants or l.variant is not null
        group by l.product_id, l.variant
      ) s
    ),
    '{}'::jsonb
  );

  return v_fixed || coalesce(
    (
      select jsonb_agg((t.value -> 'item') || jsonb_build_object('sold', (t.value ->> 'sold')::integer) order by t.ord)
      from (
        select e.value,
               row_number() over (
                 order by (e.value ->> 'sold')::integer desc, (e.value ->> 'last_paid_at')::timestamptz desc, e.key
               ) as ord
        from jsonb_each(v_acc) e
      ) t
      where t.ord <= v_left
    ),
    '[]'::jsonb
  );
end;
$$;
revoke all on function public.popular_picks(integer) from public, anon, authenticated;

-- Signed-in admins and cashiers (the same people who can create orders from a session).
create or replace function public.list_popular_picks()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin', 'cashier') then
    raise exception 'No tienes permiso para ver los productos más vendidos.';
  end if;

  return public.popular_picks(16);
end;
$$;
revoke all on function public.list_popular_picks() from public, anon;
grant execute on function public.list_popular_picks() to authenticated;

-- Authorized waiter devices.
create or replace function public.device_list_popular_picks(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_waiter_device(p_device_secret);
  return public.popular_picks(16);
end;
$$;
revoke all on function public.device_list_popular_picks(text) from public;
grant execute on function public.device_list_popular_picks(text) to anon, authenticated;
