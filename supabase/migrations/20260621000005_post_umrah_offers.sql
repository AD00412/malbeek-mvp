-- ============================================================
--  ملبّيك — عروضُ ما بعد العمرة   [P2]
--  هدفُ تسويقٍ جديد 'post_umrah' = معتمرو الرحلات المنتهية (done/عادت)،
--  لإرسال عروضٍ لمن أتمّ عمرته. امتدادٌ على نظام التسويق القائم:
--  لا آليّةَ إرسالٍ جديدة — يُملأ المتلقّون ويُرسلهم المالكُ عبر التدفّق القائم.
--
--  "منتهية" = status='done' أو return_at مضى أو (بلا return_at و depart_at + ٧ أيّام مضت)
--  — يطابق tripLifecycle.returned في الواجهة.
--  forward-only · idempotent · شغّله في Supabase SQL Editor.
-- ============================================================

-- ١) توسيعُ قيد target_filter ليشمل 'post_umrah'
alter table public.marketing_broadcasts drop constraint if exists marketing_broadcasts_target_filter_check;
alter table public.marketing_broadcasts
  add constraint marketing_broadcasts_target_filter_check
  check (target_filter in ('all_customers','customers_of_trip','specific_emails','post_umrah'));

-- ٢) إنشاءُ حملةٍ — يدعم post_umrah (نسخةٌ كاملةٌ مع الفرع الجديد)
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
  if p_target not in ('all_customers','customers_of_trip','specific_emails','post_umrah') then
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
  elsif p_target = 'post_umrah' then
    insert into public.broadcast_recipients (broadcast_id, customer_id, email, name)
    select distinct on (lower(c.email)) v_id, c.id, lower(c.email), c.full_name
    from public.passengers p
    join public.trips t on t.id = p.trip_id
    join public.customers c on c.subscriber_id = p.subscriber_id
      and (c.national_id = p.national_id or c.phone = p.phone)
    where p.subscriber_id = v_sub
      and (t.status = 'done' or t.return_at < now()
           or (t.return_at is null and t.depart_at < now() - interval '7 days'))
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

-- ٣) عَدّادُ الجمهور — يدعم post_umrah
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
  elsif p_target = 'post_umrah' then
    select count(distinct lower(c.email)) into v_count
    from public.passengers p
    join public.trips t on t.id = p.trip_id
    join public.customers c on c.subscriber_id = p.subscriber_id
      and (c.national_id = p.national_id or c.phone = p.phone)
    where p.subscriber_id = v_sub
      and (t.status = 'done' or t.return_at < now()
           or (t.return_at is null and t.depart_at < now() - interval '7 days'))
      and c.email is not null and char_length(trim(c.email)) > 5
      and coalesce(c.marketing_opt_in, true) = true;
  end if;
  return v_count;
end $$;
revoke all on function public.count_marketing_audience(text, uuid) from public, anon;
grant  execute on function public.count_marketing_audience(text, uuid) to authenticated;
