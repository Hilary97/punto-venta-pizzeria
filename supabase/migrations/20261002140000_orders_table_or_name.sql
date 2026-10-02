-- Orders: table number OR customer name.
--
-- Written by hand (no Supabase CLI available in the authoring environment).
--
-- Product rule change: an order needs a table number, a customer name, or
-- both. At least one is required. Supersedes the "both mandatory" rule of
-- 20261002120000_orders.sql, which is left untouched because it may already
-- be applied.

-- ============================================================================
-- Columns and constraints
-- ============================================================================

alter table public.orders alter column table_number drop not null;
alter table public.orders alter column customer_name drop not null;

-- Inline checks from the original migration get Postgres default names.
alter table public.orders drop constraint if exists orders_table_number_check;
alter table public.orders drop constraint if exists orders_customer_name_check;

alter table public.orders
  add constraint orders_table_number_range
  check (table_number is null or table_number between 1 and 9);

alter table public.orders
  add constraint orders_customer_name_length
  check (customer_name is null or length(btrim(customer_name)) between 1 and 80);

alter table public.orders
  add constraint orders_table_or_name_required
  check (table_number is not null or customer_name is not null);

-- ============================================================================
-- RPC (SECURITY DEFINER)
-- ============================================================================

-- Creates an open order. `p_items` is a jsonb array of
-- {"product_id": uuid, "quantity": int}. Duplicate product_ids are merged by
-- summing their quantities. The product name is snapshotted; no price is read
-- or stored. Table and customer name are both optional, but at least one must
-- be provided.
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
  v_customer_name text := nullif(btrim(p_customer_name), '');
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

revoke all on function public.create_order(integer, text, jsonb) from public;
grant execute on function public.create_order(integer, text, jsonb) to authenticated;
