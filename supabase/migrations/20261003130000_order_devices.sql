-- Authorized order devices (no waiter accounts).
--
-- Written by hand (no Supabase CLI available in the authoring environment).
--
-- Supersedes the account-based waiter model of 20261003120000_waiter_pin_shifts.sql.
--
-- Device model:
--   * Waiters never sign in. An admin authorizes a device once
--     (admin_register_device). The server generates a 256-bit random secret,
--     stores ONLY its sha256 hash, and returns the plaintext secret a single
--     time. The device keeps it in local storage.
--   * Every device_* RPC is granted to `anon` (the device has no session) but
--     starts by resolving the secret through resolve_order_device. Without a
--     valid, non-revoked secret nothing is visible or callable: the internet
--     cannot list waiters, try PINs, read orders or create orders.
--   * Granting anon is safe because the secret is 256 bits of randomness
--     (unguessable), is hashed at rest (a database leak does not reveal it),
--     and can be revoked at any time (admin_revoke_device).
--   * A waiter then picks their name and enters a PIN (bcrypt, lockout after 5
--     wrong attempts) to open a 12h shift bound to that device. Orders created
--     from the device record the waiter's name; the order's created_by is the
--     admin who registered the device.
--   * Order validation/insert logic lives in internal *_core helpers shared by
--     the authenticated (admin/cashier) RPCs and the device RPCs. Helpers are
--     revoked from every client role and only called by definer functions.
--   * pgcrypto lives in the `extensions` schema on Supabase, so every call is
--     schema-qualified.

create extension if not exists pgcrypto;

-- ============================================================================
-- Drop the account-based shift functions (before the table they used)
-- ============================================================================

drop function if exists public.start_waiter_shift(uuid, text);
drop function if exists public.end_waiter_shift(uuid);
drop function if exists public.get_waiter_shift(uuid);
drop function if exists public.list_active_waiters();
drop function if exists public.create_order(integer, text, jsonb, uuid);

-- ============================================================================
-- Tables
-- ============================================================================

create table public.order_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  secret_hash text not null unique,
  registered_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

alter table public.order_devices enable row level security;
-- Intentionally no policies: clients cannot read or write this table.
revoke all on public.order_devices from authenticated, anon;

-- Shift data is disposable: rebuild the table bound to a device instead of a
-- user account.
drop table public.waiter_shifts;

