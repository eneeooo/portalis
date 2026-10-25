-- Run after migration_birthday_wishes_privacy.sql.

create table if not exists public.birthday_messages (
  recipient_id uuid primary key references public.profiles(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 500),
  updated_at timestamptz not null default now()
);
alter table public.birthday_messages enable row level security;
revoke all on public.birthday_messages from public, anon, authenticated;

drop function if exists public.birthdays_today_with_wishes();
create or replace function public.birthdays_today_with_wishes()
returns table (
  recipient_id uuid,
  recipient_name text,
  wish_id bigint,
  author_name text,
  content text,
  created_at timestamptz,
  birthday_message text
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
         wish.created_at,
         message.content
  from public.profiles birthday
  left join public.birthday_wishes wish
    on wish.recipient_id = birthday.id
   and wish.recipient_id = auth.uid()
  left join public.birthday_messages message on message.recipient_id = birthday.id
  where auth.uid() is not null
    and birthday.birth_date is not null
    and to_char(birthday.birth_date, 'MM-DD') =
        to_char((now() at time zone 'Asia/Manila')::date, 'MM-DD')
  order by birthday.full_name, wish.created_at;
$$;
revoke all on function public.birthdays_today_with_wishes() from public;
grant execute on function public.birthdays_today_with_wishes() to authenticated;

create or replace function public.post_my_birthday_message(p_content text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content text := btrim(p_content);
begin
  if auth.uid() is null then raise exception 'Sign in to share a birthday message'; end if;
  if v_content is null or char_length(v_content) < 1 or char_length(v_content) > 500 then
    raise exception 'Birthday messages must be between 1 and 500 characters';
  end if;
  if not exists (
    select 1
    from public.profiles birthday
    where birthday.id = auth.uid()
      and birthday.birth_date is not null
      and to_char(birthday.birth_date, 'MM-DD') =
          to_char((now() at time zone 'Asia/Manila')::date, 'MM-DD')
  ) then
    raise exception 'Only a student celebrating today can share a birthday message';
  end if;

  insert into public.birthday_messages (recipient_id, content)
  values (auth.uid(), v_content)
  on conflict (recipient_id) do update
    set content = excluded.content, updated_at = now();
end;
$$;
revoke all on function public.post_my_birthday_message(text) from public;
grant execute on function public.post_my_birthday_message(text) to authenticated;
