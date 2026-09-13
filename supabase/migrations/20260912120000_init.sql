-- Punto de Venta Pizzería — initial schema
--
-- Written by hand (no Supabase CLI available in the authoring environment).
-- Apply via the Supabase SQL editor or `npx supabase db push` once linked to
-- a project. All money columns are integer cents (no floats) to avoid
-- rounding errors.
--
-- Design summary:
--   * profiles.role gates admin-only UI; enforced server-side via is_admin().
--   * sales / returns / cash_sessions are NEVER written directly by clients:
--     RLS defines no insert/update/delete policies for them, and table
--     privileges for those verbs are explicitly revoked from anon/authenticated
--     below. All writes go through the security-definer RPCs at the bottom,
--     which read prices from `products` and validate quantities server-side.

create extension if not exists pgcrypto;

-- ============================================================================
-- Tables
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'cashier' check (role in ('admin', 'cashier')),
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete restrict,
  name text not null,
  price_cents integer not null check (price_cents > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null references public.profiles (id),
  opened_at timestamptz not null default now(),
  opening_cents integer not null check (opening_cents >= 0),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  counted_cents integer,
  expected_cents integer,
  difference_cents integer,
  constraint cash_sessions_closed_fields_consistent check (
    (closed_at is null and closed_by is null and counted_cents is null and expected_cents is null and difference_cents is null)
    or
    (closed_at is not null and closed_by is not null and counted_cents is not null and expected_cents is not null and difference_cents is not null)
  )
);

-- Only one register session may be open at a time (single shared register).
create unique index cash_sessions_one_open_idx on public.cash_sessions ((true)) where closed_at is null;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cash_sessions (id),
  cashier_id uuid not null references public.profiles (id),
  total_cents integer not null check (total_cents >= 0),
  received_cents integer not null check (received_cents >= total_cents),
  change_cents integer not null check (change_cents >= 0),
  created_at timestamptz not null default now()
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  unit_price_cents integer not null check (unit_price_cents > 0),
  quantity integer not null check (quantity > 0)
);

create table public.returns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cash_sessions (id),
  sale_id uuid not null references public.sales (id),
  cashier_id uuid not null references public.profiles (id),
  reason text,
  total_cents integer not null check (total_cents >= 0),
  created_at timestamptz not null default now()
);

create table public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns (id) on delete cascade,
  sale_item_id uuid not null references public.sale_items (id),
  quantity integer not null check (quantity > 0),
  amount_cents integer not null check (amount_cents >= 0)
);

-- ============================================================================
-- Indexes
-- ============================================================================

create index products_category_id_idx on public.products (category_id);
create index products_active_idx on public.products (active);
create index cash_sessions_closed_at_idx on public.cash_sessions (closed_at);
create index sales_session_id_idx on public.sales (session_id);
create index sales_created_at_idx on public.sales (created_at);
create index sale_items_sale_id_idx on public.sale_items (sale_id);
create index returns_session_id_idx on public.returns (session_id);
create index returns_sale_id_idx on public.returns (sale_id);
create index return_items_return_id_idx on public.return_items (return_id);
create index return_items_sale_item_id_idx on public.return_items (sale_item_id);

-- ============================================================================
-- Role helper
-- ============================================================================

-- SECURITY DEFINER + explicit search_path so this always resolves
-- public.profiles regardless of the caller's search_path, and cannot be
-- hijacked by a same-named object in another schema. It runs as the
-- function owner (the migration role), which is exempt from RLS, so it can
-- safely read `profiles` from inside `profiles`' own RLS policies without
-- infinite recursion.
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.id = uid and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, anon;
-- Granted to `anon` too: Postgres does not guarantee short-circuit order for
-- `auth.role() = 'authenticated' and (active = true or public.is_admin())`,
-- so an anon-role query must still be able to *call* is_admin() (it safely
-- returns false for a null uid) instead of erroring with permission denied.

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.returns enable row level security;
alter table public.return_items enable row level security;

-- profiles: a user reads their own row; admins read/update everyone's.
-- No insert/delete policy — rows are created only by the handle_new_user
-- trigger below (security definer, bypasses RLS as the table owner).
create policy profiles_select_self on public.profiles
  for select using (auth.uid() = id);

create policy profiles_select_admin on public.profiles
  for select using (public.is_admin());

create policy profiles_update_admin on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- categories: any signed-in user reads; only admins write.
create policy categories_select_authenticated on public.categories
  for select using (auth.role() = 'authenticated');

create policy categories_insert_admin on public.categories
  for insert with check (public.is_admin());

create policy categories_update_admin on public.categories
  for update using (public.is_admin()) with check (public.is_admin());

