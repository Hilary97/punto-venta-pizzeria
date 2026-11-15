-- Note shortcuts: "Bien cocida", "Sin cebolla" for pizzas and "Pagan con $500", "Cubiertos" for the whole
-- order, managed in Admin > Pizzas. The waiter taps them to fill a portion note, the pizza note or the
-- order note. Both lists share the table (named for its first use), told apart by scope: 'pizza' | 'order'.
-- Only admins read or change the table, through the RPCs below.

create table if not exists public.pizza_note_shortcuts (
  id uuid primary key default gen_random_uuid(),
  scope text not null
    constraint pizza_note_shortcuts_scope_check check (scope in ('pizza', 'order')),
  label text not null
    constraint pizza_note_shortcuts_label_check
    check (label = btrim(label) and char_length(label) between 1 and 40),
  sort_order integer not null,
  created_at timestamptz not null default now()
);
create unique index if not exists pizza_note_shortcuts_scope_label_key
  on public.pizza_note_shortcuts (scope, lower(label));
alter table public.pizza_note_shortcuts enable row level security;
revoke all on table public.pizza_note_shortcuts from public, anon, authenticated;

create or replace function public.admin_list_note_shortcuts(p_scope text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede editar las pizzas.';
  end if;
  if p_scope is null or p_scope not in ('pizza', 'order') then
    raise exception 'Lista de atajos inválida.';
  end if;

  return coalesce(
    (
      select jsonb_agg(jsonb_build_object('id', id, 'label', label) order by sort_order, created_at)
      from public.pizza_note_shortcuts
      where scope = p_scope
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_add_note_shortcut(p_scope text, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede editar las pizzas.';
  end if;
  if p_scope is null or p_scope not in ('pizza', 'order') then
    raise exception 'Lista de atajos inválida.';
  end if;
  if v_label = '' then
    raise exception 'Escribe el texto del atajo.';
  end if;
  if char_length(v_label) > 40 then
    raise exception 'El atajo admite hasta 40 caracteres.';
  end if;

  -- Serializes concurrent adds so the limit and the order hold.
  perform pg_advisory_xact_lock(hashtext('public.pizza_note_shortcuts'));

  if exists (
    select 1 from public.pizza_note_shortcuts where scope = p_scope and lower(label) = lower(v_label)
  ) then
    raise exception 'Ese atajo ya existe.';
  end if;
  if (select count(*) from public.pizza_note_shortcuts where scope = p_scope) >= 12 then
    raise exception '%', case p_scope
      when 'order' then 'Puedes tener hasta 12 atajos de nota del pedido.'
      else 'Puedes tener hasta 12 atajos de notas.'
    end;
  end if;

  insert into public.pizza_note_shortcuts (scope, label, sort_order)
  values (
    p_scope,
    v_label,
    coalesce((select max(sort_order) from public.pizza_note_shortcuts where scope = p_scope), 0) + 1
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_delete_note_shortcut(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede editar las pizzas.';
  end if;

  delete from public.pizza_note_shortcuts where id = p_id;
  return jsonb_build_object('id', p_id);
end;
$$;

-- p_direction: -1 moves the shortcut up one place in its own list, 1 moves it down. At either end it stays put.
create or replace function public.admin_move_note_shortcut(p_id uuid, p_direction integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text;
  v_ids uuid[];
  v_pos integer;
  v_target integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede editar las pizzas.';
  end if;
  if p_direction is null or p_direction not in (-1, 1) then
    raise exception 'Dirección inválida.';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.pizza_note_shortcuts'));

  select scope into v_scope from public.pizza_note_shortcuts where id = p_id;
  if v_scope is null then
    raise exception 'Ese atajo ya no está en la lista.';
  end if;

  select array_agg(id order by sort_order, created_at) into v_ids
  from public.pizza_note_shortcuts where scope = v_scope;
  v_pos := array_position(v_ids, p_id);

  v_target := v_pos + p_direction;
  if v_target >= 1 and v_target <= array_length(v_ids, 1) then
    v_ids[v_pos] := v_ids[v_target];
    v_ids[v_target] := p_id;
  end if;

  update public.pizza_note_shortcuts s
  set sort_order = o.ord
  from unnest(v_ids) with ordinality as o(id, ord)
  where s.id = o.id;

  return jsonb_build_object('id', p_id);
end;
$$;

-- Both lists of labels in order, for the order screens. Internal: clients call the session or device wrappers below.
create or replace function public.note_shortcut_labels()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'pizza',
    coalesce((select jsonb_agg(label order by sort_order, created_at) from public.pizza_note_shortcuts where scope = 'pizza'), '[]'::jsonb),
    'order',
    coalesce((select jsonb_agg(label order by sort_order, created_at) from public.pizza_note_shortcuts where scope = 'order'), '[]'::jsonb)
  );
$$;
revoke all on function public.note_shortcut_labels() from public, anon, authenticated;

-- Signed-in admins and cashiers (the same people who can create orders from a session).
create or replace function public.list_note_shortcuts()
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
    raise exception 'No tienes permiso para ver los atajos de notas.';
  end if;

  return public.note_shortcut_labels();
end;
$$;

-- Authorized waiter devices.
create or replace function public.device_list_note_shortcuts(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_waiter_device(p_device_secret);
  return public.note_shortcut_labels();
end;
$$;

revoke all on function public.admin_list_note_shortcuts(text) from public, anon;
revoke all on function public.admin_add_note_shortcut(text, text) from public, anon;
revoke all on function public.admin_delete_note_shortcut(uuid) from public, anon;
revoke all on function public.admin_move_note_shortcut(uuid, integer) from public, anon;
revoke all on function public.list_note_shortcuts() from public, anon;
revoke all on function public.device_list_note_shortcuts(text) from public;
grant execute on function public.admin_list_note_shortcuts(text) to authenticated;
grant execute on function public.admin_add_note_shortcut(text, text) to authenticated;
grant execute on function public.admin_delete_note_shortcut(uuid) to authenticated;
grant execute on function public.admin_move_note_shortcut(uuid, integer) to authenticated;
grant execute on function public.list_note_shortcuts() to authenticated;
grant execute on function public.device_list_note_shortcuts(text) to anon, authenticated;
