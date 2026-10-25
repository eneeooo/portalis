-- Run after migration_fund_advance_payments.sql.

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('user', 'officer', 'admin'));

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'officer')
  );
$$;
