-- تسويق المنصّة (أدمن): إعلانات للمشتركين أو للمعتمرين عبر كل الحملات.
-- الإرسالُ الفعليُّ موقوفٌ (لا دالّة إرسال) — تجهيزٌ وحفظٌ «مسودة» فقط. أدمن فقط.
-- طُبِّق على الإنتاج عبر MCP apply_migration (platform_broadcasts).

create table if not exists public.platform_broadcasts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  audience text not null check (audience in ('subscribers','pilgrims')),
  subject text not null, body text not null,
  status text not null default 'draft',
  recipient_count int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.platform_broadcasts enable row level security;
drop policy if exists "pbc admin read" on public.platform_broadcasts;
create policy "pbc admin read" on public.platform_broadcasts for select to authenticated
  using (public.my_role() = 'admin'::user_role);
grant select on public.platform_broadcasts to authenticated;

create table if not exists public.platform_broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.platform_broadcasts(id) on delete cascade,
  email text not null, name text
);
alter table public.platform_broadcast_recipients enable row level security;
-- لا سياسات قراءة عامّة عمدًا — تُقرأ عبر RPC (security definer) فقط.

create or replace function public.count_platform_audience(p_audience text)
returns integer language sql stable security definer set search_path = public, pg_catalog as $$
  select case
    when public.my_role() <> 'admin'::user_role then 0
    when p_audience = 'subscribers' then
      (select count(distinct lower(u.email)) from public.subscribers s
         join auth.users u on u.id = s.owner_id where u.email is not null)
    when p_audience = 'pilgrims' then
      (select count(distinct lower(c.email)) from public.customers c
         where c.email is not null and char_length(trim(c.email)) > 5
           and coalesce(c.marketing_opt_in, true) = true)
    else 0 end;
$$;
revoke all on function public.count_platform_audience(text) from public, anon;
grant  execute on function public.count_platform_audience(text) to authenticated;

create or replace function public.create_platform_broadcast(p_audience text, p_subject text, p_body text)
returns table(broadcast_id uuid, recipient_count int)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_id uuid; v_n int;
begin
  if public.my_role() <> 'admin'::user_role then raise exception 'admin-only' using errcode='42501'; end if;
  if p_audience not in ('subscribers','pilgrims') then raise exception 'invalid-audience' using errcode='22023'; end if;
  if char_length(coalesce(trim(p_subject),'')) < 3 then raise exception 'subject-too-short' using errcode='22023'; end if;
  if char_length(coalesce(trim(p_body),'')) < 10 then raise exception 'body-too-short' using errcode='22023'; end if;
  insert into public.platform_broadcasts(created_by, audience, subject, body, status)
    values (auth.uid(), p_audience, trim(p_subject), trim(p_body), 'draft') returning id into v_id;
  if p_audience = 'subscribers' then
    insert into public.platform_broadcast_recipients(broadcast_id, email, name)
      select distinct on (lower(u.email)) v_id, lower(u.email), s.org_name
      from public.subscribers s join auth.users u on u.id = s.owner_id where u.email is not null;
  else
    insert into public.platform_broadcast_recipients(broadcast_id, email, name)
      select distinct on (lower(c.email)) v_id, lower(c.email), c.full_name
      from public.customers c where c.email is not null and char_length(trim(c.email)) > 5
        and coalesce(c.marketing_opt_in, true) = true;
  end if;
  select count(*) into v_n from public.platform_broadcast_recipients where broadcast_id = v_id;
  update public.platform_broadcasts set recipient_count = v_n where id = v_id;
  return query select v_id, v_n;
end $$;
revoke all on function public.create_platform_broadcast(text, text, text) from public, anon;
grant  execute on function public.create_platform_broadcast(text, text, text) to authenticated;

create or replace function public.list_platform_broadcasts()
returns setof public.platform_broadcasts language sql stable security definer set search_path = public as $$
  select * from public.platform_broadcasts
  where public.my_role() = 'admin'::user_role order by created_at desc limit 50;
$$;
revoke all on function public.list_platform_broadcasts() from public, anon;
grant  execute on function public.list_platform_broadcasts() to authenticated;

notify pgrst, 'reload schema';
