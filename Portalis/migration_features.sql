-- Run this after setup.sql in Supabase SQL Editor.
-- This is a legacy migration. The final custom-auth migration replaces
-- Supabase email/password Auth with student-number credentials.

-- ---------- profiles and username/student-number authentication ----------
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists student_number text;
alter table public.profiles add column if not exists nickname text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists contact_email text;
alter table public.profiles add column if not exists contacts text;
alter table public.profiles add column if not exists about text;
alter table public.profiles add column if not exists avatar_url text;

update public.profiles p
set student_number = coalesce(p.student_number, u.raw_user_meta_data ->> 'student_number'),
    nickname = coalesce(nullif(p.nickname, ''), nullif(u.raw_user_meta_data ->> 'nickname', ''))
from auth.users u
where u.id = p.id
  and (p.username is null or p.student_number is null or p.nickname is null or p.nickname = '')
  and u.raw_user_meta_data ->> 'username' is not null;
update public.profiles p
set full_name = u.raw_user_meta_data ->> 'full_name'
from auth.users u
where u.id = p.id
  and (p.full_name is null or p.full_name = '')
  and nullif(u.raw_user_meta_data ->> 'full_name', '') is not null;
update public.profiles
set username = lower(left(regexp_replace(split_part(coalesce(email, ''), '@', 1), '[^a-z0-9_.-]', '', 'g'), 30))
where username is null;
update public.profiles
set username = 'student-' || left(replace(id::text, '-', ''), 12)
where username is null or username = '' or char_length(username) < 3;
update public.profiles
set nickname = split_part(coalesce(email, 'Student'), '@', 1)
where nickname is null or nickname = '';
with ranked as (
  select id, username,
         row_number() over (partition by lower(username) order by created_at, id) as duplicate_no
  from public.profiles
)
update public.profiles p
set username = left(r.username, 17) || '-' || left(replace(r.id::text, '-', ''), 12)
from ranked r
where p.id = r.id and r.duplicate_no > 1;
update public.profiles
set full_name = coalesce(nullif(full_name, ''), nullif(nickname, ''), username)
where full_name is null or full_name = '';

create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username));
create unique index if not exists profiles_student_number_unique on public.profiles (student_number) where student_number is not null;
alter table public.profiles drop constraint if exists profiles_student_number_format;
alter table public.profiles add constraint profiles_student_number_format
  check (student_number is null or student_number ~ '^[0-9]{2}-[0-9]{2}-[0-9]{3}$');
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username ~ '^[a-z0-9_.-]{3,30}$');

-- Preserve real existing addresses as optional profile information. Do not
-- rewrite Auth emails; the custom-auth migration removes Auth from login.
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and p.email is null
  and u.email is not null
  and u.email not like '%@login.portalis.invalid';

create or replace function public.author_of(uid uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select nullif(full_name, '') from public.profiles where id = uid),
    (select username from public.profiles where id = uid),
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
    new.username := old.username;
    new.student_number := old.student_number;
    if current_setting('portalis.sync_auth_email', true) is distinct from 'on' then
      new.email := old.email;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before update on public.profiles
for each row execute function public.profiles_guard();

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
begin
  insert into public.profiles (id, email, username, student_number, nickname, full_name)
  values (
    new.id,
    new.email,
    v_username,
    new.raw_user_meta_data ->> 'student_number',
    coalesce(nullif(new.raw_user_meta_data ->> 'nickname', ''), v_username),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), v_username)
  )
  on conflict (id) do update set
    username = excluded.username,
    student_number = excluded.student_number,
    nickname = excluded.nickname,
    full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name);
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
drop trigger if exists sync_auth_email_to_profile_trg on auth.users;
create trigger sync_auth_email_to_profile_trg
after update of email on auth.users
for each row execute function public.sync_auth_email_to_profile();

create or replace function public.identifier_is_taken(p_identifier text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where lower(p.username) = lower(trim(p_identifier))
       or p.student_number = trim(p_identifier)
  );
$$;
revoke all on function public.identifier_is_taken(text) from public;
grant execute on function public.identifier_is_taken(text) to anon, authenticated;

-- Non-admin users may update their own note content, never its importance.
create or replace function public.notes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_admin boolean := public.is_admin();
begin
  if tg_op = 'INSERT' then
    new.status := case when v_admin then 'approved' else 'pending' end;
    if not v_admin then new.priority := 'medium'; end if;
    new.reject_reason := null;
    new.author_name := public.author_of(new.user_id);
  else
    new.user_id := old.user_id;
    new.author_name := old.author_name;
    if not v_admin then
      new.priority := old.priority;
      new.status := old.status;
      new.reject_reason := old.reject_reason;
      if new.title is distinct from old.title
         or new.content is distinct from old.content
         or new.format is distinct from old.format then
        new.status := 'pending';
        new.reject_reason := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;
