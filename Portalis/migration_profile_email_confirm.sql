-- ============================================================
-- PORTALIS - confirmed email change (replaces migration_profile_email.sql)
-- Safe to run more than once. Supabase -> SQL Editor -> paste all -> Run.
--
-- Flow: student enters an email on Profile -> Supabase emails a confirmation
-- link to the NEW address -> after it is clicked, Supabase Auth changes the
-- account email and the trigger below copies it into profiles.email.
-- Students can NOT write profiles.email themselves, so only confirmed
-- addresses ever appear there.
-- ============================================================

-- 1) Guard: protect id/role/student number/birthdate AND email (email only
--    changes through the confirmed Auth change, via the sync trigger flag).
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

-- 2) Auth email -> profile email (fires when the email change is CONFIRMED)
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

-- 3) Own-row permissions for the Profile page
alter table public.profiles enable row level security;
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);
grant select, update on public.profiles to authenticated;

-- 4) Undo the earlier unconfirmed email writes:
--    a) accounts whose login email was overwritten by the old function with an
--       UNCONFIRMED real address get their student-number login address back
update auth.users u
set email = p.student_number || '@login.portalis.invalid',
    email_confirmed_at = now()
from public.profiles p
where p.id = u.id
  and p.student_number is not null
  and lower(coalesce(u.email, '')) not like '%@login.portalis.invalid'
  and u.email_confirmed_at is null;

--    b) no unconfirmed contact emails: profiles.email must be empty unless the
--       Auth email itself is a real, confirmed address
update public.profiles p
set email = null
from auth.users u
where u.id = p.id
  and lower(coalesce(u.email, '')) like '%@login.portalis.invalid'
  and p.email is not null;
