-- Run after migration_student_number_birthdays.sql.

create table if not exists public.birthday_wishes (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 500),
  created_at timestamptz not null default now()
);
alter table public.birthday_wishes enable row level security;
revoke all on public.birthday_wishes from public, anon, authenticated;

create or replace function public.birthdays_today_with_wishes()
returns table (
  recipient_id uuid,
  recipient_name text,
  wish_id bigint,
  author_name text,
  content text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select birthday.id,
         coalesce(nullif(birthday.full_name, ''), 'Classmate'),
         wish.id,
         case when wish.id is null then null else public.author_of(wish.author_id) end,
         wish.content,
         wish.created_at
  from public.profiles birthday
  left join public.birthday_wishes wish
    on wish.recipient_id = birthday.id
   and wish.recipient_id = auth.uid()
  where auth.uid() is not null
    and birthday.birth_date is not null
    and to_char(birthday.birth_date, 'MM-DD') =
        to_char((now() at time zone 'Asia/Manila')::date, 'MM-DD')
  order by birthday.full_name, wish.created_at;
$$;
revoke all on function public.birthdays_today_with_wishes() from public;
grant execute on function public.birthdays_today_with_wishes() to authenticated;

create or replace function public.post_birthday_wish(
  p_recipient_id uuid,
  p_content text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wish_id bigint;
  v_content text := btrim(p_content);
begin
  if auth.uid() is null then raise exception 'Sign in to send a birthday wish'; end if;
  if v_content is null or char_length(v_content) < 1 or char_length(v_content) > 500 then
    raise exception 'Birthday wishes must be between 1 and 500 characters';
  end if;
  if not exists (
    select 1
    from public.profiles birthday
    where birthday.id = p_recipient_id
      and birthday.birth_date is not null
      and to_char(birthday.birth_date, 'MM-DD') =
          to_char((now() at time zone 'Asia/Manila')::date, 'MM-DD')
  ) then
    raise exception 'Birthday wishes can only be sent to a classmate celebrating today';
  end if;
  if p_recipient_id = auth.uid() then
    raise exception 'You can share a public birthday message instead of sending yourself a wish';
  end if;

  insert into public.birthday_wishes (recipient_id, author_id, content)
  values (p_recipient_id, auth.uid(), v_content)
  returning id into v_wish_id;
  return v_wish_id;
end;
$$;
revoke all on function public.post_birthday_wish(uuid, text) from public;
grant execute on function public.post_birthday_wish(uuid, text) to authenticated;
