-- ============================================================
-- ملبّيك · فتحُ القراءة لـ support — RLS + RPCs
-- ============================================================
-- الجلسةُ الحاليّة: محمد خالد دَخل بصفة support لكنّ الصفحات
-- فارغة لأنّ كلّ سياسات «admin read» تَحجبُه. الحلّ: helper
-- جديدةٌ is_staff() ثمّ تَوسيع SELECT لتَشمل support.
-- KEEP: كلُّ UPDATE/DELETE/INSERT للأدمن فقط (دون تَغيير).
-- idempotent.
-- ============================================================

-- ─── ١) helper موحَّدة ───
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select (select role from public.profiles where id = auth.uid()) in ('admin'::user_role, 'support'::user_role);
$$;
revoke all on function public.is_staff() from public, anon;
grant  execute on function public.is_staff() to authenticated;

-- ─── ٢) admin_campaign_stats: يَفتح للـsupport ───
create or replace function public.admin_campaign_stats()
returns table(
  subscriber_id uuid, org_name text, slug text, plan plan_type,
  trips_count int, pax_count int, paid_count int, collected numeric, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id, s.org_name, s.slug, s.plan,
    (select count(*)::int from public.trips t where t.subscriber_id = s.id),
    (select count(*)::int from public.passengers p where p.subscriber_id = s.id),
    (select count(*)::int from public.passengers p
       where p.subscriber_id = s.id and p.status in ('paid','boarded','checked_in')),
    (select coalesce(sum(p.amount),0) from public.passengers p
       where p.subscriber_id = s.id and p.status in ('paid','boarded','checked_in')),
    s.created_at
  from public.subscribers s
  where public.is_staff()
  order by s.created_at desc;
$$;

-- ─── ٣) تَوسيع سياسات SELECT لتَشمل support ───
-- استبدالُ كلّ سياسة admin-only-read بأخرى تَستعمل is_staff()

-- subscribers
drop policy if exists "subscriber admin read" on public.subscribers;
create policy "subscriber admin read" on public.subscribers
  for select using ((select public.is_staff()));

-- trips
drop policy if exists "trips admin read" on public.trips;
create policy "trips admin read" on public.trips
  for select using ((select public.is_staff()));

-- passengers
drop policy if exists "passengers admin read" on public.passengers;
create policy "passengers admin read" on public.passengers
  for select using ((select public.is_staff()));

-- customers
drop policy if exists "customers admin read" on public.customers;
create policy "customers admin read" on public.customers
  for select using ((select public.is_staff()));

-- payments
drop policy if exists "payments admin read" on public.payments;
create policy "payments admin read" on public.payments
  for select using ((select public.is_staff()));

-- hotels + rooms
drop policy if exists "hotels admin read" on public.hotels;
create policy "hotels admin read" on public.hotels
  for select using ((select public.is_staff()));
drop policy if exists "rooms admin read" on public.hotel_rooms;
create policy "rooms admin read" on public.hotel_rooms
  for select using ((select public.is_staff()));

-- audit_logs
drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs
  for select using ((select public.is_staff()));

-- trip_buses
drop policy if exists "trip_buses admin read" on public.trip_buses;
create policy "trip_buses admin read" on public.trip_buses
  for select using ((select public.is_staff()));

-- refunds
drop policy if exists "refunds admin read" on public.refunds;
create policy "refunds admin read" on public.refunds
  for select using ((select public.is_staff()));

-- waitlist
drop policy if exists "wait admin read" on public.waitlist;
create policy "wait admin read" on public.waitlist
  for select using ((select public.is_staff()));

-- profiles (يَبقى self-read)
drop policy if exists "profile self read" on public.profiles;
create policy "profile self read" on public.profiles
  for select using (id = (select auth.uid()) or (select public.is_staff()));

-- notifications: قراءةُ admin audience متاحةٌ لـstaff
drop policy if exists "notif admin read" on public.notifications;
create policy "notif admin read" on public.notifications
  for select using ((select public.is_staff()) and audience = 'admin');

-- feedback (admin/support يَقرؤون كلَّ التَّغذية الراجعة — السياسةُ مَفقودةٌ
-- أصلًا، فقط self-read كانت موجودة)
drop policy if exists "feedback admin read" on public.feedback;
create policy "feedback admin read" on public.feedback
  for select using ((select public.is_staff()));

-- public_messages: support يَقرأ كذلك
drop policy if exists "pmsg admin read" on public.public_messages;
create policy "pmsg admin read" on public.public_messages
  for select using ((select public.is_staff()));

-- ─── ٤) إعادةُ تَحميل schema ───
notify pgrst, 'reload schema';

-- ─── تحقّق ───
select 'is_staff helper' as item,
       case when exists(select 1 from pg_proc where proname = 'is_staff') then 'OK ✓' else 'MISSING ✗' end as status
union all
select 'admin_campaign_stats uses is_staff',
       case when (select pg_get_functiondef(oid) from pg_proc where proname = 'admin_campaign_stats') like '%is_staff%'
            then 'OK ✓' else 'MISSING ✗' end
union all
select 'select policies updated',
       (select count(*)::text from pg_policies
        where schemaname='public' and policyname in (
          'subscriber admin read','trips admin read','passengers admin read','customers admin read',
          'payments admin read','hotels admin read','rooms admin read','audit admin read',
          'trip_buses admin read','refunds admin read','wait admin read','profile self read',
          'notif admin read','feedback admin read','pmsg admin read')) || ' / 15';