create policy categories_delete_admin on public.categories
  for delete using (public.is_admin());

-- products: any signed-in user reads active products; admins also see
-- inactive ones (needed by the admin screen) and are the only writers.
create policy products_select_authenticated on public.products
  for select using (auth.role() = 'authenticated' and (active = true or public.is_admin()));

create policy products_insert_admin on public.products
  for insert with check (public.is_admin());

create policy products_update_admin on public.products
  for update using (public.is_admin()) with check (public.is_admin());

create policy products_delete_admin on public.products
  for delete using (public.is_admin());

-- cash_sessions / sales / sale_items / returns / return_items:
-- read-only for clients. The currently open session (and its sales/returns)
-- is visible to any signed-in user; closed/historical sessions are visible
-- only to admins. There are intentionally no insert/update/delete policies:
-- all writes happen through the SECURITY DEFINER RPCs further below.
create policy cash_sessions_select on public.cash_sessions
  for select using (closed_at is null or public.is_admin());

create policy sales_select on public.sales
  for select using (
    public.is_admin()
    or session_id in (select id from public.cash_sessions where closed_at is null)
  );

create policy sale_items_select on public.sale_items
  for select using (
    public.is_admin()
    or sale_id in (
      select s.id
      from public.sales s
      join public.cash_sessions cs on cs.id = s.session_id
      where cs.closed_at is null
    )
  );

create policy returns_select on public.returns
  for select using (
    public.is_admin()
    or session_id in (select id from public.cash_sessions where closed_at is null)
  );

create policy return_items_select on public.return_items
  for select using (
    public.is_admin()
    or return_id in (
      select r.id
      from public.returns r
      join public.cash_sessions cs on cs.id = r.session_id
      where cs.closed_at is null
    )
  );

-- Defense in depth: even though RLS already has no write policies for these
-- tables, explicitly revoke the write privileges from anon/authenticated so
-- a future permissive policy added by mistake still can't be exploited
-- without also re-granting these.
revoke insert, update, delete on public.cash_sessions from authenticated, anon;
revoke insert, update, delete on public.sales from authenticated, anon;
revoke insert, update, delete on public.sale_items from authenticated, anon;
revoke insert, update, delete on public.returns from authenticated, anon;
revoke insert, update, delete on public.return_items from authenticated, anon;
revoke insert, delete on public.profiles from authenticated, anon;

-- ============================================================================
-- New user → profile row (defaults to 'cashier')
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'cashier')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- RPCs (SECURITY DEFINER) — the only way sales/returns/cash sessions are written
-- ============================================================================

