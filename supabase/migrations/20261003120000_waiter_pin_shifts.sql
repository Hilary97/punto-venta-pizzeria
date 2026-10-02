-- Waiter PIN shifts.
--
-- Written by hand (no Supabase CLI available in the authoring environment).
--
-- Design summary:
--   * Waiter devices sign in with a normal 'waiter' account. A waiter then
--     starts a shift by picking their name and entering a 4-digit PIN. The PIN
--     never replaces authentication: every RPC still requires auth.uid().
--   * PINs are stored as bcrypt hashes. On Supabase, pgcrypto lives in the
--     `extensions` schema, so crypt()/gen_salt() are always schema-qualified.
--   * `waiters` and `waiter_shifts` are never readable by clients (RLS on, no
--     policies, privileges revoked). All access goes through RPCs and
--     pin_hash is never returned by any of them.
--   * start_waiter_shift issues a server-side token (uuid, 12h, bound to the
--     device's auth.uid()). create_order derives the waiter from that token,
--     so a client cannot forge it.

create extension if not exists pgcrypto;

-- ============================================================================
-- Tables
-- ============================================================================

create table public.waiters (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 1 and 60),
  pin_hash text not null,
  active boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

-- Avoid confusing duplicates in the name picker.
create unique index waiters_full_name_unique
  on public.waiters (lower(btrim(full_name)));

create table public.waiter_shifts (
  token uuid primary key default gen_random_uuid(),
  waiter_id uuid not null references public.waiters (id) on delete cascade,
  device_user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index waiter_shifts_waiter_id_idx on public.waiter_shifts (waiter_id);

alter table public.waiters enable row level security;
alter table public.waiter_shifts enable row level security;
-- Intentionally no policies: clients cannot read or write these tables.
revoke all on public.waiters from authenticated, anon;
revoke all on public.waiter_shifts from authenticated, anon;

-- Snapshot of who registered the order. Existing orders stay null.
alter table public.orders
  add column waiter_id uuid references public.waiters (id) on delete set null,
  add column waiter_name text;

-- ============================================================================
-- Helpers
-- ============================================================================

-- Internal: only used inside security-definer functions.
create or replace function public.validate_pin_format(p_pin text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_pin ~ '^[0-9]{4}$', false);
$$;

revoke all on function public.validate_pin_format(text) from public;

-- ============================================================================
-- Admin RPCs
-- ============================================================================

create or replace function public.admin_list_waiters()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar meseros.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', w.id,
          'full_name', w.full_name,
          'active', w.active,
          'locked', coalesce(w.locked_until > now(), false),
          'created_at', w.created_at
        )
        order by w.full_name
      )
      from public.waiters w
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_create_waiter(p_full_name text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
  v_waiter_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar meseros.';
  end if;

  if length(v_name) < 1 or length(v_name) > 60 then
    raise exception 'El nombre del mesero debe tener entre 1 y 60 caracteres.';
  end if;

  if not public.validate_pin_format(p_pin) then
    raise exception 'El PIN debe tener exactamente 4 dígitos.';
  end if;

  begin
    insert into public.waiters (full_name, pin_hash)
    values (v_name, extensions.crypt(p_pin, extensions.gen_salt('bf')))
    returning id into v_waiter_id;
  exception
    when unique_violation then
      raise exception 'Ya existe un mesero con ese nombre.';
  end;

  return jsonb_build_object('waiter_id', v_waiter_id);
end;
$$;

-- Renames and/or (de)activates a waiter. Deactivating ends all their shifts.
create or replace function public.admin_update_waiter(
  p_waiter_id uuid,
  p_full_name text,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar meseros.';
  end if;

  if length(v_name) < 1 or length(v_name) > 60 then
    raise exception 'El nombre del mesero debe tener entre 1 y 60 caracteres.';
  end if;

  if p_active is null then
    raise exception 'Indica si el mesero está activo.';
  end if;

  begin
    update public.waiters
    set full_name = v_name, active = p_active
    where id = p_waiter_id;
  exception
    when unique_violation then
      raise exception 'Ya existe un mesero con ese nombre.';
  end;

  if not found then
    raise exception 'Mesero no encontrado.';
  end if;

  if not p_active then
    delete from public.waiter_shifts where waiter_id = p_waiter_id;
  end if;

  return jsonb_build_object('waiter_id', p_waiter_id);
end;
$$;

create or replace function public.admin_reset_waiter_pin(p_waiter_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar meseros.';
  end if;

  if not public.validate_pin_format(p_pin) then
    raise exception 'El PIN debe tener exactamente 4 dígitos.';
  end if;

  update public.waiters
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
      failed_attempts = 0,
      locked_until = null
  where id = p_waiter_id;

  if not found then
    raise exception 'Mesero no encontrado.';
  end if;

  delete from public.waiter_shifts where waiter_id = p_waiter_id;

  return jsonb_build_object('waiter_id', p_waiter_id);
end;
$$;

create or replace function public.admin_unlock_waiter(p_waiter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar meseros.';
  end if;

  update public.waiters
  set failed_attempts = 0, locked_until = null
  where id = p_waiter_id;

  if not found then
    raise exception 'Mesero no encontrado.';
  end if;

  return jsonb_build_object('waiter_id', p_waiter_id);
end;
$$;

-- ============================================================================
-- Device RPCs (any authenticated user with a profile)
-- ============================================================================

create or replace function public.list_active_waiters()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Tu perfil no existe.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object('id', w.id, 'full_name', w.full_name)
        order by w.full_name
      )
      from public.waiters w
      where w.active = true
    ),
    '[]'::jsonb
  );
end;
$$;

-- Starts a shift. Wrong PIN and lockout are returned as {"error": "..."}
-- instead of raised: a raise would roll back the failed_attempts /
-- locked_until update made in this same transaction, and the brute-force
-- protection would never persist. Callers must check for the `error` key.
create or replace function public.start_waiter_shift(p_waiter_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_waiter public.waiters%rowtype;
  v_attempts integer;
  v_token uuid;
  v_expires_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Tu perfil no existe.';
  end if;

  select * into v_waiter
  from public.waiters
  where id = p_waiter_id and active = true
  for update;

  if not found then
    raise exception 'Mesero no encontrado o inactivo.';
  end if;

  if v_waiter.locked_until is not null and v_waiter.locked_until > now() then
    return jsonb_build_object('error', 'Demasiados intentos. Intenta de nuevo en unos minutos.');
  end if;

  -- A malformed PIN is a client bug, not a guess: raise without counting it.
  if not public.validate_pin_format(p_pin) then
    raise exception 'El PIN debe tener exactamente 4 dígitos.';
  end if;

  if v_waiter.pin_hash <> extensions.crypt(p_pin, v_waiter.pin_hash) then
    v_attempts := v_waiter.failed_attempts + 1;

    if v_attempts >= 5 then
      update public.waiters
      set failed_attempts = 0, locked_until = now() + interval '5 minutes'
      where id = v_waiter.id;

      return jsonb_build_object('error', 'Demasiados intentos. Intenta de nuevo en unos minutos.');
    end if;

    update public.waiters
    set failed_attempts = v_attempts
    where id = v_waiter.id;

    return jsonb_build_object('error', 'PIN incorrecto.');
  end if;

  update public.waiters
  set failed_attempts = 0, locked_until = null
  where id = v_waiter.id;

  delete from public.waiter_shifts
  where waiter_id = v_waiter.id and expires_at <= now();

  insert into public.waiter_shifts (waiter_id, device_user_id, expires_at)
  values (v_waiter.id, v_uid, now() + interval '12 hours')
  returning token, expires_at into v_token, v_expires_at;

  return jsonb_build_object(
    'token', v_token,
    'waiter_id', v_waiter.id,
    'full_name', v_waiter.full_name,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.end_waiter_shift(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted integer;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  delete from public.waiter_shifts
  where token = p_token and device_user_id = v_uid;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('ended', v_deleted > 0);
end;
$$;

-- Returns the shift's waiter, or null when the token is unknown, expired,
-- belongs to another device, or its waiter is inactive.
create or replace function public.get_waiter_shift(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select jsonb_build_object(
    'waiter_id', w.id,
    'full_name', w.full_name,
    'expires_at', s.expires_at
  )
  into v_result
  from public.waiter_shifts s
  join public.waiters w on w.id = s.waiter_id
  where s.token = p_token
    and s.device_user_id = v_uid
    and s.expires_at > now()
    and w.active = true;

  return v_result;
end;
$$;

-- ============================================================================
-- create_order: now records the waiter from a shift token
-- ============================================================================

-- Same body as 20261002140000_orders_table_or_name.sql plus the waiter token.
-- The signature changes, so the old overload is dropped to avoid ambiguity.
-- Waiter-role callers must send a valid token; admin/cashier may omit it
-- (takeout at the register).
drop function public.create_order(integer, text, jsonb);

create or replace function public.create_order(
  p_table_number integer,
  p_customer_name text,
  p_items jsonb,
  p_waiter_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_customer_name text := nullif(btrim(p_customer_name), '');
  v_waiter_id uuid;
  v_waiter_name text;
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_raw_quantity text;
  v_quantity integer;
  v_product_name text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para crear un pedido.';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  -- A caller without a profile must not bypass the waiter PIN requirement.
  if v_role is null then
    raise exception 'Tu usuario no tiene un perfil asignado.';
  end if;

  if p_waiter_token is not null then
    select w.id, w.full_name
    into v_waiter_id, v_waiter_name
    from public.waiter_shifts s
    join public.waiters w on w.id = s.waiter_id
    where s.token = p_waiter_token
      and s.device_user_id = v_uid
      and s.expires_at > now()
      and w.active = true;

    if v_waiter_id is null then
      raise exception 'Tu turno expiró. Ingresa tu PIN de nuevo.';
    end if;
  elsif v_role = 'waiter' then
    raise exception 'Ingresa tu PIN para registrar pedidos.';
  end if;

  if p_table_number is not null and (p_table_number < 1 or p_table_number > 9) then
    raise exception 'El número de mesa no es válido.';
  end if;

  if v_customer_name is not null and length(v_customer_name) > 80 then
    raise exception 'El nombre del cliente no es válido.';
  end if;

  if p_table_number is null and v_customer_name is null then
    raise exception 'Indica la mesa o el nombre del cliente.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe incluir al menos un producto.';
  end if;

  insert into public.orders (table_number, customer_name, created_by, waiter_id, waiter_name)
  values (p_table_number, v_customer_name, v_uid, v_waiter_id, v_waiter_name)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Uno de los artículos del pedido es inválido.';
    end;

    v_raw_quantity := v_item ->> 'quantity';
    if v_product_id is null or v_raw_quantity is null or v_raw_quantity !~ '^[0-9]+$' then
      raise exception 'Uno de los artículos del pedido es inválido.';
    end if;
    v_quantity := v_raw_quantity::integer;
    if v_quantity <= 0 then
      raise exception 'Uno de los artículos del pedido es inválido.';
    end if;

    v_product_name := null;
    select name into v_product_name
    from public.products
    where id = v_product_id and active = true
    for share;

    if v_product_name is null then
      raise exception 'Uno de los productos no existe o no está activo.';
    end if;

    insert into public.order_items (order_id, product_id, product_name, quantity)
    values (v_order_id, v_product_id, v_product_name, v_quantity)
    on conflict (order_id, product_id)
    do update set quantity = order_items.quantity + excluded.quantity;
  end loop;

  return jsonb_build_object('order_id', v_order_id);
end;
$$;

-- ============================================================================
-- Privileges
-- ============================================================================

revoke all on function public.admin_list_waiters() from public;
revoke all on function public.admin_create_waiter(text, text) from public;
revoke all on function public.admin_update_waiter(uuid, text, boolean) from public;
revoke all on function public.admin_reset_waiter_pin(uuid, text) from public;
revoke all on function public.admin_unlock_waiter(uuid) from public;
revoke all on function public.list_active_waiters() from public;
revoke all on function public.start_waiter_shift(uuid, text) from public;
revoke all on function public.end_waiter_shift(uuid) from public;
revoke all on function public.get_waiter_shift(uuid) from public;
revoke all on function public.create_order(integer, text, jsonb, uuid) from public;

grant execute on function public.admin_list_waiters() to authenticated;
grant execute on function public.admin_create_waiter(text, text) to authenticated;
grant execute on function public.admin_update_waiter(uuid, text, boolean) to authenticated;
grant execute on function public.admin_reset_waiter_pin(uuid, text) to authenticated;
grant execute on function public.admin_unlock_waiter(uuid) to authenticated;
grant execute on function public.list_active_waiters() to authenticated;
grant execute on function public.start_waiter_shift(uuid, text) to authenticated;
grant execute on function public.end_waiter_shift(uuid) to authenticated;
grant execute on function public.get_waiter_shift(uuid) to authenticated;
grant execute on function public.create_order(integer, text, jsonb, uuid) to authenticated;
