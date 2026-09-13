-- Individual history deletion only. No direct table privileges or policies change.
create function public.delete_closed_cash_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_closed_at timestamptz;
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'Solo un administrador puede eliminar cortes.' using errcode = '42501';
  end if;
  if p_session_id is null then
    raise exception 'Selecciona un corte válido.';
  end if;

  -- Existing sale/return/close RPCs do not share a row-lock protocol.
  -- Lock all five tables in this fixed order before reading any target data.
  -- These transaction-scoped locks block writes (including new FK edges),
  -- but allow ordinary reads. Keep this RPC short; never call it in a long transaction.
  lock table public.cash_sessions, public.sales, public.sale_items,
    public.returns, public.return_items in share row exclusive mode;

  select closed_at into v_closed_at
    from public.cash_sessions where id = p_session_id;
  if not found then
    raise exception 'El corte ya no existe.';
  end if;
  if v_closed_at is null then
    raise exception 'No se puede eliminar una caja abierta.';
  end if;

  -- Reject edges crossing the selected session boundary in BOTH directions.
  if exists (
    select 1 from public.returns r
    join public.sales s on s.id = r.sale_id
    where (r.session_id = p_session_id and s.session_id <> p_session_id)
       or (r.session_id <> p_session_id and s.session_id = p_session_id)
  ) then
    raise exception 'El corte tiene devoluciones vinculadas a otro corte; no se eliminó ningún dato.';
  end if;
  if exists (
    select 1 from public.return_items ri
    join public.returns r on r.id = ri.return_id
    join public.sale_items si on si.id = ri.sale_item_id
    join public.sales s on s.id = si.sale_id
    where (r.session_id = p_session_id and s.session_id <> p_session_id)
       or (r.session_id <> p_session_id and s.session_id = p_session_id)
  ) then
    raise exception 'El corte tiene artículos devueltos vinculados a otro corte; no se eliminó ningún dato.';
  end if;

  -- Explicit child-first, scoped deletion. Any failure rolls back the whole RPC.
  delete from public.return_items ri using public.returns r
    where ri.return_id = r.id and r.session_id = p_session_id;
  delete from public.returns where session_id = p_session_id;
  delete from public.sale_items si using public.sales s
    where si.sale_id = s.id and s.session_id = p_session_id;
  delete from public.sales where session_id = p_session_id;
  delete from public.cash_sessions where id = p_session_id;

  return jsonb_build_object('deleted_session_id', p_session_id);
end;
$$;

revoke all on function public.delete_closed_cash_session(uuid) from public, anon;
grant execute on function public.delete_closed_cash_session(uuid) to authenticated;
