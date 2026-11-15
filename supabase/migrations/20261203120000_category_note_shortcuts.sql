-- Note shortcuts per product category ("Sin pepinillos" for Hamburguesas, "Sin hielo" for Bebidas...), managed in
-- Admin > Productos. They join the pizza and order lists in pizza_note_shortcuts under a third scope, 'category',
-- with the category in category_id. The pizza and order lists, their RPCs and the shape of their reads stay as they
-- were: the read RPCs only gain a `categories` key.

alter table public.pizza_note_shortcuts
  add column if not exists category_id uuid references public.categories (id) on delete cascade;

alter table public.pizza_note_shortcuts drop constraint if exists pizza_note_shortcuts_scope_check;
alter table public.pizza_note_shortcuts
  add constraint pizza_note_shortcuts_scope_check check (scope in ('pizza', 'order', 'category'));
alter table public.pizza_note_shortcuts drop constraint if exists pizza_note_shortcuts_category_check;
alter table public.pizza_note_shortcuts
  add constraint pizza_note_shortcuts_category_check check ((scope = 'category') = (category_id is not null));

-- One label per list: per scope, and per category inside the category scope.
drop index if exists public.pizza_note_shortcuts_scope_label_key;
create unique index if not exists pizza_note_shortcuts_list_label_key
  on public.pizza_note_shortcuts (scope, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(label));

create or replace function public.admin_list_category_note_shortcuts(p_category_id uuid)
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
  if p_category_id is null or not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'Esa categoría ya no existe.';
  end if;

  return coalesce(
    (
      select jsonb_agg(jsonb_build_object('id', id, 'label', label) order by sort_order, created_at)
      from public.pizza_note_shortcuts
      where scope = 'category' and category_id = p_category_id
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_add_category_note_shortcut(p_category_id uuid, p_label text)
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
  if p_category_id is null or not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'Esa categoría ya no existe.';
  end if;
  if v_label = '' then
    raise exception 'Escribe el texto del atajo.';
  end if;
  if char_length(v_label) > 40 then
    raise exception 'El atajo admite hasta 40 caracteres.';
  end if;

  -- Same lock as the other lists: serializes concurrent adds so the limit and the order hold.
  perform pg_advisory_xact_lock(hashtext('public.pizza_note_shortcuts'));

  if exists (
    select 1 from public.pizza_note_shortcuts
    where scope = 'category' and category_id = p_category_id and lower(label) = lower(v_label)
  ) then
    raise exception 'Ese atajo ya existe.';
  end if;
  if (select count(*) from public.pizza_note_shortcuts where scope = 'category' and category_id = p_category_id) >= 12 then
    raise exception 'Puedes tener hasta 12 atajos por categoría.';
  end if;

  insert into public.pizza_note_shortcuts (scope, category_id, label, sort_order)
  values (
    'category',
    p_category_id,
    v_label,
    coalesce(
      (select max(sort_order) from public.pizza_note_shortcuts where scope = 'category' and category_id = p_category_id),
      0
    ) + 1
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

-- Redefined so a move stays inside the row's own list: its scope and, for category rows, its category.
-- Pizza and order behave exactly as before (category_id is null there).
create or replace function public.admin_move_note_shortcut(p_id uuid, p_direction integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text;
  v_category uuid;
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

  select scope, category_id into v_scope, v_category from public.pizza_note_shortcuts where id = p_id;
  if v_scope is null then
    raise exception 'Ese atajo ya no está en la lista.';
  end if;

  select array_agg(id order by sort_order, created_at) into v_ids
  from public.pizza_note_shortcuts
  where scope = v_scope and category_id is not distinct from v_category;
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

-- Labels of every list in order, for the order screens: pizza and order as before, plus `categories`
-- ({ "<category_id>": [labels] }, only categories that have shortcuts). Internal: clients call the wrappers.
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
    coalesce((select jsonb_agg(label order by sort_order, created_at) from public.pizza_note_shortcuts where scope = 'order'), '[]'::jsonb),
    'categories',
    coalesce(
      (
        select jsonb_object_agg(c.category_id::text, c.labels)
        from (
          select category_id, jsonb_agg(label order by sort_order, created_at) as labels
          from public.pizza_note_shortcuts
          where scope = 'category'
          group by category_id
        ) c
      ),
      '{}'::jsonb
    )
  );
$$;

revoke all on function public.note_shortcut_labels() from public, anon, authenticated;
revoke all on function public.admin_list_category_note_shortcuts(uuid) from public, anon;
revoke all on function public.admin_add_category_note_shortcut(uuid, text) from public, anon;
revoke all on function public.admin_move_note_shortcut(uuid, integer) from public, anon;
grant execute on function public.admin_list_category_note_shortcuts(uuid) to authenticated;
grant execute on function public.admin_add_category_note_shortcut(uuid, text) to authenticated;
grant execute on function public.admin_move_note_shortcut(uuid, integer) to authenticated;
