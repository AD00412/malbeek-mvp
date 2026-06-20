-- ============================================================
-- ملبّيك · إضافةُ عمود plan_started_at للمشتركين
-- ============================================================
-- المشكلة: set_subscriber_plan RPC يَستعمل subscribers.plan_started_at
-- لكنّ العمودَ غير موجود → ‹Could not find the column› → 400.
-- ظَهر بَعد محاولة «إرجاع لتجريبية» من شاشة تَفاصيل المشترك.
-- الإصلاح: إضافةُ العمود (idempotent، لا يَكسر شيئًا قائمًا).
-- ============================================================

alter table public.subscribers
  add column if not exists plan_started_at timestamptz;

-- مَنطقُ التَّعبئة: المشتركون الحاليّون بـplan='paid' يَستحقّون قيمةً
-- (created_at كقيمةٍ تَقريبيّةٍ منطقيّة)، الباقي يَبقى null.
update public.subscribers
   set plan_started_at = coalesce(plan_started_at, created_at)
 where plan = 'paid' and plan_started_at is null;

comment on column public.subscribers.plan_started_at is
  'تاريخُ بدءِ الباقة المدفوعة — تُعبّأ عند تَرقية المشترك.';

notify pgrst, 'reload schema';

-- تحقّق
select 'plan_started_at column' as item,
       case when exists(
         select 1 from information_schema.columns
         where table_schema='public' and table_name='subscribers' and column_name='plan_started_at'
       ) then 'OK ✓' else 'MISSING ✗' end as status;
