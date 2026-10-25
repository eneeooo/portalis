-- ============================================================
-- PORTALIS - FIX: profile cannot be saved + remove legacy nickname
-- Safe to run more than once. Supabase -> SQL Editor -> paste all -> Run.
-- ============================================================

-- 1) Columns the Profile page reads and writes
alter table public.profiles add column if not exists full_name  text;
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists contacts   text;
alter table public.profiles add column if not exists about      text;
alter table public.profiles add column if not exists avatar_url text;

-- 2) Remove legacy columns nothing uses anymore.
--    (nickname was never dropped by the later migrations; nothing reads it.)
alter table public.profiles drop column if exists nickname;
alter table public.profiles drop column if exists username;
alter table public.profiles drop column if exists contact_email;

-- 3) Guard trigger written for the CURRENT columns. An older copy that still
--    mentions username/nickname makes EVERY profile update fail with
--    'record "new" has no field ...'.
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

-- 4) Row-level security: everyone can read/update their own row
alter table public.profiles enable row level security;

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select
  using (auth.uid() = id);

grant select, update on public.profiles to authenticated;
