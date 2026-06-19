-- ============================================================
--  ملبّيك · 2026-06-19 · إضافة الشركة الناقلة + سائقٍ ثانٍ
-- ============================================================
--  حقولٌ جديدةٌ لتظهرَ في رأس الكشف الرسميّ الموحَّد:
--    • carrier_company  — اسمُ الشركة الناقلة (مثل: «أبو سرحد للنقل»)
--      يُحفظ على مستوى الحملة، فيظهر في كلِّ كشوفاتها تلقائيًّا.
--    • driver2_name / driver2_phone — السائق الثاني (الإمداد/البديل)
--      موجودٌ سابقًا بمسمّى ‎assistant_name/phone‎ — نُبقيهما للتوافق
--      ونُضيفُ ‎driver2_*‎ كصيغةٍ صريحةٍ. الكشفُ يستعملُ driver2 إن وُجد،
--      وإلّا يقعُ على assistant — توافقٌ خلفيٌّ كاملٌ.
--
--  شغّل هذا الملفّ مرّةً واحدةً في Supabase SQL Editor.
-- ============================================================

alter table public.subscribers
  add column if not exists carrier_company text;
comment on column public.subscribers.carrier_company is
  'اسمُ الشركة الناقلة المسؤولة عن الباصات — يظهر في رأس الكشف الرسميّ. إن تُرك فارغًا يُستخدم org_name.';

alter table public.trips
  add column if not exists driver2_name  text,
  add column if not exists driver2_phone text;
comment on column public.trips.driver2_name  is 'اسمُ السائق الثاني (الإمدادُ/البديل) — يُكمَل تلقائيًّا من assistant_name إن لم يُحدَّد.';
comment on column public.trips.driver2_phone is 'جوالُ السائق الثاني — يُكمَل تلقائيًّا من assistant_phone إن لم يُحدَّد.';