-- Opens the shared register. Fails if one is already open (also enforced by
-- the partial unique index as a race-safe last line of defense).
create or replace function public.open_cash_session(p_opening_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para abrir la caja.';
  end if;

  if p_opening_cents is null or p_opening_cents < 0 then
    raise exception 'El fondo inicial no es válido.';
  end if;

  if exists (select 1 from public.cash_sessions where closed_at is null) then
    raise exception 'Ya existe una caja abierta.';
  end if;

  begin
    insert into public.cash_sessions (opened_by, opening_cents)
    values (v_uid, p_opening_cents)
    returning id into v_session_id;
  exception
    when unique_violation then
      raise exception 'Ya existe una caja abierta.';
  end;

  return jsonb_build_object('session_id', v_session_id);
end;
$$;

-- Registers a sale. `p_items` is a jsonb array of
-- {"product_id": uuid, "quantity": int}. Prices are re-read from `products`
-- here — the client-supplied total/prices (if any) are never trusted.
create or replace function public.create_sale(p_items jsonb, p_received_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_sale_id uuid;
  v_total_cents integer := 0;
  v_change_cents integer;
  v_item jsonb;
  v_product_id uuid;
  v_raw_quantity text;
  v_quantity integer;
  v_unit_price_cents integer;
  v_product_name text;
  v_snapshot jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para registrar una venta.';
  end if;

  if p_received_cents is null or p_received_cents < 0 then
    raise exception 'El monto recibido no es válido.';
  end if;

  select id into v_session_id from public.cash_sessions where closed_at is null limit 1;
  if v_session_id is null then
    raise exception 'No hay una caja abierta. Abre la caja antes de vender.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe incluir al menos un producto.';
  end if;

  -- Single pass: validate each line, lock its product row (`for share`) so a
  -- concurrent price edit can't commit while this sale is in flight, and
  -- snapshot the price/name once — reused below for both the authoritative
  -- total and the sale_items insert, instead of being re-read a second time.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Uno de los artículos de la venta es inválido.';
    end;

    v_raw_quantity := v_item ->> 'quantity';
    if v_product_id is null or v_raw_quantity is null or v_raw_quantity !~ '^[0-9]+$' then
      raise exception 'Uno de los artículos de la venta es inválido.';
    end if;
    v_quantity := v_raw_quantity::integer;
    if v_quantity <= 0 then
      raise exception 'Uno de los artículos de la venta es inválido.';
    end if;

    select price_cents, name into v_unit_price_cents, v_product_name
    from public.products
    where id = v_product_id and active = true
    for share;

    if v_unit_price_cents is null then
      raise exception 'Uno de los productos no existe o no está activo.';
    end if;

    v_total_cents := v_total_cents + v_unit_price_cents * v_quantity;

    v_snapshot := v_snapshot || jsonb_build_object(
      'product_id', v_product_id,
      'product_name', v_product_name,
      'unit_price_cents', v_unit_price_cents,
      'quantity', v_quantity
    );
  end loop;

  if p_received_cents < v_total_cents then
    raise exception 'El monto recibido es menor al total de la venta.';
  end if;

  v_change_cents := p_received_cents - v_total_cents;

  insert into public.sales (session_id, cashier_id, total_cents, received_cents, change_cents)
  values (v_session_id, v_uid, v_total_cents, p_received_cents, v_change_cents)
  returning id into v_sale_id;

  -- Reuses the price/name captured in the single pass above — never re-reads
  -- `products`, so a concurrent price change can't make this snapshot
  -- disagree with the total already computed.
  for v_item in select * from jsonb_array_elements(v_snapshot)
  loop
    insert into public.sale_items (sale_id, product_id, product_name, unit_price_cents, quantity)
    values (
      v_sale_id,
      (v_item ->> 'product_id')::uuid,
      v_item ->> 'product_name',
      (v_item ->> 'unit_price_cents')::integer,
      (v_item ->> 'quantity')::integer
    );
  end loop;

  return jsonb_build_object('sale_id', v_sale_id, 'total_cents', v_total_cents, 'change_cents', v_change_cents);
end;
$$;

-- Registers a return against an existing sale. `p_items` is a jsonb array of
-- {"sale_item_id": uuid, "quantity": int}. Each quantity is validated against
-- sold minus already-returned units for that sale item. A sale can only be
-- returned while it still belongs to the currently open cash session — once
-- the session is closed (or belongs to a different one), returns against it
-- are rejected for every role, admins included.
create or replace function public.create_return(p_sale_id uuid, p_items jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_sale_session_id uuid;
  v_return_id uuid;
  v_total_cents integer := 0;
  v_item jsonb;
  v_sale_item_id uuid;
  v_raw_quantity text;
  v_quantity integer;
  v_sold_quantity integer;
  v_returned_quantity integer;
  v_unit_price_cents integer;
  v_item_sale_id uuid;
  v_amount_cents integer;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para registrar una devolución.';
  end if;

  select id into v_session_id from public.cash_sessions where closed_at is null limit 1;
  if v_session_id is null then
    raise exception 'No hay una caja abierta. Abre la caja antes de registrar devoluciones.';
  end if;

  select session_id into v_sale_session_id from public.sales where id = p_sale_id;

  if v_sale_session_id is null then
    raise exception 'La venta indicada no existe.';
  end if;

  if v_sale_session_id <> v_session_id then
    raise exception 'Solo se pueden devolver ventas del turno abierto.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La devolución debe incluir al menos un artículo.';
  end if;

  insert into public.returns (session_id, sale_id, cashier_id, reason, total_cents)
  values (v_session_id, p_sale_id, v_uid, nullif(p_reason, ''), 0)
  returning id into v_return_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_sale_item_id := nullif(v_item ->> 'sale_item_id', '')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Uno de los artículos de la devolución es inválido.';
    end;

    v_raw_quantity := v_item ->> 'quantity';
    if v_sale_item_id is null or v_raw_quantity is null or v_raw_quantity !~ '^[0-9]+$' then
      raise exception 'Uno de los artículos de la devolución es inválido.';
    end if;
    v_quantity := v_raw_quantity::integer;
    if v_quantity <= 0 then
      raise exception 'Uno de los artículos de la devolución es inválido.';
    end if;

    -- Lock the sale_item row for the rest of this transaction so two
    -- concurrent returns against the same line can't both read the same
    -- already-returned quantity and both pass validation (over-return race).
    -- Under READ COMMITTED, a call that blocks here re-reads the row (and,
    -- in the next statement, return_items) once the lock is released.
    select sale_id, quantity, unit_price_cents
    into v_item_sale_id, v_sold_quantity, v_unit_price_cents
    from public.sale_items
    where id = v_sale_item_id
    for update;

    if v_item_sale_id is null or v_item_sale_id <> p_sale_id then
      raise exception 'El artículo no pertenece a la venta indicada.';
    end if;

    -- Sum already-returned quantity, including any rows inserted earlier in
    -- this same call, so duplicate lines within one request can't over-return.
    select coalesce(sum(quantity), 0) into v_returned_quantity
    from public.return_items
    where sale_item_id = v_sale_item_id;

    if v_quantity > (v_sold_quantity - v_returned_quantity) then
      raise exception 'La cantidad a devolver excede lo disponible para ese artículo.';
    end if;

    v_amount_cents := v_unit_price_cents * v_quantity;

    insert into public.return_items (return_id, sale_item_id, quantity, amount_cents)
    values (v_return_id, v_sale_item_id, v_quantity, v_amount_cents);

    v_total_cents := v_total_cents + v_amount_cents;
  end loop;

  update public.returns set total_cents = v_total_cents where id = v_return_id;

  return jsonb_build_object('return_id', v_return_id, 'total_cents', v_total_cents);
end;
$$;

-- Read-only preview of a session's totals (used to show the corte de caja
-- before it is closed). Anyone signed in may preview the currently open
-- session; only admins may preview a closed/historical one.
create or replace function public.get_cash_summary(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_opening_cents integer;
  v_closed_at timestamptz;
  v_sales_total_cents integer;
  v_sales_count integer;
  v_returns_total_cents integer;
  v_returns_count integer;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para consultar el corte de caja.';
  end if;

  select opening_cents, closed_at into v_opening_cents, v_closed_at
  from public.cash_sessions
  where id = p_session_id;

  if v_opening_cents is null then
    raise exception 'La sesión de caja indicada no existe.';
  end if;

  if v_closed_at is not null and not public.is_admin(v_uid) then
    raise exception 'No tienes permiso para consultar esta sesión.';
  end if;

  select coalesce(sum(total_cents), 0), count(*) into v_sales_total_cents, v_sales_count
  from public.sales where session_id = p_session_id;

  select coalesce(sum(total_cents), 0), count(*) into v_returns_total_cents, v_returns_count
  from public.returns where session_id = p_session_id;

  return jsonb_build_object(
    'opening_cents', v_opening_cents,
    'sales_total_cents', v_sales_total_cents,
    'sales_count', v_sales_count,
    'returns_total_cents', v_returns_total_cents,
    'returns_count', v_returns_count,
    'expected_cents', v_opening_cents + v_sales_total_cents - v_returns_total_cents
  );
end;
$$;

-- Closes the currently open session, stamping expected/counted/difference.
create or replace function public.close_cash_session(p_counted_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_opening_cents integer;
  v_sales_total_cents integer;
  v_returns_total_cents integer;
  v_expected_cents integer;
  v_difference_cents integer;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para cerrar la caja.';
  end if;

  if p_counted_cents is null or p_counted_cents < 0 then
    raise exception 'El efectivo contado no es válido.';
  end if;

  select id, opening_cents into v_session_id, v_opening_cents
  from public.cash_sessions
  where closed_at is null
  limit 1;

  if v_session_id is null then
    raise exception 'No hay una caja abierta para cerrar.';
  end if;

  select coalesce(sum(total_cents), 0) into v_sales_total_cents
  from public.sales where session_id = v_session_id;

  select coalesce(sum(total_cents), 0) into v_returns_total_cents
  from public.returns where session_id = v_session_id;

  v_expected_cents := v_opening_cents + v_sales_total_cents - v_returns_total_cents;
  v_difference_cents := p_counted_cents - v_expected_cents;

  update public.cash_sessions
  set closed_by = v_uid,
      closed_at = now(),
      counted_cents = p_counted_cents,
      expected_cents = v_expected_cents,
      difference_cents = v_difference_cents
  where id = v_session_id;

  return jsonb_build_object(
    'session_id', v_session_id,
    'expected_cents', v_expected_cents,
    'counted_cents', p_counted_cents,
    'difference_cents', v_difference_cents
  );
end;
$$;

revoke all on function public.open_cash_session(integer) from public;
revoke all on function public.create_sale(jsonb, integer) from public;
revoke all on function public.create_return(uuid, jsonb, text) from public;
revoke all on function public.get_cash_summary(uuid) from public;
revoke all on function public.close_cash_session(integer) from public;

grant execute on function public.open_cash_session(integer) to authenticated;
grant execute on function public.create_sale(jsonb, integer) to authenticated;
grant execute on function public.create_return(uuid, jsonb, text) to authenticated;
grant execute on function public.get_cash_summary(uuid) to authenticated;
grant execute on function public.close_cash_session(integer) to authenticated;
