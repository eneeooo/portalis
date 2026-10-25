-- FOR EXISTING PROJECTS (you already ran the old setup.sql).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

alter table public.notes add column if not exists title    text  not null default '';
alter table public.notes add column if not exists priority text  not null default 'medium';
alter table public.notes add column if not exists subnotes jsonb not null default '[]'::jsonb;
alter table public.notes alter column content set default '';

alter table public.notes drop constraint if exists notes_priority_check;
alter table public.notes add constraint notes_priority_check
  check (priority in ('low','medium','high','urgent'));

-- users may edit their own notes (tick subnotes, change importance)
drop policy if exists "update own" on public.notes;
create policy "update own" on public.notes for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
