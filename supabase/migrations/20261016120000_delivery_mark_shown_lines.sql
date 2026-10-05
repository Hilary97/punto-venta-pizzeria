-- Delivery: mark delivered only the lines the waiter was shown.
--
-- Before, "Entregado" marked every ready, undelivered line of the order,
-- including lines that became ready after the waiter's last refresh (a drink is
-- ready on arrival, a kitchen line may have just been marked ready), so unseen
-- lines were delivered. The delivery functions now take the line ids displayed
-- on the card and only touch those.
--
-- Runs as one script (Supabase SQL Editor).

drop function if exists public.device_mark_delivered(text, uuid, uuid);
drop function if exists public.mark_delivered(uuid);
drop function if exists public.mark_delivered_core(uuid);

create or replace function public.mark_delivered_core(p_order_id uuid, p_line_ids uuid[])
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

  if p_line_ids is null or coalesce(array_length(p_line_ids, 1), 0) = 0 then
    raise exception 'Indica las líneas del pedido.';
  end if;

  select status into v_status from public.orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'El pedido indicado no existe.';
  end if;

  if v_status <> 'open' then
    raise exception 'El pedido ya no está abierto.';
  end if;

  update public.order_items
  set delivered_at = now()
  where id = any(p_line_ids)
    and order_id = p_order_id
    and ready_at is not null
    and delivered_at is null;

  return p_order_id;
end;
$$;

create or replace function public.device_mark_delivered(
  p_device_secret text,
  p_shift_token uuid,
  p_order_id uuid,
  p_line_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.order_devices;
begin
  v_device := public.resolve_waiter_device(p_device_secret);
  perform 1 from public.resolve_waiter_shift(v_device.id, p_shift_token);

  return jsonb_build_object('order_id', public.mark_delivered_core(p_order_id, p_line_ids));
end;
$$;

create or replace function public.mark_delivered(p_order_id uuid, p_line_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_operate_register() then
    raise exception 'No tienes permiso para operar la caja.';
  end if;

  return jsonb_build_object('order_id', public.mark_delivered_core(p_order_id, p_line_ids));
end;
$$;

revoke all on function public.mark_delivered_core(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.mark_delivered(uuid, uuid[]) from public, anon;
grant execute on function public.mark_delivered(uuid, uuid[]) to authenticated;
revoke all on function public.device_mark_delivered(text, uuid, uuid, uuid[]) from public;
grant execute on function public.device_mark_delivered(text, uuid, uuid, uuid[]) to anon, authenticated;
