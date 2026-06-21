-- ============================================================
--  ملبّيك — تحصينُ RLS لجدول ratings   [P1 · أمن]
--  إغلاقُ ثغرة: السياسةُ المُجمَّعة (FOR ALL) كانت تَسمح لفريق الحملة
--  بحذف/تعديل تقييمات المعتمرين عنها (customer_to_subscriber) عبر
--  using غير المقيَّد بالاتّجاه — ما يكسر حياديّة التقييم.
--
--  الإصلاح: فصلُ صلاحيّات الحملة —
--    • قراءةُ الاتّجاهين (لِتَرى تقييمَ المعتمرين لها + ملاحظاتِها عنهم).
--    • الكتابة/التعديل/الحذف لاتّجاهها فقط (subscriber_to_customer).
--  المعتمرُ يملك تقييمَه وحده، والأدمنُ قراءةٌ فقط (كما كان).
--  forward-only · idempotent · شغّله في Supabase SQL Editor.
-- ============================================================

-- إسقاطُ السياسات السابقة (المُجمَّعة)
drop policy if exists "ratings customer rw"   on public.ratings;
drop policy if exists "ratings manager rw"    on public.ratings;
drop policy if exists "ratings admin read"    on public.ratings;
-- وأيِّ نسخٍ من السياسات الجديدة (لإعادة التشغيل الآمن)
drop policy if exists "ratings manager read"   on public.ratings;
drop policy if exists "ratings manager insert" on public.ratings;
drop policy if exists "ratings manager update" on public.ratings;
drop policy if exists "ratings manager delete" on public.ratings;

-- ── المعتمر: يملك تقييمَه وحده (قراءة/إنشاء/تعديل/حذف) ──────────────
--   شرطُ "حجزَ الرحلةَ فعلًا" على الكتابة يَمنع تقييمَ حملةٍ لم يُسافر معها.
create policy "ratings customer rw" on public.ratings for all
  using (
    direction = 'customer_to_subscriber'
    and profile_id = auth.uid()
  )
  with check (
    direction = 'customer_to_subscriber'
    and profile_id = auth.uid()
    and exists (
      select 1 from public.passengers p
      where p.trip_id = ratings.trip_id
        and p.profile_id = auth.uid()
        and p.subscriber_id = ratings.subscriber_id
    )
  );

-- ── فريقُ الحملة: قراءةُ الاتّجاهين فقط (لا يَمسّ تقييمَ المعتمرين عنه) ──
create policy "ratings manager read" on public.ratings for select
  using (public.can_manage_sub(subscriber_id));

-- ── فريقُ الحملة: إنشاء/تعديل/حذف تقييمه عن المعتمر فقط ────────────────
create policy "ratings manager insert" on public.ratings for insert
  with check (public.can_manage_sub(subscriber_id) and direction = 'subscriber_to_customer');

create policy "ratings manager update" on public.ratings for update
  using      (public.can_manage_sub(subscriber_id) and direction = 'subscriber_to_customer')
  with check (public.can_manage_sub(subscriber_id) and direction = 'subscriber_to_customer');

create policy "ratings manager delete" on public.ratings for delete
  using (public.can_manage_sub(subscriber_id) and direction = 'subscriber_to_customer');

-- ── الأدمن: قراءةٌ كاملةٌ للإشراف ──────────────────────────────────
create policy "ratings admin read" on public.ratings for select
  using (public.my_role() = 'admin');
