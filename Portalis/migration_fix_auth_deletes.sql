-- ============================================================
-- PORTALIS - FIX: deleted Auth users blocking re-signup / login
--
-- Safe to run more than once. Run it in Supabase -> SQL Editor.
--
-- What was wrong
--   migration_custom_auth.sql re-pointed every foreign key from auth.users
--   to public.portalis_auth_users. Deleting a user in Supabase Auth then no
--   longer cascaded, so the old profile (with its unique student number) and
--   the portalis_auth_users row stayed behind. Signup saw "already
--   registered" and login saw a profile without an Auth account.
--
-- What this script does
--   1. Deletes leftover profiles / rows whose Auth user no longer exists
--      (these accounts cannot log in anyway; their notes etc. cascade).
--   2. Points all foreign keys back to auth.users ON DELETE CASCADE.
--   3. Drops the unused custom-auth tables and triggers.
--   4. Re-creates the signup + email-sync triggers (no custom-auth branch).
--   5. Adds a safety trigger so deleting an Auth user ALWAYS removes the
--      profile, and signup clears any stale profile holding the same
--      student number.
-- ============================================================

-- ---------- 1) clean up orphans ----------
do $$
declare
  n bigint;
begin
  delete from public.profiles p
  where not exists (select 1 from auth.users u where u.id = p.id);
  get diagnostics n = row_count;
  raise notice 'Removed % orphan profile(s) whose Auth user was deleted', n;
end;
$$;

-- Other tables that point straight at portalis_auth_users (not via profiles)
do $$
declare
  fk record;
  col text;
begin
  if to_regclass('public.portalis_auth_users') is null then return; end if;
  for fk in
    select c.conrelid::regclass as tbl, c.conname, c.conkey
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.portalis_auth_users'::regclass
      and c.conrelid::regclass::text not like 'public.portalis\_auth\_%'
      and c.conrelid::regclass::text not like 'portalis\_auth\_%'
  loop
    select attname into col from pg_attribute
    where attrelid = fk.tbl and attnum = fk.conkey[1];
    execute format(
      'delete from %s t where not exists (select 1 from auth.users u where u.id = t.%I)',
      fk.tbl, col);
  end loop;
end;
$$;

-- ---------- 2) foreign keys back to auth.users ----------
do $$
declare
  fk record;
  col text;
begin
  if to_regclass('public.portalis_auth_users') is not null then
    for fk in
      select c.conrelid::regclass as tbl, c.conname, c.conkey
      from pg_constraint c
      where c.contype = 'f'
        and c.confrelid = 'public.portalis_auth_users'::regclass
        and c.conrelid::regclass::text not like '%portalis\_auth\_%'
    loop
      if array_length(fk.conkey, 1) <> 1 then
        raise exception 'Composite foreign key % on % needs manual review', fk.conname, fk.tbl;
      end if;
      select attname into col from pg_attribute
      where attrelid = fk.tbl and attnum = fk.conkey[1];
      execute format('alter table %s drop constraint %I', fk.tbl, fk.conname);
      execute format(
        'alter table %s add constraint %I foreign key (%I) references auth.users(id) on delete cascade',
        fk.tbl, fk.conname, col);
    end loop;
  end if;
end;
$$;

-- profiles.id must reference auth.users even if it was dropped some other way
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

-- ---------- 3) drop the unused custom-auth objects ----------
drop trigger if exists sync_portalis_auth_student_number_trg on public.profiles;
drop function if exists public.sync_portalis_auth_student_number();
drop function if exists public.record_portalis_auth_failure(text);
drop table if exists public.portalis_auth_sessions cascade;
drop table if exists public.portalis_auth_failures cascade;
drop table if exists public.portalis_auth_users cascade;

-- ---------- 4) signup + email-sync triggers ----------
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
  v_email text := case
    when lower(coalesce(new.email, '')) like '%@login.portalis.invalid' then null
    else new.email
  end;
begin
  if new.raw_user_meta_data ->> 'birth_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      v_birth_date := (new.raw_user_meta_data ->> 'birth_date')::date;
    exception when others then
      v_birth_date := null;
    end;
  end if;

  -- A stale profile (its Auth user is gone) must never block a student number.
  if v_student_number is not null then
    delete from public.profiles p
    where p.student_number = v_student_number
      and p.id <> new.id
      and not exists (select 1 from auth.users u where u.id = p.id);
  end if;

  insert into public.profiles (id, email, student_number, full_name, birth_date)
  values (new.id, v_email, v_student_number, v_full_name, v_birth_date)
  on conflict (id) do update set
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
    update public.profiles
       set email = case when lower(coalesce(new.email, '')) like '%@login.portalis.invalid'
                        then null else new.email end
     where id = new.id;
    perform set_config('portalis.sync_auth_email', 'off', true);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists sync_auth_email_to_profile_trg on auth.users;
create trigger sync_auth_email_to_profile_trg
after update of email on auth.users
for each row execute function public.sync_auth_email_to_profile();

-- ---------- 5) deleting an Auth user always frees the student number ----------
create or replace function public.cleanup_deleted_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.profiles where id = old.id;
  return old;
end;
$$;

drop trigger if exists cleanup_deleted_auth_user_trg on auth.users;
create trigger cleanup_deleted_auth_user_trg
after delete on auth.users
for each row execute function public.cleanup_deleted_auth_user();

-- ---------- 6) backfill profiles for Auth users that lack one ----------
insert into public.profiles (id, email, student_number, full_name)
select u.id,
       case when lower(coalesce(u.email, '')) like '%@login.portalis.invalid' then null else u.email end,
       case when u.raw_user_meta_data ->> 'student_number' ~ '^[0-9]{2}-[0-9]{2}-[0-9]{3}$'
            then u.raw_user_meta_data ->> 'student_number' end,
       nullif(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
  and not exists (
    select 1 from public.profiles p2
    where p2.student_number = u.raw_user_meta_data ->> 'student_number'
  )
on conflict (id) do nothing;
