-- ============================================================
-- ملبّيك · حملاتُ التَّسويق الجماعيّ
-- ============================================================
-- يَسمح للمشترك بإرسال رسائلَ بريديّةٍ مَوحَّدةٍ لقاعدة معتمريه
-- (عُروض الرحلات القادمة، تَذكير، تَنبيهات).
-- الأمنُ: المشترك يُرسل لقاعدتِه فقط، لا يَخرق RLS أيِّ مشتركٍ آخر.
-- ============================================================

-- ١) إضافةُ بريد المعتمر (لِجَلب التَّسويق)
alter table public.customers
  add column if not exists email text,
  add column if not exists marketing_opt_in boolean not null default true;

-- ٢) جدول الحملات
create table if not exists public.marketing_broadcasts (
  id              uuid primary key default gen_random_uuid(),
  subscriber_id   uuid not null references public.subscribers(id) on delete cascade,
  created_by      uuid references public.profiles(id),
  channel         text not null default 'email' check (channel in ('email')),
  subject         text not null,
  body            text not null,
  target_filter   text not null default 'all_customers'
                    check (target_filter in ('all_customers','customers_of_trip','specific_emails')),
  target_trip_id  uuid references public.trips(id) on delete set null,
  target_emails   text[] default '{}',
  recipient_count int not null default 0,
  sent_count      int not null default 0,
  failed_count    int not null default 0,
  status          text not null default 'draft'
                    check (status in ('draft','queued','sending','sent','failed','cancelled')),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  error_detail    text
);
create index if not exists idx_broadcast_sub on public.marketing_broadcasts(subscriber_id, created_at desc);
create index if not exists idx_broadcast_status on public.marketing_broadcasts(status, created_at desc);

alter table public.marketing_broadcasts enable row level security;

-- المشترك (مالكُ الحملة) يَقرأ حملاتِه، الأدمن/الدعم يَقرؤون الكلّ
drop policy if exists "broadcast owner read" on public.marketing_broadcasts;
create policy "broadcast owner read" on public.marketing_broadcasts
  for select to authenticated using (
    subscriber_id in (select id from public.subscribers where owner_id = auth.uid())
    or (select public.is_staff())
  );

-- ٣) جدول المُتلقّين
create table if not exists public.broadcast_recipients (
  id              uuid primary key default gen_random_uuid(),
  broadcast_id    uuid not null references public.marketing_broadcasts(id) on delete cascade,
  customer_id     uuid references public.customers(id) on delete set null,
  email           text not null,
  name            text,
  status          text not null default 'pending'
                    check (status in ('pending','sent','failed','bounced','skipped')),
  sent_at         timestamptz,
  error_detail    text
);
create index if not exists idx_recipient_broadcast on public.broadcast_recipients(broadcast_id, status);
create index if not exists idx_recipient_pending on public.broadcast_recipients(status, broadcast_id) where status = 'pending';

alter table public.broadcast_recipients enable row level security;

drop policy if exists "broadcast recipient owner read" on public.broadcast_recipients;
create policy "broadcast recipient owner read" on public.broadcast_recipients
  for select to authenticated using (
    broadcast_id in (
      select b.id from public.marketing_broadcasts b
      where b.subscriber_id in (select id from public.subscribers where owner_id = auth.uid())
    )
    or (select public.is_staff())
  );

-- ٤) RPC: إنشاءُ حملةٍ — يَملأ المُتلقّين تَلقائيًّا
create or replace function public.create_marketing_broadcast(
  p_subject       text,
  p_body          text,
  p_target        text default 'all_customers',
  p_trip_id       uuid default null,
  p_extra_emails  text[] default '{}'
) returns table(broadcast_id uuid, recipient_count int)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_sub uuid;
  v_id uuid;
  v_count int := 0;
