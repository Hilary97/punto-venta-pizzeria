-- Waiter orders.
--
-- Written by hand (no Supabase CLI available in the authoring environment).
--
-- Design summary:
--   * A new 'waiter' role may create orders (table 1..9 + customer name +
--     products/quantities), add items to them and cancel them, but may not
--     charge them.
--   * Orders NEVER store prices. Prices are read from `products` only when
--     an order is paid, via the existing create_sale RPC, so a price edit
--     between ordering and paying is always honoured.
--   * orders / order_items are read-only for clients (no insert/update/delete
--     policies, write privileges revoked). All writes go through the
--     security-definer RPCs at the bottom.

-- ============================================================================
-- Role: allow 'waiter'
-- ============================================================================

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'cashier', 'waiter'));

-- ============================================================================
-- Tables
-- ============================================================================

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  table_number integer not null check (table_number between 1 and 9),
  customer_name text not null check (length(btrim(customer_name)) between 1 and 80),
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  paid_sale_id uuid unique references public.sales (id),
  paid_at timestamptz,
  cancelled_at timestamptz,
  constraint orders_status_fields_consistent check (
    (status = 'open' and paid_sale_id is null and paid_at is null and cancelled_at is null)
    or
    (status = 'paid' and paid_sale_id is not null and paid_at is not null and cancelled_at is null)
    or
    (status = 'cancelled' and cancelled_at is not null and paid_sale_id is null and paid_at is null)
  )
);

-- No price columns on purpose: prices are resolved from `products` at payment.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unique (order_id, product_id)
);

-- ============================================================================
-- Indexes
-- ============================================================================

create index orders_status_idx on public.orders (status);
create index order_items_order_id_idx on public.order_items (order_id);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Any signed-in user sees open orders; admins see every order. There are
-- intentionally no insert/update/delete policies: all writes happen through
-- the SECURITY DEFINER RPCs further below.
create policy orders_select on public.orders
  for select to authenticated
  using (status = 'open' or public.is_admin());

create policy order_items_select on public.order_items
  for select to authenticated
  using (
    public.is_admin()
    or order_id in (select id from public.orders where status = 'open')
  );

-- Defense in depth, same as the other RPC-written tables.
revoke insert, update, delete on public.orders from authenticated, anon;
revoke insert, update, delete on public.order_items from authenticated, anon;
revoke select on public.orders from anon;
revoke select on public.order_items from anon;

-- ============================================================================
-- RPCs (SECURITY DEFINER)
-- ============================================================================

-- Creates an open order. `p_items` is a jsonb array of
-- {"product_id": uuid, "quantity": int}. Duplicate product_ids are merged by
-- summing their quantities. The product name is snapshotted; no price is read
-- or stored.
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
  v_customer_name text := btrim(p_customer_name);
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

  if p_table_number is null or p_table_number < 1 or p_table_number > 9 then
    raise exception 'El número de mesa no es válido.';
  end if;

  if v_customer_name is null or length(v_customer_name) < 1 or length(v_customer_name) > 80 then
    raise exception 'El nombre del cliente no es válido.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe incluir al menos un producto.';
  end if;

  insert into public.orders (table_number, customer_name, created_by)
  values (p_table_number, v_customer_name, v_uid)
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

-- Adds items to an open order. Existing lines for the same product have the
-- new quantity added to them.
create or replace function public.add_order_items(p_order_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_item jsonb;
  v_product_id uuid;
  v_raw_quantity text;
  v_quantity integer;
  v_product_name text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para modificar un pedido.';
  end if;

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

  return jsonb_build_object('order_id', p_order_id);
end;
$$;

-- Cancels an open order.
create or replace function public.cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para cancelar un pedido.';
  end if;

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

  return jsonb_build_object('order_id', p_order_id);
end;
$$;

-- Charges an open order by delegating to create_sale, which re-reads current
-- prices from `products`. Waiters may not charge. The whole body is a single
-- transaction: if create_sale raises (no open register, insufficient cash,
-- inactive product...) the order stays open untouched.
create or replace function public.pay_order(p_order_id uuid, p_received_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_status text;
  v_items jsonb;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para cobrar un pedido.';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is null or v_role = 'waiter' then
    raise exception 'No tienes permiso para cobrar pedidos.' using errcode = '42501';
  end if;

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

  if exists (
    select 1 from public.order_items where order_id = p_order_id and product_id is null
  ) then
    raise exception 'El pedido incluye un producto que ya fue eliminado. Cancela el pedido y créalo de nuevo.';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity)),
    '[]'::jsonb
  )
  into v_items
  from public.order_items
  where order_id = p_order_id;

  v_result := public.create_sale(v_items, p_received_cents);

  update public.orders
  set status = 'paid',
      paid_sale_id = (v_result ->> 'sale_id')::uuid,
      paid_at = now()
  where id = p_order_id;

  return v_result || jsonb_build_object('order_id', p_order_id);
end;
$$;

revoke all on function public.create_order(integer, text, jsonb) from public;
revoke all on function public.add_order_items(uuid, jsonb) from public;
revoke all on function public.cancel_order(uuid) from public;
revoke all on function public.pay_order(uuid, integer) from public;

grant execute on function public.create_order(integer, text, jsonb) to authenticated;
grant execute on function public.add_order_items(uuid, jsonb) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;
grant execute on function public.pay_order(uuid, integer) to authenticated;
