-- Categories created from the products screen are inserted without sort_order.
-- They used to default to 0 and jump to the front of the order buttons;
-- now they are appended after the last category. Explicit sort_order values are kept.
alter table public.categories alter column sort_order drop default;

create or replace function public.categories_append_sort_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sort_order is null then
    select coalesce(max(c.sort_order), 0) + 1
      into new.sort_order
      from public.categories c;
  end if;
  return new;
end;
$$;

drop trigger if exists categories_append_sort_order on public.categories;

create trigger categories_append_sort_order
before insert on public.categories
for each row execute function public.categories_append_sort_order();
