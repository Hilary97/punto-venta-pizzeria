-- Rejects a new order, from a waiter device or the cashier, for a table that already has an
-- open order; staff add products to the open order instead. Orders identified only by
-- customer name are unaffected.

-- insert_order_core (20261029120000) plus the open-table guard; signature unchanged.
create or replace function public.insert_order_core(
  p_created_by uuid,
  p_waiter_id uuid,
  p_waiter_name text,
  p_table_number integer,
  p_customer_name text,
  p_items jsonb,
  p_notes text,
  p_scheduled_for timestamptz,
  p_service text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_name text := nullif(btrim(p_customer_name), '');
  v_notes text := public.normalize_order_notes(p_notes);
  v_order_id uuid;
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

  if p_service is not null and p_service not in ('dine_in', 'takeaway') then
    raise exception 'El tipo de pedido no es válido.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe incluir al menos un producto.';
  end if;

  if p_scheduled_for is not null and (
    p_scheduled_for <= public.app_now()
    or (p_scheduled_for at time zone 'America/Mexico_City')::date
       <> (public.app_now() at time zone 'America/Mexico_City')::date
  ) then
    raise exception 'La hora del pedido debe ser más tarde hoy.';
  end if;

  -- One open order per table: staff add products to it instead. The lock serialises
  -- concurrent creations for the same table, so two devices cannot both pass the check
  -- before either inserts.
  if p_table_number is not null then
    perform pg_advisory_xact_lock(hashtext('orders.open_table'), p_table_number);
    if exists (select 1 from public.orders where table_number = p_table_number and status = 'open') then
      raise exception 'La mesa % ya tiene un pedido abierto.', p_table_number;
    end if;
  end if;

  insert into public.orders (table_number, customer_name, created_by, waiter_id, waiter_name, notes, scheduled_for, service)
  values (p_table_number, v_customer_name, p_created_by, p_waiter_id, p_waiter_name, v_notes, p_scheduled_for, p_service)
  returning id into v_order_id;

  perform public.insert_order_lines(v_order_id, p_items);

  return v_order_id;
end;
$$;

revoke all on function public.insert_order_core(uuid, uuid, text, integer, text, jsonb, text, timestamptz, text)
  from public, anon, authenticated;
