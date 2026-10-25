-- Run after migration_confession_feelings_fund_admin.sql.

alter table public.fund_payments
  add column if not exists amount_paid numeric(10,2) not null default 0;
alter table public.fund_payments
  drop constraint if exists fund_payments_amount_paid_check;
alter table public.fund_payments
  add constraint fund_payments_amount_paid_check check (amount_paid >= 0);

update public.fund_payments
set amount_paid = amount_due
where is_paid and amount_paid = 0;

create table if not exists public.fund_contributions (
  fund_id bigint not null references public.funds(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  total_paid numeric(10,2) not null default 0 check (total_paid >= 0),
  updated_at timestamptz not null default now(),
  primary key (fund_id, user_id)
);
alter table public.fund_contributions enable row level security;
drop policy if exists "admin manage fund contributions" on public.fund_contributions;
create policy "admin manage fund contributions" on public.fund_contributions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.fund_contributions from anon, authenticated;

insert into public.fund_contributions (fund_id, user_id, total_paid)
select fp.fund_id, pay.user_id, sum(pay.amount_paid)
from public.fund_payments pay
join public.fund_periods fp on fp.id = pay.period_id
group by fp.fund_id, pay.user_id
on conflict (fund_id, user_id) do nothing;

drop function if exists public.get_fund_roster(bigint);
create function public.get_fund_roster(p_period_id bigint)
returns table (
  user_id uuid,
  student_number text,
  full_name text,
  amount_due numeric,
  amount_paid numeric,
  is_paid boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select p.id, p.student_number, coalesce(nullif(p.full_name, ''), 'Student'),
         coalesce(pay.amount_due, fp.amount_due),
         coalesce(pay.amount_paid, 0::numeric),
         coalesce(pay.is_paid, false)
  from public.profiles p
  join public.fund_periods fp on fp.id = p_period_id
  left join public.fund_payments pay on pay.period_id = fp.id and pay.user_id = p.id
  order by p.student_number;
end;
$$;
revoke all on function public.get_fund_roster(bigint) from public;
grant execute on function public.get_fund_roster(bigint) to authenticated;

drop function if exists public.get_fund_debt_summary(bigint);
create function public.get_fund_debt_summary(p_fund_id bigint)
returns table (
  user_id uuid,
  student_number text,
  full_name text,
  total_debt numeric,
  unpaid_periods integer,
  total_paid numeric,
  advance_credit numeric,
  role text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select p.id,
         p.student_number,
         coalesce(nullif(p.full_name, ''), 'Student'),
         greatest(coalesce(sum(fp.amount_due), 0) - coalesce(c.total_paid, 0), 0),
         count(*) filter (where coalesce(pay.amount_paid, 0) < fp.amount_due)::integer,
         coalesce(c.total_paid, 0),
         greatest(coalesce(c.total_paid, 0) - coalesce(sum(fp.amount_due), 0), 0),
         p.role
  from public.profiles p
  cross join public.fund_periods fp
  left join public.fund_payments pay on pay.period_id = fp.id and pay.user_id = p.id
  left join public.fund_contributions c on c.fund_id = fp.fund_id and c.user_id = p.id
  where fp.fund_id = p_fund_id
  group by p.id, p.student_number, p.full_name, c.total_paid, p.role
  order by p.student_number nulls last;
end;
$$;
revoke all on function public.get_fund_debt_summary(bigint) from public;
grant execute on function public.get_fund_debt_summary(bigint) to authenticated;

create or replace function public.set_fund_total_paid(
  p_fund_id bigint,
  p_user_id uuid,
  p_total_paid numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining numeric(10,2);
  v_allocated numeric(10,2);
  v_period record;
  v_paid_at timestamptz;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_total_paid is null or p_total_paid < 0 or p_total_paid > 99999999.99 then
    raise exception 'Total paid must be between zero and 99,999,999.99';
  end if;
  if not exists (select 1 from public.funds where id = p_fund_id) then
    raise exception 'Fund not found';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Student not found';
  end if;

  v_remaining := round(p_total_paid, 2);
  insert into public.fund_contributions (fund_id, user_id, total_paid, updated_at)
  values (p_fund_id, p_user_id, v_remaining, now())
  on conflict (fund_id, user_id)
  do update set total_paid = excluded.total_paid, updated_at = excluded.updated_at;

  for v_period in
    select fp.id, fp.amount_due
    from public.fund_periods fp
    where fp.fund_id = p_fund_id
    order by fp.starts_on, fp.id
  loop
    v_allocated := least(v_remaining, v_period.amount_due);
    v_remaining := greatest(v_remaining - v_allocated, 0);
    v_paid_at := case when v_allocated >= v_period.amount_due then now() else null end;
    insert into public.fund_payments (
      period_id, user_id, amount_due, amount_paid, is_paid, paid_at
    ) values (
      v_period.id, p_user_id, v_period.amount_due, v_allocated,
      v_allocated >= v_period.amount_due, v_paid_at
    )
    on conflict (period_id, user_id)
    do update set
      amount_due = excluded.amount_due,
      amount_paid = excluded.amount_paid,
      is_paid = excluded.is_paid,
      paid_at = case
        when excluded.is_paid then coalesce(public.fund_payments.paid_at, excluded.paid_at)
        else null
      end,
      updated_at = now();
  end loop;

  return round(p_total_paid, 2);
end;
$$;
revoke all on function public.set_fund_total_paid(bigint, uuid, numeric) from public;
grant execute on function public.set_fund_total_paid(bigint, uuid, numeric) to authenticated;

create or replace function public.allocate_new_fund_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contribution record;
begin
  for v_contribution in
    select c.user_id, c.total_paid
    from public.fund_contributions c
    where c.fund_id = new.fund_id
  loop
    perform public.set_fund_total_paid(new.fund_id, v_contribution.user_id, v_contribution.total_paid);
  end loop;
  return new;
end;
$$;
drop trigger if exists allocate_new_fund_period_trg on public.fund_periods;
create trigger allocate_new_fund_period_trg
after insert on public.fund_periods
for each row execute function public.allocate_new_fund_period();

create or replace function public.get_fund_export(p_fund_id bigint)
returns table (
  user_id uuid,
  student_number text,
  full_name text,
  period_label text,
  starts_on date,
  ends_on date,
  amount_due numeric,
  amount_paid numeric,
  is_paid boolean,
  total_paid numeric,
  total_due numeric,
  outstanding numeric,
  advance_credit numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if not exists (select 1 from public.funds where id = p_fund_id) then
    raise exception 'Fund not found';
  end if;
  return query
  with fund_weeks as (
    select fp.id, fp.fund_id, fp.label, fp.starts_on, fp.ends_on, fp.amount_due
    from public.fund_periods fp
    where fp.fund_id = p_fund_id
  ), totals as (
    select coalesce(sum(fw.amount_due), 0) as due_total
    from fund_weeks fw
  )
  select p.id,
  p.student_number,
  coalesce(nullif(p.full_name, ''), 'Student'),
         fw.label,
         fw.starts_on,
         fw.ends_on,
         fw.amount_due,
         coalesce(pay.amount_paid, 0::numeric),
         coalesce(pay.is_paid, false),
         coalesce(c.total_paid, 0::numeric),
         totals.due_total,
         greatest(totals.due_total - coalesce(c.total_paid, 0::numeric), 0),
         greatest(coalesce(c.total_paid, 0::numeric) - totals.due_total, 0)
  from public.profiles p
  cross join fund_weeks fw
  cross join totals
  left join public.fund_payments pay on pay.period_id = fw.id and pay.user_id = p.id
  left join public.fund_contributions c on c.fund_id = fw.fund_id and c.user_id = p.id
  order by p.student_number nulls last, fw.starts_on, fw.id;
end;
$$;
revoke all on function public.get_fund_export(bigint) from public;
grant execute on function public.get_fund_export(bigint) to authenticated;

create or replace function public.get_my_fund_balance(p_fund_id bigint)
returns table (
  total_due numeric,
  total_paid numeric,
  outstanding numeric,
  advance_credit numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user_id uuid := auth.uid();
  v_total_due numeric;
  v_total_paid numeric;
begin
  if v_user_id is null then raise exception 'Not logged in'; end if;
  if not exists (select 1 from public.funds where id = p_fund_id) then
    raise exception 'Fund not found';
  end if;

  select coalesce(sum(fp.amount_due), 0)
  into v_total_due
  from public.fund_periods fp
  where fp.fund_id = p_fund_id;

  select coalesce(c.total_paid, 0)
  into v_total_paid
  from public.fund_contributions c
  where c.fund_id = p_fund_id and c.user_id = v_user_id;

  v_total_paid := coalesce(v_total_paid, 0);
  return query select
    v_total_due,
    v_total_paid,
    greatest(v_total_due - v_total_paid, 0),
    greatest(v_total_paid - v_total_due, 0);
end;
$$;
revoke all on function public.get_my_fund_balance(bigint) from public;
grant execute on function public.get_my_fund_balance(bigint) to authenticated;
