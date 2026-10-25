-- ============================================================
-- PORTALIS - full database setup
-- Works on a NEW project or an EXISTING one, and is safe to re-run.
-- Supabase -> SQL Editor -> New query -> paste ALL -> Run
-- ============================================================

-- ---------- 1) PROFILES + ROLES ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz default now()
);
alter table public.profiles add column if not exists full_name text;
alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Full name shown as the author of notes and comments.
create or replace function public.author_of(uid uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select nullif(full_name, '') from public.profiles where id = uid),
    (select nullif(split_part(email, '@', 1), '') from public.profiles where id = uid),
    'user'
  );
$$;

drop policy if exists "read own profile" on public.profiles;
drop policy if exists "admin read all profiles" on public.profiles;
drop policy if exists "admin update roles" on public.profiles;
create policy "read own profile"        on public.profiles for select using (auth.uid() = id);
create policy "admin read all profiles" on public.profiles for select using (public.is_admin());
create policy "admin update roles"      on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- ---------- 2) NOTES ----------
create table if not exists public.notes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content text not null default '',
  created_at timestamptz default now()
);
alter table public.notes enable row level security;

alter table public.notes add column if not exists title         text  not null default '';
alter table public.notes add column if not exists priority      text  not null default 'medium';
alter table public.notes add column if not exists subnotes      jsonb not null default '[]'::jsonb;
alter table public.notes add column if not exists format        text  not null default 'text';
alter table public.notes add column if not exists status        text  not null default 'pending';
alter table public.notes add column if not exists reject_reason text;
alter table public.notes add column if not exists author_name   text;
alter table public.notes alter column content set default '';

alter table public.notes drop constraint if exists notes_priority_check;
alter table public.notes add constraint notes_priority_check check (priority in ('low','neutral','medium','high','urgent'));
alter table public.notes drop constraint if exists notes_format_check;
alter table public.notes add constraint notes_format_check check (format in ('text','bullets','numbered'));
alter table public.notes drop constraint if exists notes_status_check;
alter table public.notes add constraint notes_status_check check (status in ('pending','approved','rejected'));

-- backfill for notes made before this version
update public.notes n set author_name = public.author_of(n.user_id) where n.author_name is null;
update public.notes n set status = 'approved'
  from public.profiles p
  where p.id = n.user_id and p.role = 'admin' and n.status = 'pending';

-- guard: users cannot approve their own notes; admin notes post right away
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
      -- editing the text of a note sends it back for review
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

drop trigger if exists notes_guard_trg on public.notes;
create trigger notes_guard_trg
before insert or update on public.notes
for each row execute function public.notes_guard();

drop policy if exists "read own" on public.notes;
drop policy if exists "insert own" on public.notes;
drop policy if exists "delete own" on public.notes;
drop policy if exists "update own" on public.notes;
drop policy if exists "admin read all notes" on public.notes;
drop policy if exists "admin delete all notes" on public.notes;
drop policy if exists "read notes" on public.notes;
drop policy if exists "admin update notes" on public.notes;
drop policy if exists "admin delete notes" on public.notes;

create policy "read notes"         on public.notes for select
  using (status = 'approved' or auth.uid() = user_id or public.is_admin());
create policy "insert own"         on public.notes for insert with check (auth.uid() = user_id);
create policy "update own"         on public.notes for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "admin update notes" on public.notes for update
  using (public.is_admin()) with check (public.is_admin());
create policy "admin delete notes" on public.notes for delete using (public.is_admin());

-- ---------- 3) PUBLIC COMMENTS ----------
create table if not exists public.comments (
  id bigint generated always as identity primary key,
  note_id bigint not null references public.notes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text,
  content text not null check (char_length(trim(content)) > 0 and char_length(content) <= 500),
  created_at timestamptz default now()
);
alter table public.comments enable row level security;

create or replace function public.comments_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_name := public.author_of(new.user_id);
  return new;
end;
$$;

drop trigger if exists comments_guard_trg on public.comments;
create trigger comments_guard_trg
before insert on public.comments
for each row execute function public.comments_guard();

drop policy if exists "read comments" on public.comments;
drop policy if exists "add comments" on public.comments;
drop policy if exists "admin delete comments" on public.comments;
create policy "read comments" on public.comments for select to authenticated
  using (exists (select 1 from public.notes n where n.id = comments.note_id));
create policy "add comments" on public.comments for insert to authenticated
  with check (auth.uid() = user_id
              and exists (select 1 from public.notes n where n.id = comments.note_id and n.status = 'approved'));
create policy "admin delete comments" on public.comments for delete to authenticated
  using (public.is_admin());

-- ---------- 4) REVIEWERS: SUBJECTS, TOPICS, QUESTIONS ----------
create table if not exists public.subjects (
  id bigint generated always as identity primary key,
  code text not null unique,
  title text not null
);
create table if not exists public.topics (
  id bigint generated always as identity primary key,
  subject_id bigint not null references public.subjects(id) on delete cascade,
  title text not null,
  reviewer text not null default '',
  created_at timestamptz default now()
);
create table if not exists public.questions (
  id bigint generated always as identity primary key,
  topic_id bigint not null references public.topics(id) on delete cascade,
  qtype text not null check (qtype in ('mcq','identification')),
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  position int not null default 0,
  created_at timestamptz default now()
);
-- answers live in their own admin-only table so students cannot read them
create table if not exists public.question_keys (
  question_id bigint primary key references public.questions(id) on delete cascade,
  answer text not null
);

alter table public.subjects      enable row level security;
alter table public.topics        enable row level security;
alter table public.questions     enable row level security;
alter table public.question_keys enable row level security;

