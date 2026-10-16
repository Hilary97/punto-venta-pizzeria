-- Realtime change signal for the Cocina and Entrega boards.
--
-- Boards used to poll every 10 seconds. Kitchen devices have no Supabase
-- user, so Realtime `postgres_changes` (which honours RLS) cannot reach them.
-- Instead, any change to orders or their lines sends an empty Broadcast
-- message on the public `kitchen` channel; boards then reload through the
-- same RPCs as before. The message carries no order data.
--
-- A failing broadcast must never block an order write, so errors are
-- swallowed.
--
-- One write may run several statements (and cascades run one per parent
-- row), so the signal is sent at most once per transaction. Realtime delivers
-- it after commit; a rolled-back write sends nothing.
--
-- Runs as one script (Supabase SQL Editor).

create or replace function public.notify_kitchen_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.kitchen_signal_sent', true) = 'on' then
    return null;
  end if;
  perform set_config('app.kitchen_signal_sent', 'on', true);

  begin
    perform realtime.send('{}'::jsonb, 'changed', 'kitchen', false);
  exception when others then
    raise warning 'kitchen realtime signal failed: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.notify_kitchen_changed() from public, anon, authenticated;

drop trigger if exists orders_notify_kitchen on public.orders;
create trigger orders_notify_kitchen
after insert or update or delete on public.orders
for each statement execute function public.notify_kitchen_changed();

drop trigger if exists order_items_notify_kitchen on public.order_items;
create trigger order_items_notify_kitchen
after insert or update or delete on public.order_items
for each statement execute function public.notify_kitchen_changed();
