-- ============================================================
-- ملبّيك · تشخيصُ قاعدة البيانات (يدويٌّ في Supabase SQL Editor)
-- ============================================================
-- الغرض: التحقّقُ من سلامةِ البياناتِ المعروضةِ للمستخدم.
-- آمنٌ بالكامل: استعلاماتُ قراءةٍ فقط (عدا قسم التنظيفِ الاختياريّ
-- في الأسفل — معلَّقٌ خلف /* */ بقصد).
--
-- شغّله صفًّا صفًّا أو كاملًا — كلُّ قسمٍ يطبع نتيجةً منفصلة.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- ١) مَن أنا في القاعدة؟ ودوري + ربطي بحملة
-- ─────────────────────────────────────────────────────────────
select auth.uid() as my_uid,
       (select role  from public.profiles where id = auth.uid()) as my_role,
       (select full_name from public.profiles where id = auth.uid()) as my_name,
       public.my_managed_subscriber_id() as my_subscriber_id;

-- ─────────────────────────────────────────────────────────────
-- ٢) عدّاد إشعاراتي غير المقروءة (نفس ما يعرضه الجرس)
-- ─────────────────────────────────────────────────────────────
select public.unread_notifications_count() as bell_badge_should_show;

-- ─────────────────────────────────────────────────────────────
-- ٣) قائمةُ إشعاراتي غير المقروءة — لترى مصدرَ الرقمِ بنفسك
-- ─────────────────────────────────────────────────────────────
select id, kind, title, left(coalesce(body,''), 80) as body_preview, created_at
from public.notifications
where profile_id = auth.uid() and read_at is null
order by created_at desc;

-- ─────────────────────────────────────────────────────────────
-- ٤) آخرُ ٢٠ إشعارًا لي (مقروء وغير مقروء) — للفحصِ الموسَّع
-- ─────────────────────────────────────────────────────────────
select id, kind, title, read_at is not null as is_read, created_at
from public.notifications
where profile_id = auth.uid()
order by created_at desc
limit 20;

-- ─────────────────────────────────────────────────────────────
-- ٥) إحصاءُ معتمري رحلاتي — لأنّ شريطَ «نشطٌ الآن» المحذوف
--    كان يحسبُ count − checked_in. هذا يطابق الرقم القديم.
-- ─────────────────────────────────────────────────────────────
with my_sub as ( select public.my_managed_subscriber_id() as id )
select t.id as trip_id, t.title,
       count(p.*)                                      as total_pax,
       count(p.*) filter (where p.status = 'paid')     as paid,
       count(p.*) filter (where p.status = 'boarded')  as boarded,
       count(p.*) filter (where p.status = 'checked_in') as checked_in,
       count(p.*) filter (where p.status <> 'checked_in') as still_pending
from public.trips t
left join public.passengers p on p.trip_id = t.id
where t.subscriber_id = (select id from my_sub)
group by t.id, t.title
order by t.created_at desc;

-- ─────────────────────────────────────────────────────────────
-- ٦) فحصُ سلامةِ البيانات — صفوفٌ يتيمةٌ أو مشكوكٌ فيها
-- ─────────────────────────────────────────────────────────────
-- إشعاراتٌ بـ profile_id لا يُطابق أيَّ ملفٍّ (يتيمة)
select count(*) as orphan_notifications
from public.notifications n
left join public.profiles p on p.id = n.profile_id
where p.id is null;

-- معتمرون بدون trip موجود (يتيمون)
select count(*) as orphan_passengers
from public.passengers pa
left join public.trips t on t.id = pa.trip_id
where t.id is null;

-- ─────────────────────────────────────────────────────────────
-- ٧) (اختياريّ) تعليم كلِّ إشعاراتي مقروءةً الآن — ينظّف الجرس
--    أزل /* */ لتنفيذِها.
-- ─────────────────────────────────────────────────────────────
/*
update public.notifications
   set read_at = now()
 where profile_id = auth.uid() and read_at is null;
*/

-- ─────────────────────────────────────────────────────────────
-- ٨) (اختياريّ — خَطِرٌ) حذفٌ كاملٌ لإشعاراتي القديمة قبل ٧ أيّام
--    أزل /* */ لتنفيذِها.
-- ─────────────────────────────────────────────────────────────
/*
delete from public.notifications
 where profile_id = auth.uid()
   and created_at < now() - interval '7 days';
*/