drop policy if exists "read subjects" on public.subjects;
drop policy if exists "admin subjects" on public.subjects;
drop policy if exists "read topics" on public.topics;
drop policy if exists "admin topics" on public.topics;
drop policy if exists "read questions" on public.questions;
drop policy if exists "admin questions" on public.questions;
drop policy if exists "admin keys" on public.question_keys;

create policy "read subjects"  on public.subjects  for select to authenticated using (true);
create policy "admin subjects" on public.subjects  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read topics"    on public.topics    for select to authenticated using (true);
create policy "admin topics"   on public.topics    for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read questions" on public.questions for select to authenticated using (true);
create policy "admin questions" on public.questions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin keys"     on public.question_keys for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.subjects (code, title) values
  ('GED101', 'Purposive Communication'),
  ('GED102', 'Mathematics in the Modern World'),
  ('GED103', 'Science, Technology and Society'),
  ('ITE110', 'Social and Professional Issues'),
  ('ITE111', 'Introduction to Computing'),
  ('ITE112', 'Fundamentals of Programming'),
  ('NST101', 'National Service Training Program 1'),
  ('PE101',  'Physical Activities Towards Health and Fitness 1'),
  ('UID101', 'University Identity 1: Manila Studies')
on conflict (code) do nothing;

-- ---------- 5) QUIZ ATTEMPTS (saved drafts, retries) ----------
create table if not exists public.attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  topic_id bigint not null references public.topics(id) on delete cascade,
  attempt_no int not null default 1,
  status text not null default 'in_progress' check (status in ('in_progress','submitted')),
  answers jsonb not null default '{}'::jsonb,
  results jsonb,
  score int,
  total int,
  started_at timestamptz default now(),
  updated_at timestamptz default now(),
  submitted_at timestamptz
);
alter table public.attempts enable row level security;

-- users can only READ attempts; all writes go through the functions below
drop policy if exists "read own attempts" on public.attempts;
create policy "read own attempts" on public.attempts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- start a new try, or return the unfinished one so the student can continue
create or replace function public.start_attempt(p_topic bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.attempts%rowtype;
begin
  if auth.uid() is null then raise exception 'Not logged in'; end if;
  select * into a from public.attempts
   where user_id = auth.uid() and topic_id = p_topic and status = 'in_progress'
   order by id desc limit 1;
  if found then return to_jsonb(a); end if;
  insert into public.attempts (user_id, topic_id, attempt_no)
  values (auth.uid(), p_topic,
          coalesce((select max(attempt_no) from public.attempts
                     where user_id = auth.uid() and topic_id = p_topic), 0) + 1)
  returning * into a;
  return to_jsonb(a);
end;
$$;

-- autosave answers of an unfinished try
create or replace function public.save_answers(p_attempt bigint, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.attempts
     set answers = coalesce(p_answers, '{}'::jsonb), updated_at = now()
   where id = p_attempt and user_id = auth.uid() and status = 'in_progress';
end;
$$;

-- grade a try on the server (answer keys never leave the database)
create or replace function public.submit_quiz(p_attempt bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.attempts%rowtype;
  q record;
  v_given text;
  v_ok boolean;
  v_score int := 0;
  v_total int := 0;
  v_results jsonb := '[]'::jsonb;
begin
  select * into a from public.attempts where id = p_attempt and user_id = auth.uid();
  if not found then raise exception 'Attempt not found'; end if;
  if a.status = 'submitted' then raise exception 'This try was already submitted'; end if;

  for q in
    select qu.id, qu.prompt, k.answer
      from public.questions qu
      join public.question_keys k on k.question_id = qu.id
     where qu.topic_id = a.topic_id
     order by qu.position, qu.id
  loop
    v_total := v_total + 1;
    v_given := coalesce(a.answers ->> (q.id::text), '');
    v_ok := lower(trim(v_given)) = lower(trim(q.answer));
    if v_ok then v_score := v_score + 1; end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'question_id', q.id, 'prompt', q.prompt, 'given', v_given, 'correct', q.answer, 'ok', v_ok));
  end loop;

  update public.attempts
     set status = 'submitted', score = v_score, total = v_total,
         results = v_results, submitted_at = now(), updated_at = now()
   where id = p_attempt;

  return jsonb_build_object('score', v_score, 'total', v_total, 'results', v_results);
end;
$$;

-- admin: add one or many questions (with their answers) in one go
create or replace function public.add_questions(p_topic bigint, p_items jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare it jsonb; qid bigint; n int := 0; pos int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select coalesce(max(position), 0) into pos from public.questions where topic_id = p_topic;
  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    insert into public.questions (topic_id, qtype, prompt, options, position)
    values (p_topic, it ->> 'qtype', it ->> 'prompt', coalesce(it -> 'options', '[]'::jsonb), pos)
    returning id into qid;
    insert into public.question_keys (question_id, answer) values (qid, it ->> 'answer');
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.start_attempt(bigint)        from public, anon;
revoke execute on function public.save_answers(bigint, jsonb)  from public, anon;
revoke execute on function public.submit_quiz(bigint)          from public, anon;
revoke execute on function public.add_questions(bigint, jsonb) from public, anon;
grant  execute on function public.start_attempt(bigint)        to authenticated;
grant  execute on function public.save_answers(bigint, jsonb)  to authenticated;
grant  execute on function public.submit_quiz(bigint)          to authenticated;
grant  execute on function public.add_questions(bigint, jsonb) to authenticated;

-- ---------- 6) MAKE YOURSELF ADMIN (after migration_features.sql) ----------
-- update public.profiles set role = 'admin' where student_number = '00-00-000';
