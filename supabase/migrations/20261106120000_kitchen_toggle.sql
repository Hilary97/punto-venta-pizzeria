-- Kitchen on/off switch, for when the staff write orders on paper stickers
-- instead of using the Cocina and Entrega screens.
--
--   * kitchen_settings.enabled (single row, starts on). Read with
--     kitchen_enabled(); only an admin changes it with set_kitchen_enabled().
--   * While off, every line inserted into an order is stored as ready and
--     delivered at once (statement trigger on order_items), so it never shows
--     in Cocina or Entrega, the order frees its token, and pay_order ends the
--     order at payment as it does for fully delivered orders.
--   * Switching off finishes every pending line of the orders in service the
--     same way, so the boards are left empty. Switching on changes nothing
--     already stored; only lines created afterwards go through the kitchen.
--
-- The trigger reads the setting with `for share` and the switch updates it,
-- so an order saved while the switch commits is either finished by the switch
-- or by its own trigger, never left behind on the boards.
--
-- Runs as one script (Supabase SQL Editor).

create table if not exists public.kitchen_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true
);

insert into public.kitchen_settings (id, enabled) values (true, true)
on conflict (id) do nothing;

-- Read and written only through the functions below.
alter table public.kitchen_settings enable row level security;

create or replace function public.kitchen_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select enabled from public.kitchen_settings where id), true);
$$;

-- Marks every pending line of the given orders in service as ready and
-- delivered, frees their tokens and ends the paid ones.
create or replace function public.finish_kitchen_lines(p_order_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then
    return;
  end if;

  update public.order_items
  set ready_at = coalesce(ready_at, now()),
      delivered_at = now()
  where order_id = any(p_order_ids)
    and delivered_at is null;

  -- queued_at is set so a scheduled order is never released later with a token.
  update public.orders
  set token = null,
      queued_at = coalesce(queued_at, public.app_now()),
      served_at = case when status = 'paid' then now() else served_at end
  where id = any(p_order_ids)
    and (status = 'open' or (status = 'paid' and served_at is null));
end;
$$;

create or replace function public.skip_kitchen_when_off()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  select enabled into v_enabled from public.kitchen_settings where id for share;

  if coalesce(v_enabled, true) then
    return null;
  end if;

  perform public.finish_kitchen_lines(array(select distinct order_id from new_items));
  return null;
end;
$$;

drop trigger if exists order_items_skip_kitchen on public.order_items;
create trigger order_items_skip_kitchen
  after insert on public.order_items
  referencing new table as new_items
  for each statement execute function public.skip_kitchen_when_off();

create or replace function public.set_kitchen_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede activar o desactivar la cocina.' using errcode = '42501';
  end if;

  if p_enabled is null then
    raise exception 'Indica si la cocina está activa.';
  end if;

  update public.kitchen_settings set enabled = p_enabled where id;

  if not p_enabled then
    perform public.finish_kitchen_lines(array(
      select id from public.orders
      where status = 'open' or (status = 'paid' and served_at is null)
    ));
  end if;

  return p_enabled;
end;
$$;

revoke all on function public.kitchen_enabled() from public;
revoke all on function public.finish_kitchen_lines(uuid[]) from public, anon, authenticated;
revoke all on function public.skip_kitchen_when_off() from public, anon, authenticated;
revoke all on function public.set_kitchen_enabled(boolean) from public;

grant execute on function public.kitchen_enabled() to authenticated;
grant execute on function public.set_kitchen_enabled(boolean) to authenticated;
