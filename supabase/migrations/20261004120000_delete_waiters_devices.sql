-- Permanent deletion of waiters and revoked order devices.
--
-- Written by hand (no Supabase CLI available in the authoring environment).
--
-- Order history is preserved:
--   * orders.waiter_name is a snapshot taken when the order is created, and
--     orders.waiter_id is `on delete set null`, so deleting a waiter keeps
--     every order and its waiter name; only the link is cleared.
--   * waiter_shifts reference waiters and devices with `on delete cascade`,
--     so their (disposable) shifts are removed with them.
--   * Orders do not reference devices at all.
--
-- Devices must be revoked before they can be deleted: revoking cuts access
-- immediately, deleting only cleans up the list.

create or replace function public.admin_delete_waiter(p_waiter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar meseros.';
  end if;

  if p_waiter_id is null then
    raise exception 'Selecciona un mesero válido.';
  end if;

  delete from public.waiters where id = p_waiter_id;

  if not found then
    raise exception 'El mesero ya no existe.';
  end if;

  return jsonb_build_object('deleted_waiter_id', p_waiter_id);
end;
$$;

create or replace function public.admin_delete_device(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revoked_at timestamptz;
  v_exists boolean;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar dispositivos.';
  end if;

  select true, d.revoked_at
  into v_exists, v_revoked_at
  from public.order_devices d
  where d.id = p_device_id
  for update;

  if v_exists is null then
    raise exception 'El dispositivo ya no existe.';
  end if;

  if v_revoked_at is null then
    raise exception 'Revoca el dispositivo antes de eliminarlo.';
  end if;

  delete from public.order_devices where id = p_device_id;

  return jsonb_build_object('deleted_device_id', p_device_id);
end;
$$;

revoke all on function public.admin_delete_waiter(uuid) from public, anon;
revoke all on function public.admin_delete_device(uuid) from public, anon;
grant execute on function public.admin_delete_waiter(uuid) to authenticated;
grant execute on function public.admin_delete_device(uuid) to authenticated;
