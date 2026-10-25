-- Run after setup.sql and migration_features.sql.
-- Re-run this migration after setup.sql if setup is ever re-applied.

alter table public.profiles add column if not exists student_number text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists contacts text;
alter table public.profiles add column if not exists about text;
alter table public.profiles add column if not exists avatar_url text;

update public.profiles p
set student_number = u.raw_user_meta_data ->> 'student_number'
from auth.users u
where p.id = u.id
  and p.student_number is null
  and u.raw_user_meta_data ->> 'student_number' ~ '^[0-9]{2}-[0-9]{2}-[0-9]{3}$';

update public.profiles p
set full_name = nullif(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
where p.id = u.id
  and (p.full_name is null or p.full_name = '')
  and nullif(u.raw_user_meta_data ->> 'full_name', '') is not null;

update public.profiles p
set birth_date = (u.raw_user_meta_data ->> 'birth_date')::date
from auth.users u
where p.id = u.id
  and p.birth_date is null
  and u.raw_user_meta_data ->> 'birth_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and p.email is null
  and u.email is not null
  and u.email not ilike '%@login.portalis.invalid';

create unique index if not exists profiles_student_number_unique
  on public.profiles (student_number)
  where student_number is not null;
alter table public.profiles drop constraint if exists profiles_student_number_format;
alter table public.profiles add constraint profiles_student_number_format
  check (student_number is null or student_number ~ '^[0-9]{2}-[0-9]{2}-[0-9]{3}$');

create or replace function public.author_of(uid uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select nullif(full_name, '') from public.profiles where id = uid),
    (select student_number from public.profiles where id = uid),
    'user'
  );
$$;

update public.notes set author_name = public.author_of(user_id);
update public.comments set author_name = public.author_of(user_id);

create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.id := old.id;
    new.role := old.role;
    new.student_number := old.student_number;
    new.birth_date := old.birth_date;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before update on public.profiles
for each row execute function public.profiles_guard();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_number text := new.raw_user_meta_data ->> 'student_number';
  v_full_name text := nullif(new.raw_user_meta_data ->> 'full_name', '');
  v_birth_date date;
begin
  if new.raw_user_meta_data ->> 'birth_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_birth_date := (new.raw_user_meta_data ->> 'birth_date')::date;
  end if;

  insert into public.profiles (id, email, student_number, full_name, birth_date)
  values (new.id, new.email, v_student_number, v_full_name, v_birth_date)
  on conflict (id) do update set
    email = excluded.email,
    student_number = coalesce(public.profiles.student_number, excluded.student_number),
    full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
    birth_date = coalesce(public.profiles.birth_date, excluded.birth_date);
  return new;
end;
$$;

create or replace function public.sync_auth_email_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    perform set_config('portalis.sync_auth_email', 'on', true);
    update public.profiles set email = new.email where id = new.id;
    perform set_config('portalis.sync_auth_email', 'off', true);
  end if;
  return new;
end;
$$;
drop function if exists public.identifier_is_taken(text);
drop function if exists public.username_is_taken(text);
create or replace function public.student_number_is_taken(p_student_number text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where student_number = trim(p_student_number)
  );
$$;
revoke all on function public.student_number_is_taken(text) from public;
grant execute on function public.student_number_is_taken(text) to anon, authenticated;

create or replace function public.birthdays_today()
returns table (full_name text)
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(nullif(p.full_name, ''), 'Classmate')
  from public.profiles p
  where auth.uid() is not null
    and p.birth_date is not null
    and to_char(p.birth_date, 'MM-DD') =
        to_char((now() at time zone 'Asia/Manila')::date, 'MM-DD')
  order by p.full_name;
$$;
revoke all on function public.birthdays_today() from public;
grant execute on function public.birthdays_today() to authenticated;

drop function if exists public.get_fund_roster(bigint);
create function public.get_fund_roster(p_period_id bigint)
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
  if auth.uid() is null then raise exception 'Not logged in'; end if;
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

drop function if exists public.get_fund_debt_summary(bigint);
create function public.get_fund_debt_summary(p_fund_id bigint)
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
  if auth.uid() is null then raise exception 'Not logged in'; end if;
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
       f.amount_per_period
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

drop index if exists public.profiles_username_lower_unique;
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles drop column if exists username;
alter table public.profiles drop column if exists contact_email;
