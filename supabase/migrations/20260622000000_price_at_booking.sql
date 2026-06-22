-- ============================================================
--  ملبّيك — تثبيتُ سعر المقعد وقت الحجز (price_at_booking)   [محاسبة]
--  المشكلة: «المتوقّع» في التقرير الماليّ = السعر الحاليّ × المسجّلين.
--  لو تغيّر سعرُ الرحلة بعد تسجيل بعض المعتمرين، انحرف المتوقّع تاريخيًّا.
--
--  الحلّ: عمودٌ يُثبّت سعرَ الرحلة لحظةَ الحجز (لكلِّ معتمر)، فيُحسب
--  المتوقّع من مجموع الأسعار المثبّتة بدل السعر الحاليّ.
--
--  • إضافيٌّ غير متلف · forward-only · idempotent · شغّله في SQL Editor.
-- ============================================================

-- ١) العمود
alter table public.passengers add column if not exists price_at_booking numeric(10,2);

-- ٢) تعبئةٌ رجعيّةٌ للصفوف القائمة:
--    المدفوع → المبلغ الفعليّ (amount)؛ غيره → سعر الرحلة الحاليّ (أفضل تقدير).
update public.passengers p
set price_at_booking = coalesce(p.amount, t.price)
from public.trips t
where t.id = p.trip_id and p.price_at_booking is null;

-- ٣) تثبيتٌ تلقائيٌّ عند الإدراج من سعر الرحلة وقتَها.
--    تثبيتٌ تعريفيٌّ: سعرُ الحجز هو سعرُ الرحلة لحظتَها — لا يُضبط يدويًّا،
--    فالمحفّز يكتبه دائمًا (يتجاوز أيَّ قيمةٍ يُرسلها العميل) → آمنٌ من التلاعب.
create or replace function public.snapshot_price_at_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select price into new.price_at_booking from public.trips where id = new.trip_id;
  return new;
end $$;
revoke all on function public.snapshot_price_at_booking() from public, anon;

-- ترتيبُ المحفّزات: trg_guard_passengers (g) يسبق trg_price_at_booking (p) أبجديًّا،
-- فيُطبَّق حارسُ الأعمدة أوّلًا ثمّ يُثبَّت السعرُ أخيرًا (القيمةُ الموثوقةُ تَغلب).
drop trigger if exists trg_price_at_booking on public.passengers;
create trigger trg_price_at_booking
  before insert on public.passengers
  for each row execute function public.snapshot_price_at_booking();

notify pgrst, 'reload schema';
