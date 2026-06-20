-- ============================================================
-- ملبّيك · إضافةُ دور 'support' (منفصلٌ — enum يَلزمه commit قبل الاستعمال)
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'user_role' and e.enumlabel = 'support'
  ) then
    alter type user_role add value 'support' before 'subscriber';
  end if;
end $$;
