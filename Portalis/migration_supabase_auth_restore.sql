-- Run after migration_optional_email.sql when Supabase Auth signup needs to
-- create profiles. This also supports the portalis_auth_users table left by
-- migration_custom_auth.sql. It does not reverse that migration or recover
-- Auth users that were deleted.

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
    v_birth_date := (new.raw_user_meta_data ->> 'birth_date')::date;
  end if;

  if to_regclass('public.portalis_auth_users') is not null then
    execute
      'insert into public.portalis_auth_users (id, student_number) values ($1, $2) ' ||
      'on conflict (id) do update set student_number = coalesce(public.portalis_auth_users.student_number, excluded.student_number)'
    using new.id, v_student_number;
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
    update public.profiles
    set email = case
      when lower(coalesce(new.email, '')) like '%@login.portalis.invalid' then null
      else new.email
    end
    where id = new.id;
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

-- Repair Auth accounts created while the profile trigger was missing. Only
-- accounts with a valid student number and no profile are considered.
do $$
declare
  auth_user record;
  v_student_number text;
  v_existing_student_number text;
  v_full_name text;
  v_birth_date date;
  v_email text;
  v_conflict boolean;
begin
  for auth_user in
    select u.id, u.email, u.raw_user_meta_data, u.created_at
    from auth.users u
    where u.raw_user_meta_data ->> 'student_number' ~ '^[0-9]{2}-[0-9]{2}-[0-9]{3}$'
      and not exists (select 1 from public.profiles p where p.id = u.id)
    order by u.created_at, u.id
  loop
    v_student_number := auth_user.raw_user_meta_data ->> 'student_number';
    if to_regclass('public.portalis_auth_users') is not null then
      execute
        'select student_number from public.portalis_auth_users where id = $1'
        into v_existing_student_number
        using auth_user.id;
      v_student_number := coalesce(v_existing_student_number, v_student_number);
    end if;
    v_full_name := nullif(auth_user.raw_user_meta_data ->> 'full_name', '');
    v_email := case
      when lower(coalesce(auth_user.email, '')) like '%@login.portalis.invalid' then null
      else auth_user.email
    end;
    v_birth_date := null;

    if auth_user.raw_user_meta_data ->> 'birth_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      begin
        v_birth_date := (auth_user.raw_user_meta_data ->> 'birth_date')::date;
      exception
        when invalid_datetime_format or datetime_field_overflow then
          v_birth_date := null;
      end;
    end if;

    if exists (
      select 1 from public.profiles p where p.student_number = v_student_number
    ) then
      raise notice 'Skipping Auth user %: student number % is already assigned to another profile',
        auth_user.id, v_student_number;
      continue;
    end if;

    if to_regclass('public.portalis_auth_users') is not null then
      execute
        'select exists (select 1 from public.portalis_auth_users where student_number = $1 and id <> $2)'
        into v_conflict
        using v_student_number, auth_user.id;
      if v_conflict then
        raise notice 'Skipping Auth user %: student number % is assigned to another Portalis auth user',
          auth_user.id, v_student_number;
        continue;
      end if;

      execute
        'insert into public.portalis_auth_users (id, student_number) values ($1, $2) ' ||
        'on conflict (id) do update set student_number = coalesce(public.portalis_auth_users.student_number, excluded.student_number)'
        using auth_user.id, v_student_number;
    end if;

    insert into public.profiles (id, email, student_number, full_name, birth_date)
    values (auth_user.id, v_email, v_student_number, v_full_name, v_birth_date);
  end loop;
end;
$$;
