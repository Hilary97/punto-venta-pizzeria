-- Supplies inventory with purchase costs (odd/tasks/supplies.md).
-- Manual inventory of supplies (cheese, flour, boxes), separate from products:
-- orders, kitchen and payments never touch it. Admins register purchases
-- (quantity received + amount paid, added to the stock) and counts (sets the
-- stock) through RPCs that also write a movement row; a third RPC lists the
-- purchases in a date range. Everything here is admin only.

-- A. Tables
create table public.supplies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null,
  stock numeric(12, 3) not null default 0,
  stock_min numeric(12, 3) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint supplies_name_not_blank check (length(btrim(name)) > 0),
  constraint supplies_unit_valid check (unit in ('kg', 'g', 'l', 'ml', 'pz')),
  constraint supplies_stock_not_negative check (stock >= 0),
  constraint supplies_stock_min_not_negative check (stock_min >= 0)
);

create unique index supplies_name_key on public.supplies (lower(btrim(name)));

create table public.supply_movements (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies (id),
  kind text not null,
  quantity numeric(12, 3) not null,
  cost_cents integer,
  stock_after numeric(12, 3) not null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint supply_movements_kind_valid check (kind in ('purchase', 'count')),
  constraint supply_movements_quantity_valid check (
    (kind = 'purchase' and quantity > 0) or (kind = 'count' and quantity >= 0)
  ),
  constraint supply_movements_cost_valid check (
    (kind = 'purchase' and cost_cents is not null and cost_cents >= 0)
    or (kind = 'count' and cost_cents is null)
  ),
  constraint supply_movements_stock_after_not_negative check (stock_after >= 0)
);

create index supply_movements_kind_created_at_idx on public.supply_movements (kind, created_at);
create index supply_movements_supply_id_idx on public.supply_movements (supply_id);

-- B. RLS: admin only; movements are read-only for clients
alter table public.supplies enable row level security;
alter table public.supply_movements enable row level security;

create policy supplies_select_admin on public.supplies
  for select to authenticated using (public.is_admin());
create policy supplies_insert_admin on public.supplies
  for insert to authenticated with check (public.is_admin());
create policy supplies_update_admin on public.supplies
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy supply_movements_select_admin on public.supply_movements
  for select to authenticated using (public.is_admin());

-- Table privileges: no delete (deactivate instead). The stock column is not
-- writable by clients, only through the RPCs, so every change leaves a movement.
revoke all on public.supplies, public.supply_movements from public, anon, authenticated;
grant select on public.supplies, public.supply_movements to authenticated;
grant insert (name, unit, stock_min, active), update (name, unit, stock_min, active)
  on public.supplies to authenticated;

-- C. RPCs
create or replace function public.admin_record_supply_purchase(
  p_supply_id uuid,
  p_quantity numeric,
  p_cost_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar insumos.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a cero.';
  end if;
  if p_quantity > 999999999.999 then
    raise exception 'La cantidad es demasiado grande.';
  end if;
  if p_cost_cents is null or p_cost_cents < 0 then
    raise exception 'El monto pagado no es válido.';
  end if;
  if p_cost_cents > 2000000000 then
    raise exception 'El monto pagado es demasiado grande.';
  end if;

  perform 1 from public.supplies where id = p_supply_id and active = true for no key update;
  if not found then
    raise exception 'El insumo no existe.';
  end if;

  update public.supplies
  set stock = stock + p_quantity
  where id = p_supply_id
  returning stock into v_stock;

  -- clock_timestamp() so movement times follow the row-lock order, not the transaction start.
  insert into public.supply_movements (supply_id, kind, quantity, cost_cents, stock_after, created_at)
  values (p_supply_id, 'purchase', p_quantity, p_cost_cents, v_stock, clock_timestamp());

  return jsonb_build_object('supply_id', p_supply_id, 'stock', v_stock);
end;
$$;

create or replace function public.admin_count_supply(p_supply_id uuid, p_counted numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar insumos.';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'El conteo no puede ser negativo.';
  end if;
  if p_counted > 999999999.999 then
    raise exception 'La cantidad es demasiado grande.';
  end if;

  perform 1 from public.supplies where id = p_supply_id and active = true for no key update;
  if not found then
    raise exception 'El insumo no existe.';
  end if;

  update public.supplies
  set stock = p_counted
  where id = p_supply_id
  returning stock into v_stock;

  insert into public.supply_movements (supply_id, kind, quantity, cost_cents, stock_after, created_at)
  values (p_supply_id, 'count', p_counted, null, v_stock, clock_timestamp());

  return jsonb_build_object('supply_id', p_supply_id, 'stock', v_stock);
end;
$$;

create or replace function public.admin_list_supply_purchases(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar insumos.';
  end if;
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'El rango de fechas no es válido.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'supply_id', m.supply_id,
          'supply_name', s.name,
          'unit', s.unit,
          'quantity', m.quantity,
          'cost_cents', m.cost_cents,
          'created_by_name', pr.full_name,
          'created_at', m.created_at
        )
        order by m.created_at desc, m.id
      )
      from public.supply_movements m
      join public.supplies s on s.id = m.supply_id
      left join public.profiles pr on pr.id = m.created_by
      where m.kind = 'purchase' and m.created_at >= p_from and m.created_at < p_to
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.admin_record_supply_purchase(uuid, numeric, integer) from public, anon;
revoke all on function public.admin_count_supply(uuid, numeric) from public, anon;
revoke all on function public.admin_list_supply_purchases(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_record_supply_purchase(uuid, numeric, integer) to authenticated;
grant execute on function public.admin_count_supply(uuid, numeric) to authenticated;
grant execute on function public.admin_list_supply_purchases(timestamptz, timestamptz) to authenticated;
