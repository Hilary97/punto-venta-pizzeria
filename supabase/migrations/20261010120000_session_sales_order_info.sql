-- Order info (customer, table, waiter) for the sales of a cash session.
--
-- Cashiers cannot read paid orders directly (orders_select only exposes open
-- orders to non-admins), so the Devoluciones sale cards get this data through
-- a SECURITY DEFINER function restricted to cash roles. POS sales without an
-- order produce no row.

create or replace function public.list_session_sale_orders(p_session_id uuid)
returns table (
  sale_id uuid,
  customer_name text,
  table_number integer,
  waiter_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para operar la caja.' using errcode = '42501';
  end if;

  return query
    select o.paid_sale_id, o.customer_name, o.table_number, o.waiter_name
    from public.orders o
    join public.sales s on s.id = o.paid_sale_id
    where s.session_id = p_session_id;
end;
$$;

revoke all on function public.list_session_sale_orders(uuid) from public, anon;
grant execute on function public.list_session_sale_orders(uuid) to authenticated;
