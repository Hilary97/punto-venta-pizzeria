-- Restrict open-session reads to logged-in users only.
--
-- The original SELECT policies on cash_sessions / sales / sale_items /
-- returns / return_items (20260912120000_init.sql) had no role restriction:
-- `closed_at is null or public.is_admin()` evaluates fine for the `anon`
-- role too, since public.is_admin() just resolves to false when auth.uid()
-- is null instead of erroring. The Supabase anon key is public by design
-- (it ships inside the client JS bundle), so this let anyone with the
-- project URL + anon key read every sale, return and cash total of
-- whatever session was currently open, via the REST API directly,
-- without ever authenticating.
--
-- Fix: recreate the same five policies scoped `to authenticated`, and
-- explicitly revoke table-level SELECT from `anon` as defense in depth
-- (matching the write-privilege revokes already done in the init
-- migration), so a future permissive policy added without `to
-- authenticated` still can't be exploited by anonymous requests.

drop policy if exists cash_sessions_select on public.cash_sessions;
create policy cash_sessions_select on public.cash_sessions
  for select to authenticated
  using (closed_at is null or public.is_admin());

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
  for select to authenticated
  using (
    public.is_admin()
    or session_id in (select id from public.cash_sessions where closed_at is null)
  );

drop policy if exists sale_items_select on public.sale_items;
create policy sale_items_select on public.sale_items
  for select to authenticated
  using (
    public.is_admin()
    or sale_id in (
      select s.id
      from public.sales s
      join public.cash_sessions cs on cs.id = s.session_id
      where cs.closed_at is null
    )
  );

drop policy if exists returns_select on public.returns;
create policy returns_select on public.returns
  for select to authenticated
  using (
    public.is_admin()
    or session_id in (select id from public.cash_sessions where closed_at is null)
  );

drop policy if exists return_items_select on public.return_items;
create policy return_items_select on public.return_items
  for select to authenticated
  using (
    public.is_admin()
    or return_id in (
      select r.id
      from public.returns r
      join public.cash_sessions cs on cs.id = r.session_id
      where cs.closed_at is null
    )
  );

revoke select on public.cash_sessions from anon;
revoke select on public.sales from anon;
revoke select on public.sale_items from anon;
revoke select on public.returns from anon;
revoke select on public.return_items from anon;
