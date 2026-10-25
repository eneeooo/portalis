-- ============================================================
-- OPTIONAL EMAIL
-- profiles.email stays EMPTY until a student adds an email in Profile.
-- Signup no longer fills it.
--
-- Run after setup.sql, migration_features.sql, and
-- migration_student_number_birthdays.sql. Run migration_supabase_auth_restore.sql
-- afterward to restore the Auth signup and email-sync triggers.
-- ============================================================

-- 1) Safety net: the hidden login address can never be stored in profiles,
--    even if setup.sql or an older migration is run again.
create or replace function public.profiles_clean_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.email is not null
     and (lower(btrim(new.email)) like '%@login.portalis.invalid' or btrim(new.email) = '') then
    new.email := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_clean_email_trg on public.profiles;
create trigger profiles_clean_email_trg
before insert or update on public.profiles
for each row execute function public.profiles_clean_email();

-- 2) Clear the hidden addresses already copied into profiles
update public.profiles set email = null where lower(email) like '%@login.portalis.invalid';

-- 3) Signup: do not copy the hidden login address into the profile
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
  v_email text := case when lower(coalesce(new.email, '')) like '%@login.portalis.invalid'
                       then null else new.email end;
begin
  if new.raw_user_meta_data ->> 'birth_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_birth_date := (new.raw_user_meta_data ->> 'birth_date')::date;
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

-- 4) Profile -> Email: when the account email changes to a real address the
--    profile gets it. Changing back to the hidden address clears it.
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

drop trigger if exists sync_auth_email_to_profile_trg on auth.users;
create trigger sync_auth_email_to_profile_trg
after update of email on auth.users
for each row execute function public.sync_auth_email_to_profile();
