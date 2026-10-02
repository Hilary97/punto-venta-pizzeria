-- Block waiters from the cash-register RPCs.
--
-- The 'waiter' role (20261002120000_orders.sql) may only manage orders. The
-- cash RPCs from 20260912120000_init.sql (open_cash_session, create_sale,
-- create_return, get_cash_summary, close_cash_session) only check that the
-- caller is authenticated, so a waiter could call them directly through the
-- REST API even though the UI hides them.
--
-- Fix without duplicating the large function bodies: each original function
-- is renamed to <name>_unchecked and stripped of every client privilege, and
-- a thin SECURITY DEFINER wrapper with the original name and signature
-- checks public.can_operate_register() before delegating. The wrapper runs
-- as the function owner, so it can still call the revoked _unchecked
-- function; auth.uid() keeps resolving from the JWT claims inside it.
-- pay_order calls public.create_sale by name at runtime, so it now goes
-- through the wrapper (cashiers and admins pass, waiters are already
-- rejected by pay_order itself).

-- Only admins and cashiers may operate the register. A missing profile or
-- an unauthenticated caller (null uid) yields false.
create or replace function public.can_operate_register(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.role in ('admin', 'cashier')
  );
$$;

revoke all on function public.can_operate_register(uuid) from public;
grant execute on function public.can_operate_register(uuid) to authenticated;

-- open_cash_session
alter function public.open_cash_session(integer) rename to open_cash_session_unchecked;
revoke all on function public.open_cash_session_unchecked(integer) from public, authenticated, anon;

create or replace function public.open_cash_session(p_opening_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para operar la caja.' using errcode = '42501';
  end if;

  return public.open_cash_session_unchecked(p_opening_cents);
end;
$$;

revoke all on function public.open_cash_session(integer) from public;
grant execute on function public.open_cash_session(integer) to authenticated;

-- create_sale
alter function public.create_sale(jsonb, integer) rename to create_sale_unchecked;
revoke all on function public.create_sale_unchecked(jsonb, integer) from public, authenticated, anon;

create or replace function public.create_sale(p_items jsonb, p_received_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para operar la caja.' using errcode = '42501';
  end if;

  return public.create_sale_unchecked(p_items, p_received_cents);
end;
$$;

revoke all on function public.create_sale(jsonb, integer) from public;
grant execute on function public.create_sale(jsonb, integer) to authenticated;

-- create_return
alter function public.create_return(uuid, jsonb, text) rename to create_return_unchecked;
revoke all on function public.create_return_unchecked(uuid, jsonb, text) from public, authenticated, anon;

create or replace function public.create_return(p_sale_id uuid, p_items jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para operar la caja.' using errcode = '42501';
  end if;

  return public.create_return_unchecked(p_sale_id, p_items, p_reason);
end;
$$;

revoke all on function public.create_return(uuid, jsonb, text) from public;
grant execute on function public.create_return(uuid, jsonb, text) to authenticated;

-- get_cash_summary
alter function public.get_cash_summary(uuid) rename to get_cash_summary_unchecked;
revoke all on function public.get_cash_summary_unchecked(uuid) from public, authenticated, anon;

create or replace function public.get_cash_summary(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para operar la caja.' using errcode = '42501';
  end if;

  return public.get_cash_summary_unchecked(p_session_id);
end;
$$;

revoke all on function public.get_cash_summary(uuid) from public;
grant execute on function public.get_cash_summary(uuid) to authenticated;

-- close_cash_session
alter function public.close_cash_session(integer) rename to close_cash_session_unchecked;
revoke all on function public.close_cash_session_unchecked(integer) from public, authenticated, anon;

create or replace function public.close_cash_session(p_counted_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para operar la caja.' using errcode = '42501';
  end if;

  return public.close_cash_session_unchecked(p_counted_cents);
end;
$$;

revoke all on function public.close_cash_session(integer) from public;
grant execute on function public.close_cash_session(integer) to authenticated;
