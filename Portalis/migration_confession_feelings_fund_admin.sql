-- Run after migration_student_number_birthdays.sql.

-- ---------- confession feelings ----------
alter table public.confessions
  add column if not exists feeling text not null default 'other';
alter table public.confessions drop constraint if exists confessions_feeling_check;
alter table public.confessions add constraint confessions_feeling_check
  check (feeling in ('in-love', 'happy', 'sad', 'anxious', 'grateful', 'hopeful', 'other'));

revoke all on public.confessions from anon, authenticated;
grant select (id, content, feeling, created_at), insert (content, feeling), delete
  on public.confessions to authenticated;

-- ---------- weekly class fund ----------
insert into public.funds (title, amount_per_period)
select 'Class Fund', 10
where not exists (
  select 1 from public.funds where lower(title) = lower('Class Fund')
);

update public.funds
set amount_per_period = 10
where lower(title) = lower('Class Fund');

insert into public.fund_periods (fund_id, label, starts_on, ends_on, amount_due)
select f.id,
       'Week ' || (((weeks.starts_on - date '2026-08-31') / 7) + 1)::text ||
         ' (' ||
         replace(to_char(weeks.starts_on, 'FMMon DD'), 'Sep ', 'Sept ') ||
         '–' ||
         replace(to_char(weeks.starts_on + 6, 'FMMon DD'), 'Sep ', 'Sept ') ||
         ')',
       weeks.starts_on,
       weeks.starts_on + 6,
       10
from public.funds f
cross join lateral (
  select generated.starts_on::date as starts_on
  from generate_series(
    date '2026-08-31'::timestamp,
    greatest(date '2026-08-31', date_trunc('week', current_date)::date)::timestamp,
    interval '7 days'
  ) as generated(starts_on)
) as weeks
where lower(f.title) = lower('Class Fund')
on conflict (fund_id, label) do nothing;

update public.fund_periods fp
set amount_due = 10
from public.funds f
where fp.fund_id = f.id
  and lower(f.title) = lower('Class Fund')
  and fp.starts_on >= date '2026-08-31';

-- Payment status and student rosters are only available to admins.
create or replace function public.get_fund_roster(p_period_id bigint)
returns table (
  user_id uuid,
  student_number text,
  full_name text,
  amount_due numeric,
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
         coalesce(pay.is_paid, false)
  from public.profiles p
  join public.fund_periods fp on fp.id = p_period_id
  left join public.fund_payments pay on pay.period_id = fp.id and pay.user_id = p.id
  order by p.student_number;
end;
$$;
revoke all on function public.get_fund_roster(bigint) from public;
grant execute on function public.get_fund_roster(bigint) to authenticated;

create or replace function public.get_fund_debt_summary(p_fund_id bigint)
returns table (
  user_id uuid,
  student_number text,
  full_name text,
  total_debt numeric,
  unpaid_periods integer
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
         coalesce(sum(coalesce(pay.amount_due, fp.amount_due)) filter (where not coalesce(pay.is_paid, false)), 0),
         count(*) filter (where not coalesce(pay.is_paid, false))::integer
  from public.profiles p
  cross join public.fund_periods fp
  left join public.fund_payments pay on pay.period_id = fp.id and pay.user_id = p.id
  where fp.fund_id = p_fund_id
  group by p.id, p.student_number, p.full_name
  order by p.student_number nulls last;
end;
$$;
revoke all on function public.get_fund_debt_summary(bigint) from public;
grant execute on function public.get_fund_debt_summary(bigint) to authenticated;
