-- ============================================================
-- ملبّيك · فحصُ DB في صفٍّ واحد (Supabase ▸ SQL Editor)
-- ============================================================
-- الصق ‎كاملَ‎ هذا الاستعلام واضغط Run. النتيجةُ صفٌّ واحدٌ
-- يُلخّص حالةَ حسابك وقاعدتك — صوّرها وأرسلها وأنا أحلّل.
-- ============================================================
select
  -- مَن أنا
  auth.uid()                                                as my_uid,
  (select role      from public.profiles where id = auth.uid())  as my_role,
  (select full_name from public.profiles where id = auth.uid())  as my_name,
  public.my_managed_subscriber_id()                         as my_sub_id,
  (select org_name from public.subscribers
     where id = public.my_managed_subscriber_id())          as my_org,

  -- عدّاد الجرس (هذا هو الرقم الذي يظهر على الإشعارات)
  public.unread_notifications_count()                       as bell_badge,

  -- توزيع إشعاراتي
  (select count(*) from public.notifications
     where profile_id = auth.uid())                         as my_notif_total,
  (select count(*) from public.notifications
     where profile_id = auth.uid() and read_at is null)     as my_notif_unread,

  -- آخرُ إشعارٍ غير مقروء (السببُ المباشر لرقم الجرس)
  (select kind || ' · ' || left(coalesce(title,''), 50)
     from public.notifications
     where profile_id = auth.uid() and read_at is null
     order by created_at desc limit 1)                      as last_unread_kind,
  (select created_at from public.notifications
     where profile_id = auth.uid() and read_at is null
     order by created_at desc limit 1)                      as last_unread_at,

  -- إحصاءُ بياناتي (الذي كان شريطُ «نشطٌ الآن» يَعرضه)
  (select count(*) from public.trips
     where subscriber_id = public.my_managed_subscriber_id())  as my_trips_total,
  (select count(*) from public.passengers p
     join public.trips t on t.id = p.trip_id
     where t.subscriber_id = public.my_managed_subscriber_id()) as my_pax_total,
  (select count(*) from public.passengers p
     join public.trips t on t.id = p.trip_id
     where t.subscriber_id = public.my_managed_subscriber_id()
       and p.status <> 'checked_in')                          as pax_pending_checkin,

  -- سلامة DB
  (select count(*) from public.notifications n
     left join public.profiles p on p.id = n.profile_id
     where p.id is null)                                    as orphan_notifications,
  (select count(*) from public.passengers pa
     left join public.trips t on t.id = pa.trip_id
     where t.id is null)                                    as orphan_passengers,

  -- وقتُ الفحص (لتزامنِ النتيجة مع لقطتك)
  now()                                                     as checked_at
;