create table public.waiter_shifts (
  token uuid primary key default gen_random_uuid(),
  waiter_id uuid not null references public.waiters (id) on delete cascade,
  device_id uuid not null references public.order_devices (id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index waiter_shifts_waiter_id_idx on public.waiter_shifts (waiter_id);
create index waiter_shifts_device_id_idx on public.waiter_shifts (device_id);

alter table public.waiter_shifts enable row level security;
revoke all on public.waiter_shifts from authenticated, anon;

-- admin_update_waiter / admin_reset_waiter_pin only delete shifts by
-- waiter_id, which still exists, so they need no changes.

-- ============================================================================
-- Internal helpers (never callable by clients)
-- ============================================================================

-- Resolves and touches an authorized device. Raises when the secret is
-- missing, unknown or revoked (same message for all, to leak nothing).
create or replace function public.resolve_order_device(p_device_secret text)
returns public.order_devices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  if p_device_secret is null or length(p_device_secret) < 32 then
    raise exception 'Este dispositivo no está autorizado para pedidos.';
  end if;

  select * into v_device
  from public.order_devices d
  where d.secret_hash = encode(extensions.digest(p_device_secret, 'sha256'), 'hex')
    and d.revoked_at is null;

  if not found then
    raise exception 'Este dispositivo no está autorizado para pedidos.';
  end if;

  update public.order_devices
  set last_seen_at = now()
  where id = v_device.id;

  return v_device;
end;
$$;

-- Resolves a valid shift for a device: right device, not expired, waiter
-- active. Columns are alias-qualified because the OUT names would otherwise
-- be ambiguous with table columns.
create or replace function public.resolve_waiter_shift(p_device_id uuid, p_shift_token uuid)
returns table (waiter_id uuid, waiter_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select w.id, w.full_name
  from public.waiter_shifts s
  join public.waiters w on w.id = s.waiter_id
  where s.token = p_shift_token
    and s.device_id = p_device_id
    and s.expires_at > now()
    and w.active = true;

  if not found then
    raise exception 'Tu turno expiró. Ingresa tu PIN de nuevo.';
  end if;
end;
$$;

-- Validates and inserts an open order with its items. Table and customer name
-- are both optional, but at least one is required. Duplicate product ids are
-- merged by summing quantities. Product names are snapshotted; no price is
-- read or stored.
create or replace function public.insert_order_core(
  p_created_by uuid,
  p_waiter_id uuid,
  p_waiter_name text,
  p_table_number integer,
  p_customer_name text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_name text := nullif(btrim(p_customer_name), '');
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_raw_quantity text;
  v_quantity integer;
  v_product_name text;
begin
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
  values (p_table_number, v_customer_name, p_created_by, p_waiter_id, p_waiter_name)
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

  return v_order_id;
end;
$$;

-- Adds items to an open order; existing lines for the same product have the
-- new quantity added to them.
create or replace function public.add_order_items_core(p_order_id uuid, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_item jsonb;
  v_product_id uuid;
  v_raw_quantity text;
  v_quantity integer;
  v_product_name text;
begin
  if p_order_id is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  -- Serialize against concurrent pay/cancel/add calls on the same order.
  select status into v_status
  from public.orders
  where id = p_order_id
  for update;

  if v_status is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if v_status <> 'open' then
    raise exception 'El pedido ya no está abierto.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes agregar al menos un producto.';
  end if;

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
    values (p_order_id, v_product_id, v_product_name, v_quantity)
    on conflict (order_id, product_id)
    do update set quantity = order_items.quantity + excluded.quantity;
  end loop;

  return p_order_id;
end;
$$;

-- Cancels an open order.
create or replace function public.cancel_order_core(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_order_id is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  select status into v_status
  from public.orders
  where id = p_order_id
  for update;

  if v_status is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if v_status <> 'open' then
    raise exception 'El pedido ya no está abierto.';
  end if;

  update public.orders
  set status = 'cancelled', cancelled_at = now()
  where id = p_order_id;

  return p_order_id;
end;
$$;

-- ============================================================================
-- Authenticated RPCs (admin / cashier at the register)
-- ============================================================================

create or replace function public.create_order(
  p_table_number integer,
  p_customer_name text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para crear un pedido.';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is null or v_role not in ('admin', 'cashier') then
    raise exception 'Los pedidos de meseros se registran desde un dispositivo autorizado.';
  end if;

  return jsonb_build_object(
    'order_id',
    public.insert_order_core(v_uid, null, null, p_table_number, p_customer_name, p_items)
  );
end;
$$;

create or replace function public.add_order_items(p_order_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para modificar un pedido.';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is null or v_role not in ('admin', 'cashier') then
    raise exception 'Los pedidos de meseros se registran desde un dispositivo autorizado.';
  end if;

  return jsonb_build_object('order_id', public.add_order_items_core(p_order_id, p_items));
end;
$$;

create or replace function public.cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para cancelar un pedido.';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is null or v_role not in ('admin', 'cashier') then
    raise exception 'Los pedidos de meseros se registran desde un dispositivo autorizado.';
  end if;

  return jsonb_build_object('order_id', public.cancel_order_core(p_order_id));
end;
$$;

-- ============================================================================
-- Device RPCs (anon + authenticated; every one needs a valid device secret)
-- ============================================================================

create or replace function public.device_info(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_order_device(p_device_secret);

  return jsonb_build_object('device_id', v_device.id, 'name', v_device.name);
end;
$$;

create or replace function public.device_list_waiters(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_order_device(p_device_secret);

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
create or replace function public.device_start_shift(
  p_device_secret text,
  p_waiter_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
  v_waiter public.waiters%rowtype;
  v_attempts integer;
  v_token uuid;
  v_expires_at timestamptz;
begin
  v_device := public.resolve_order_device(p_device_secret);

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

  insert into public.waiter_shifts (waiter_id, device_id, expires_at)
  values (v_waiter.id, v_device.id, now() + interval '12 hours')
  returning token, expires_at into v_token, v_expires_at;

  return jsonb_build_object(
    'token', v_token,
    'waiter_id', v_waiter.id,
    'full_name', v_waiter.full_name,
    'expires_at', v_expires_at
  );
end;
$$;

-- Returns the shift's waiter, or null when the token is unknown, expired,
-- belongs to another device, or its waiter is inactive.
create or replace function public.device_get_shift(p_device_secret text, p_shift_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
  v_result jsonb;
begin
  v_device := public.resolve_order_device(p_device_secret);

  select jsonb_build_object(
    'waiter_id', w.id,
    'full_name', w.full_name,
    'expires_at', s.expires_at
  )
  into v_result
  from public.waiter_shifts s
  join public.waiters w on w.id = s.waiter_id
  where s.token = p_shift_token
    and s.device_id = v_device.id
    and s.expires_at > now()
    and w.active = true;

  return v_result;
end;
$$;

create or replace function public.device_end_shift(p_device_secret text, p_shift_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
  v_deleted integer;
begin
  v_device := public.resolve_order_device(p_device_secret);

  delete from public.waiter_shifts
  where token = p_shift_token and device_id = v_device.id;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('ended', v_deleted > 0);
end;
$$;

-- Active catalog for the order picker. Prices are deliberately not exposed.
create or replace function public.device_list_catalog(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_order_device(p_device_secret);

  return jsonb_build_object(
    'categories',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', c.id, 'name', c.name, 'sort_order', c.sort_order)
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
          jsonb_build_object('id', p.id, 'name', p.name, 'category_id', p.category_id)
          order by p.name
        )
        from public.products p
        where p.active = true
      ),
      '[]'::jsonb
    )
  );
end;
$$;

-- Open orders, oldest first. Mirrors the shape of the nested select used by
-- the frontend (`order_items`, not `items`) so the same row schema parses it.
create or replace function public.device_list_open_orders(p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_order_device(p_device_secret);

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'table_number', o.table_number,
          'customer_name', o.customer_name,
          'status', o.status,
          'created_at', o.created_at,
          'waiter_name', o.waiter_name,
          'order_items', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id', i.id,
                  'product_id', i.product_id,
                  'product_name', i.product_name,
                  'quantity', i.quantity
                )
                order by i.product_name, i.id
              )
              from public.order_items i
              where i.order_id = o.id
            ),
            '[]'::jsonb
          )
        )
        order by o.created_at, o.id
      )
      from public.orders o
      where o.status = 'open'
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.device_create_order(
  p_device_secret text,
  p_shift_token uuid,
  p_table_number integer,
  p_customer_name text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
  v_waiter_id uuid;
  v_waiter_name text;
begin
  v_device := public.resolve_order_device(p_device_secret);

  select s.waiter_id, s.waiter_name
  into v_waiter_id, v_waiter_name
  from public.resolve_waiter_shift(v_device.id, p_shift_token) s;

  return jsonb_build_object(
    'order_id',
    public.insert_order_core(
      v_device.registered_by, v_waiter_id, v_waiter_name,
      p_table_number, p_customer_name, p_items
    )
  );
end;
$$;

create or replace function public.device_add_order_items(
  p_device_secret text,
  p_shift_token uuid,
  p_order_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_order_device(p_device_secret);
  perform 1 from public.resolve_waiter_shift(v_device.id, p_shift_token);

  return jsonb_build_object('order_id', public.add_order_items_core(p_order_id, p_items));
end;
$$;

create or replace function public.device_cancel_order(
  p_device_secret text,
  p_shift_token uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_order_device(p_device_secret);
  perform 1 from public.resolve_waiter_shift(v_device.id, p_shift_token);

  return jsonb_build_object('order_id', public.cancel_order_core(p_order_id));
end;
$$;

-- ============================================================================
-- Admin device RPCs
-- ============================================================================

-- Registers a device. The plaintext secret is returned ONCE and never stored.
create or replace function public.admin_register_device(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_secret text;
  v_device_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar dispositivos.';
  end if;

  if length(v_name) < 1 or length(v_name) > 60 then
    raise exception 'El nombre del dispositivo debe tener entre 1 y 60 caracteres.';
  end if;

  v_secret := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.order_devices (name, secret_hash, registered_by)
  values (v_name, encode(extensions.digest(v_secret, 'sha256'), 'hex'), auth.uid())
  returning id into v_device_id;

  return jsonb_build_object(
    'device_id', v_device_id,
    'name', v_name,
    'device_secret', v_secret
  );
end;
$$;

create or replace function public.admin_list_devices()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar dispositivos.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'name', d.name,
          'created_at', d.created_at,
          'last_seen_at', d.last_seen_at,
          'revoked', d.revoked_at is not null
        )
        order by d.created_at desc
      )
      from public.order_devices d
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_revoke_device(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar dispositivos.';
  end if;

  update public.order_devices
  set revoked_at = coalesce(revoked_at, now())
  where id = p_device_id;

  if not found then
    raise exception 'Dispositivo no encontrado.';
  end if;

  delete from public.waiter_shifts where device_id = p_device_id;

  return jsonb_build_object('device_id', p_device_id);
end;
$$;

-- ============================================================================
-- Privileges
-- ============================================================================

-- Internal helpers: callable only from other definer functions.
revoke all on function public.resolve_order_device(text) from public, anon, authenticated;
revoke all on function public.resolve_waiter_shift(uuid, uuid) from public, anon, authenticated;
revoke all on function public.insert_order_core(uuid, uuid, text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.add_order_items_core(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_order_core(uuid) from public, anon, authenticated;

-- Register RPCs: authenticated only.
revoke all on function public.create_order(integer, text, jsonb) from public, anon;
revoke all on function public.add_order_items(uuid, jsonb) from public, anon;
revoke all on function public.cancel_order(uuid) from public, anon;
grant execute on function public.create_order(integer, text, jsonb) to authenticated;
grant execute on function public.add_order_items(uuid, jsonb) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;

-- Admin device RPCs: authenticated only (is_admin() checked inside).
revoke all on function public.admin_register_device(text) from public, anon;
revoke all on function public.admin_list_devices() from public, anon;
revoke all on function public.admin_revoke_device(uuid) from public, anon;
grant execute on function public.admin_register_device(text) to authenticated;
grant execute on function public.admin_list_devices() to authenticated;
grant execute on function public.admin_revoke_device(uuid) to authenticated;

-- Device RPCs: anon + authenticated, gated by the device secret.
revoke all on function public.device_info(text) from public;
revoke all on function public.device_list_waiters(text) from public;
revoke all on function public.device_start_shift(text, uuid, text) from public;
revoke all on function public.device_get_shift(text, uuid) from public;
revoke all on function public.device_end_shift(text, uuid) from public;
revoke all on function public.device_list_catalog(text) from public;
revoke all on function public.device_list_open_orders(text) from public;
revoke all on function public.device_create_order(text, uuid, integer, text, jsonb) from public;
revoke all on function public.device_add_order_items(text, uuid, uuid, jsonb) from public;
revoke all on function public.device_cancel_order(text, uuid, uuid) from public;

grant execute on function public.device_info(text) to anon, authenticated;
grant execute on function public.device_list_waiters(text) to anon, authenticated;
grant execute on function public.device_start_shift(text, uuid, text) to anon, authenticated;
grant execute on function public.device_get_shift(text, uuid) to anon, authenticated;
grant execute on function public.device_end_shift(text, uuid) to anon, authenticated;
grant execute on function public.device_list_catalog(text) to anon, authenticated;
grant execute on function public.device_list_open_orders(text) to anon, authenticated;
grant execute on function public.device_create_order(text, uuid, integer, text, jsonb) to anon, authenticated;
grant execute on function public.device_add_order_items(text, uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.device_cancel_order(text, uuid, uuid) to anon, authenticated;
