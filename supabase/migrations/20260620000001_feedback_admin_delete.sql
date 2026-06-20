-- ============================================================
-- إضافةُ سياسة DELETE على feedback — للأدمن فقط (تنظيفُ السبام)
-- ============================================================
-- قبل هذا: لا سياسةَ DELETE → حتّى الأدمن لا يَستطيع حذفَ رسائلَ سبام
-- أو إساءة من قاعدة البيانات. الجدولُ يَتراكم بلا تنظيفٍ ممكن.
-- ============================================================

drop policy if exists "feedback delete" on public.feedback;
create policy "feedback delete"
  on public.feedback
  for delete
  to authenticated
  using (my_role() = 'admin'::user_role);