begin
  if auth.uid() is null then raise exception 'must-login' using errcode = '42501'; end if;
  select id into v_sub from public.subscribers where owner_id = auth.uid() limit 1;
  if v_sub is null then raise exception 'no-subscriber' using errcode = '02000'; end if;
  if char_length(coalesce(trim(p_subject),'')) < 3 then raise exception 'subject-too-short' using errcode = '22023'; end if;
  if char_length(coalesce(trim(p_body),'')) < 10 then raise exception 'body-too-short' using errcode = '22023'; end if;
  if p_target not in ('all_customers','customers_of_trip','specific_emails') then
    raise exception 'invalid-target' using errcode = '22023';
  end if;
  if p_target = 'customers_of_trip' and p_trip_id is null then
    raise exception 'trip-required' using errcode = '22023';
  end if;

  insert into public.marketing_broadcasts (subscriber_id, created_by, subject, body, target_filter, target_trip_id, target_emails, status)
  values (v_sub, auth.uid(), trim(p_subject), trim(p_body), p_target, p_trip_id, coalesce(p_extra_emails, '{}'), 'queued')
  returning id into v_id;

  -- جَلبُ المُتلقّين حسب الفلتر
  if p_target = 'all_customers' then
    insert into public.broadcast_recipients (broadcast_id, customer_id, email, name)
    select v_id, c.id, lower(c.email), c.full_name
    from public.customers c
    where c.subscriber_id = v_sub
      and c.email is not null and char_length(trim(c.email)) > 5
      and coalesce(c.marketing_opt_in, true) = true
    on conflict do nothing;
  elsif p_target = 'customers_of_trip' then
    insert into public.broadcast_recipients (broadcast_id, customer_id, email, name)
    select distinct on (lower(c.email)) v_id, c.id, lower(c.email), c.full_name
    from public.passengers p
    join public.customers c on c.subscriber_id = p.subscriber_id
      and (c.national_id = p.national_id or c.phone = p.phone)
    where p.trip_id = p_trip_id and p.subscriber_id = v_sub
      and c.email is not null and char_length(trim(c.email)) > 5
      and coalesce(c.marketing_opt_in, true) = true;
  elsif p_target = 'specific_emails' then
    insert into public.broadcast_recipients (broadcast_id, email, name)
    select v_id, lower(em), null
    from unnest(coalesce(p_extra_emails, '{}'::text[])) as em
    where em is not null and em ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  end if;

  select count(*) into v_count from public.broadcast_recipients where broadcast_id = v_id;
  update public.marketing_broadcasts set recipient_count = v_count where id = v_id;

  if v_count = 0 then
    update public.marketing_broadcasts set status = 'failed', error_detail = 'no-recipients' where id = v_id;
    raise exception 'no-recipients' using errcode = '22023',
      hint = 'لا يَوجد معتمرون بإيميلاتٍ صحيحةٍ في هذه الفلترة.';
  end if;

  return query select v_id, v_count;
end $$;
revoke all on function public.create_marketing_broadcast(text, text, text, uuid, text[]) from public, anon;
grant  execute on function public.create_marketing_broadcast(text, text, text, uuid, text[]) to authenticated;

-- ٥) RPC: قائمةُ حملاتي
create or replace function public.list_my_broadcasts(p_limit int default 30)
returns table(
  id uuid, subject text, channel text, target_filter text, target_trip_id uuid,
  recipient_count int, sent_count int, failed_count int,
  status text, created_at timestamptz, sent_at timestamptz, error_detail text
)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_sub uuid;
begin
  if auth.uid() is null then raise exception 'must-login' using errcode = '42501'; end if;
  select id into v_sub from public.subscribers where owner_id = auth.uid() limit 1;
  if v_sub is null then return; end if;
  return query
    select b.id::uuid, b.subject::text, b.channel::text, b.target_filter::text, b.target_trip_id::uuid,
           b.recipient_count::int, b.sent_count::int, b.failed_count::int,
           b.status::text, b.created_at::timestamptz, b.sent_at::timestamptz, b.error_detail::text
    from public.marketing_broadcasts b
    where b.subscriber_id = v_sub
    order by b.created_at desc
    limit greatest(1, least(coalesce(p_limit, 30), 100));
end $$;
revoke all on function public.list_my_broadcasts(int) from public, anon;
grant  execute on function public.list_my_broadcasts(int) to authenticated;

-- ٦) RPC: عَدّاد المعتمرين المُؤهَّلين (للوصف قبل الإرسال)
create or replace function public.count_marketing_audience(
  p_target text default 'all_customers',
  p_trip_id uuid default null
) returns int
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_sub uuid; v_count int := 0;
begin
  if auth.uid() is null then raise exception 'must-login' using errcode = '42501'; end if;
  select id into v_sub from public.subscribers where owner_id = auth.uid() limit 1;
  if v_sub is null then return 0; end if;
  if p_target = 'all_customers' then
    select count(*) into v_count
    from public.customers c
    where c.subscriber_id = v_sub
      and c.email is not null and char_length(trim(c.email)) > 5
      and coalesce(c.marketing_opt_in, true) = true;
  elsif p_target = 'customers_of_trip' and p_trip_id is not null then
    select count(distinct lower(c.email)) into v_count
    from public.passengers p
    join public.customers c on c.subscriber_id = p.subscriber_id
      and (c.national_id = p.national_id or c.phone = p.phone)
    where p.trip_id = p_trip_id and p.subscriber_id = v_sub
      and c.email is not null and char_length(trim(c.email)) > 5
      and coalesce(c.marketing_opt_in, true) = true;
  end if;
  return v_count;
end $$;
revoke all on function public.count_marketing_audience(text, uuid) from public, anon;
grant  execute on function public.count_marketing_audience(text, uuid) to authenticated;

notify pgrst, 'reload schema';
