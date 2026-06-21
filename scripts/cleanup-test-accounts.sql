-- ============================================================
--  ملبّيك — تنظيفُ حسابات الاختبار (test+) قبل التدشين   [§٥]
--  يحذف كلَّ ما بدأ بـ test+ وحملةَ الاختبار وصفوفَها الموسومة.
--  شغّله في Supabase SQL Editor (بصلاحية service_role/postgres).
--
--  ملاحظة: حذفُ auth.users يَتتالى تلقائيًّا عبر FK إلى
--  profiles → subscribers(owner) → trips → passengers → ratings/customers.
--  نَحذف الأبناءَ صراحةً أوّلًا (احتياطًا للصفوف الموسومة بلا مالكٍ مباشر)،
--  ثمّ نَكنس حسابات auth.
-- ============================================================
begin;

-- معرّفُ حملة الاختبار (إن بقيت)
with test_sub as (
  select id from public.subscribers where slug = 'test-campaign-mlk'
)
-- ١) التقييمات المرتبطة بحملة الاختبار
delete from public.ratings r using test_sub s where r.subscriber_id = s.id;

-- ٢) العملاء + الركّاب + الرحلات الموسومة/التابعة لحملة الاختبار
delete from public.customers  c using public.subscribers s where c.subscriber_id = s.id and s.slug = 'test-campaign-mlk';
delete from public.passengers p where p.notes = 'بذرة اختبار';
delete from public.passengers p using public.subscribers s where p.subscriber_id = s.id and s.slug = 'test-campaign-mlk';
delete from public.trips      t where t.notes = 'بذرة اختبار';
delete from public.trips      t using public.subscribers s where t.subscriber_id = s.id and s.slug = 'test-campaign-mlk';

-- ٣) عضويّات الفريق ثمّ الحملة نفسها
delete from public.subscriber_members m using public.subscribers s where m.subscriber_id = s.id and s.slug = 'test-campaign-mlk';
delete from public.subscribers where slug = 'test-campaign-mlk';

-- ٤) كنسُ حسابات auth (يَتتالى إلى profiles وأيِّ بقايا مملوكة)
delete from auth.users where email ilike 'test+%@mulabeek.com';

commit;
