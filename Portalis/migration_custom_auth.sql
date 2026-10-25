-- Run after setup.sql, migration_features.sql, and
-- migration_student_number_birthdays.sql and migration_optional_email.sql.
-- This replaces Supabase email/password Auth with student-number credentials.

create table if not exists public.portalis_auth_users (
  id uuid primary key default gen_random_uuid(),
  student_number text unique,
  password_salt text,
  password_hash text,
  created_at timestamptz not null default now(),
  constraint portalis_auth_student_number_format
    check (student_number is null or student_number ~ '^[0-9]{2}-[0-9]{2}-[0-9]{3}$')
);

create table if not exists public.portalis_auth_sessions (
  id uuid primary key,
  user_id uuid not null references public.portalis_auth_users(id) on delete cascade,
  refresh_token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists portalis_auth_sessions_user_idx
  on public.portalis_auth_sessions (user_id);
create index if not exists portalis_auth_sessions_expiry_idx
  on public.portalis_auth_sessions (expires_at);
create table if not exists public.portalis_auth_failures (
  student_number text primary key,
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz
);
alter table public.portalis_auth_users enable row level security;
alter table public.portalis_auth_sessions enable row level security;
alter table public.portalis_auth_failures enable row level security;
revoke all on public.portalis_auth_users from anon, authenticated;
revoke all on public.portalis_auth_sessions from anon, authenticated;
revoke all on public.portalis_auth_failures from anon, authenticated;

create or replace function public.record_portalis_auth_failure(p_student_number text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.portalis_auth_failures as failures (student_number, attempt_count, window_started_at, locked_until)
  values (p_student_number, 1, now(), null)
  on conflict (student_number) do update set
    attempt_count = case
      when failures.window_started_at < now() - interval '15 minutes' then 1
      else failures.attempt_count + 1
    end,
    window_started_at = case
      when failures.window_started_at < now() - interval '15 minutes' then now()
      else failures.window_started_at
    end,
    locked_until = case
      when failures.window_started_at < now() - interval '15 minutes' then null
      when failures.attempt_count + 1 >= 10 then now() + interval '15 minutes'
      else failures.locked_until
    end;
$$;
revoke all on function public.record_portalis_auth_failure(text) from public, anon, authenticated;
grant execute on function public.record_portalis_auth_failure(text) to service_role;

insert into public.portalis_auth_users (id, student_number)
select p.id, p.student_number
from public.profiles p
on conflict (id) do update set
  student_number = coalesce(public.portalis_auth_users.student_number, excluded.student_number);

create or replace function public.sync_portalis_auth_student_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.portalis_auth_users
  set student_number = new.student_number
  where id = new.id
    and student_number is distinct from new.student_number;
  return new;
end;
$$;
drop trigger if exists sync_portalis_auth_student_number_trg on public.profiles;
create trigger sync_portalis_auth_student_number_trg
after insert or update of student_number on public.profiles
for each row execute function public.sync_portalis_auth_student_number();

-- Preserve existing real contact addresses, but remove generated Auth emails.
-- contact_email is dropped by migration_student_number_birthdays.sql, so only
-- copy from it when the column still exists (otherwise this script fails).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'contact_email'
  ) then
    execute $q$
      update public.profiles
      set email = contact_email
      where contact_email is not null
        and contact_email not ilike '%@login.portalis.invalid'
        and (email is null or email ilike '%@login.portalis.invalid')
    $q$;
  end if;
end;
$$;
update public.profiles
set email = null
where email ilike '%@login.portalis.invalid';

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists sync_auth_email_to_profile_trg on auth.users;

-- Existing students can keep using their current password once. The custom
-- login endpoint verifies it against the old Supabase Auth account, then
-- stores a PBKDF2 hash so subsequent logins no longer depend on Auth email.
do $$
declare
  fk record;
  column_name text;
begin
  for fk in
    select conrelid::regclass as table_name, conname, conkey
    from pg_constraint
    where contype = 'f'
      and confrelid = 'auth.users'::regclass
      and connamespace = 'public'::regnamespace
  loop
    if array_length(fk.conkey, 1) <> 1 then
      raise exception 'Cannot migrate composite auth.users foreign key % on %', fk.conname, fk.table_name;
    end if;
    select attname into column_name
    from pg_attribute
    where attrelid = fk.table_name::regclass and attnum = fk.conkey[1];
    execute format('alter table %s drop constraint %I', fk.table_name, fk.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references public.portalis_auth_users(id) on delete cascade',
      fk.table_name, fk.conname, column_name
    );
  end loop;
end;
$$;

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

drop function if exists public.sync_auth_email_to_profile();
drop function if exists public.handle_new_user();
