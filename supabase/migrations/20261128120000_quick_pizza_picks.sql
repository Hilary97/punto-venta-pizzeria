-- Fixed quick pizzas chosen in Admin > Pizzas ("Pizzas rápidas"). The waiter sees them first,
-- in admin order, and the best sellers of the last 30 days fill the remaining places up to 4.
-- Only admins read or change the table, through the RPCs below.

create table if not exists public.pizza_quick_picks (
  id uuid primary key default gen_random_uuid(),
  -- Canonical configuration, as returned by validate_pizza.
  pizza jsonb not null unique,
  sort_order integer not null,
  created_at timestamptz not null default now()
);
alter table public.pizza_quick_picks enable row level security;
revoke all on table public.pizza_quick_picks from public, anon, authenticated;

create or replace function public.admin_list_quick_pizzas()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.pizza_quick_picks;
  v_available boolean;
  v_result jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede editar las pizzas.';
  end if;

  for v_row in select * from public.pizza_quick_picks order by sort_order, created_at loop
    begin
      perform public.validate_pizza(v_row.pizza);
      v_available := true;
    exception when others then
      v_available := false;
    end;
    v_result := v_result || jsonb_build_array(
      jsonb_build_object('id', v_row.id, 'pizza', v_row.pizza, 'available', v_available)
    );
  end loop;
  return v_result;
end;
$$;

create or replace function public.admin_add_quick_pizza(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede editar las pizzas.';
  end if;

  v_config := public.validate_pizza(p_config);

  -- Serializes concurrent adds so the limit and the order hold.
  perform pg_advisory_xact_lock(hashtext('public.pizza_quick_picks'));

  if exists (select 1 from public.pizza_quick_picks where pizza = v_config) then
    raise exception 'Esa pizza ya está en la lista.';
  end if;
  if (select count(*) from public.pizza_quick_picks) >= 8 then
    raise exception 'Puedes fijar hasta 8 pizzas rápidas.';
  end if;

  insert into public.pizza_quick_picks (pizza, sort_order)
  values (v_config, coalesce((select max(sort_order) from public.pizza_quick_picks), 0) + 1)
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_delete_quick_pizza(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede editar las pizzas.';
  end if;

  delete from public.pizza_quick_picks where id = p_id;
  return jsonb_build_object('id', p_id);
end;
$$;

-- p_direction: -1 moves the pizza up one place, 1 moves it down. At either end it stays put.
create or replace function public.admin_move_quick_pizza(p_id uuid, p_direction integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_pos integer;
  v_target integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede editar las pizzas.';
  end if;
  if p_direction not in (-1, 1) then
    raise exception 'Dirección inválida.';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.pizza_quick_picks'));

  select array_agg(id order by sort_order, created_at) into v_ids from public.pizza_quick_picks;
  v_pos := array_position(v_ids, p_id);
  if v_pos is null then
    raise exception 'Esa pizza ya no está en la lista.';
  end if;

  v_target := v_pos + p_direction;
  if v_target >= 1 and v_target <= array_length(v_ids, 1) then
    v_ids[v_pos] := v_ids[v_target];
    v_ids[v_target] := p_id;
  end if;

  update public.pizza_quick_picks q
  set sort_order = o.ord
  from unnest(v_ids) with ordinality as o(id, ord)
  where q.id = o.id;

  return jsonb_build_object('id', p_id);
end;
$$;

revoke all on function public.admin_list_quick_pizzas() from public, anon;
revoke all on function public.admin_add_quick_pizza(jsonb) from public, anon;
revoke all on function public.admin_delete_quick_pizza(uuid) from public, anon;
revoke all on function public.admin_move_quick_pizza(uuid, integer) from public, anon;
grant execute on function public.admin_list_quick_pizzas() to authenticated;
grant execute on function public.admin_add_quick_pizza(jsonb) to authenticated;
grant execute on function public.admin_delete_quick_pizza(uuid) to authenticated;
grant execute on function public.admin_move_quick_pizza(uuid, integer) to authenticated;

-- Same as 20261127120000_popular_pizzas.sql, now led by the valid fixed pizzas. Best sellers fill
-- the remaining places up to p_limit, skipping any pizza already fixed.
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
    if not (v_config::text = any (v_fixed_keys)) then
      v_fixed_keys := v_fixed_keys || v_config::text;
      v_fixed := v_fixed || jsonb_build_array(jsonb_build_object('pizza', v_config, 'sold', null));
    end if;
  end loop;

  v_left := p_limit - jsonb_array_length(v_fixed);
  if v_left <= 0 then
    return v_fixed;
  end if;

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
    if v_key = any (v_fixed_keys) then
      continue;
    end if;
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

  return v_fixed || coalesce(
    (
      select jsonb_agg(jsonb_build_object('pizza', t.value -> 'pizza', 'sold', (t.value ->> 'sold')::integer) order by t.ord)
      from (
        select e.value,
               row_number() over (
                 order by (e.value ->> 'sold')::integer desc, (e.value ->> 'last_paid_at')::timestamptz desc
               ) as ord
        from jsonb_each(v_acc) e
      ) t
      where t.ord <= v_left
    ),
    '[]'::jsonb
  );
end;
$$;
revoke all on function public.popular_pizzas(integer) from public, anon, authenticated;
