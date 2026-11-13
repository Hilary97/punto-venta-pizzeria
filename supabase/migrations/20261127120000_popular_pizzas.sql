-- Popular pizzas ("Más vendidas"): the best-selling pizza configurations of the last 30 days,
-- offered as one-tap shortcuts above the product grid. Only paid orders count. Each stored
-- configuration is normalized through validate_pizza, so legacy shapes merge with current ones
-- and pizzas that are no longer valid (inactive style, ingredient or extra...) are skipped.
-- Line notes are not part of the configuration, so they are ignored. Exposes unit counts only.

create or replace function public.popular_pizzas(p_limit integer default 4)
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
  v_acc jsonb := '{}'::jsonb;
begin
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

    v_key := v_config::text;
    if v_acc ? v_key then
      v_acc := jsonb_set(
        v_acc,
        array[v_key],
        jsonb_build_object(
          'pizza', v_config,
          'sold', (v_acc -> v_key ->> 'sold')::integer + v_row.sold,
          'last_paid_at', greatest((v_acc -> v_key ->> 'last_paid_at')::timestamptz, v_row.last_paid_at)
        )
      );
    else
      v_acc := v_acc || jsonb_build_object(
        v_key,
        jsonb_build_object('pizza', v_config, 'sold', v_row.sold, 'last_paid_at', v_row.last_paid_at)
      );
    end if;
  end loop;

  return coalesce(
    (
      select jsonb_agg(jsonb_build_object('pizza', t.value -> 'pizza', 'sold', (t.value ->> 'sold')::integer) order by t.ord)
      from (
        select e.value,
               row_number() over (
                 order by (e.value ->> 'sold')::integer desc, (e.value ->> 'last_paid_at')::timestamptz desc
               ) as ord
        from jsonb_each(v_acc) e
      ) t
      where t.ord <= p_limit
    ),
    '[]'::jsonb
  );
end;
$$;
revoke all on function public.popular_pizzas(integer) from public, anon, authenticated;

-- Signed-in admins and cashiers (the same people who can create orders from a session).
create or replace function public.list_popular_pizzas()
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
    raise exception 'No tienes permiso para ver las pizzas más vendidas.';
  end if;

  return public.popular_pizzas(4);
end;
$$;
revoke all on function public.list_popular_pizzas() from public, anon;
grant execute on function public.list_popular_pizzas() to authenticated;

-- Authorized waiter devices.
create or replace function public.device_list_popular_pizzas(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_waiter_device(p_device_secret);
  return public.popular_pizzas(4);
end;
$$;
revoke all on function public.device_list_popular_pizzas(text) from public;
grant execute on function public.device_list_popular_pizzas(text) to anon, authenticated;
