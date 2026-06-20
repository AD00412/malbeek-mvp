-- ============================================================
-- ملبّيك · إعادةُ هيكلة الإدارة — الخطوة ١/٢
-- ============================================================
-- شغّل هذا أوّلًا، اضغط Run، ثمّ شغّل STEP2.
-- السبب: PostgreSQL لا يَسمح بإضافة قيمة enum ثمّ استعمالها في نفس
-- المعاملة (ERROR 55P04). نَفصل إضافةَ القيمة عن استعمالها.
-- ============================================================

-- إضافةُ دور 'support' (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'user_role' and e.enumlabel = 'support'
  ) then
    alter type user_role add value 'support' before 'subscriber';
  end if;
end $$;

-- ✅ بعد تشغيل هذا بنجاح، شغّل STEP2.