alter table public.notes drop constraint if exists notes_priority_check;
alter table public.notes add constraint notes_priority_check
  check (priority in ('low','neutral','medium','high','urgent'));

-- ---------- profile avatars ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 3145728, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = true,
  file_size_limit = 3145728,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "public avatar reads" on storage.objects;
drop policy if exists "users upload own avatar" on storage.objects;
drop policy if exists "users update own avatar" on storage.objects;
drop policy if exists "users delete own avatar" on storage.objects;
create policy "public avatar reads" on storage.objects for select
  using (bucket_id = 'avatars');
create policy "users upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- funds ----------
create table if not exists public.funds (
  id bigint generated always as identity primary key,
  title text not null check (char_length(trim(title)) between 1 and 100),
  amount_per_period numeric(10,2) not null default 10 check (amount_per_period >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.fund_periods (
  id bigint generated always as identity primary key,
  fund_id bigint not null references public.funds(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 100),
  starts_on date not null,
  ends_on date not null,
  amount_due numeric(10,2) not null check (amount_due >= 0),
  created_at timestamptz not null default now(),
  unique (fund_id, label),
  check (ends_on >= starts_on)
);
create table if not exists public.fund_payments (
  period_id bigint not null references public.fund_periods(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_due numeric(10,2) not null check (amount_due >= 0),
  is_paid boolean not null default false,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (period_id, user_id)
);
alter table public.funds enable row level security;
alter table public.fund_periods enable row level security;
alter table public.fund_payments enable row level security;
drop policy if exists "read funds" on public.funds;
drop policy if exists "admin manage funds" on public.funds;
drop policy if exists "read fund periods" on public.fund_periods;
drop policy if exists "admin manage fund periods" on public.fund_periods;
drop policy if exists "admin manage fund payments" on public.fund_payments;
create policy "read funds" on public.funds for select to authenticated using (true);
create policy "admin manage funds" on public.funds for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read fund periods" on public.fund_periods for select to authenticated using (true);
create policy "admin manage fund periods" on public.fund_periods for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin manage fund payments" on public.fund_payments for all to authenticated using (public.is_admin()) with check (public.is_admin());

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
  select p.id, p.student_number, coalesce(nullif(p.full_name, ''), p.username),
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
         coalesce(nullif(p.full_name, ''), p.username),
         coalesce(sum(coalesce(pay.amount_due, fp.amount_due)) filter (where not coalesce(pay.is_paid, false)), 0),
         count(*) filter (where not coalesce(pay.is_paid, false))::integer
  from public.profiles p
  cross join public.fund_periods fp
  left join public.fund_payments pay on pay.period_id = fp.id and pay.user_id = p.id
  where fp.fund_id = p_fund_id
  group by p.id, p.student_number, p.full_name, p.username
  order by p.student_number nulls last;
end;
$$;
revoke all on function public.get_fund_debt_summary(bigint) from public;
grant execute on function public.get_fund_debt_summary(bigint) to authenticated;

insert into public.funds (title, amount_per_period)
select 'Class Fund', 10
where not exists (select 1 from public.funds where lower(title) = lower('Class Fund'));
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

-- ---------- anonymous confessions ----------
create table if not exists public.confessions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 1500),
  created_at timestamptz not null default now()
);
alter table public.confessions enable row level security;
drop policy if exists "read confessions" on public.confessions;
drop policy if exists "post confession" on public.confessions;
drop policy if exists "admin delete confessions" on public.confessions;
create policy "read confessions" on public.confessions for select to authenticated using (true);
create policy "post confession" on public.confessions for insert to authenticated with check (auth.uid() = user_id);
create policy "admin delete confessions" on public.confessions for delete to authenticated using (public.is_admin());
revoke all on public.confessions from anon, authenticated;
grant select (id, content, created_at), insert (content), delete on public.confessions to authenticated;

-- ---------- suggestions ----------
create table if not exists public.suggestions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 1000),
  created_at timestamptz not null default now()
);
alter table public.suggestions enable row level security;
drop policy if exists "admin read suggestions" on public.suggestions;
drop policy if exists "submit own suggestion" on public.suggestions;
drop policy if exists "admin delete suggestions" on public.suggestions;
create policy "admin read suggestions" on public.suggestions for select to authenticated using (public.is_admin());
create policy "submit own suggestion" on public.suggestions for insert to authenticated with check (auth.uid() = user_id);
create policy "admin delete suggestions" on public.suggestions for delete to authenticated using (public.is_admin());
