-- ============================================================
--  ملبّيك — قراءةٌ آمنةُ الأعمدة لبيانات الحملة (للعميل)   [أمن]
--  المشكلة: سياسة "subscribers select" صفّيّةٌ (RLS لا يقيّد الأعمدة)،
--  فالعميلُ كان يقرأ صفَّ حملته بكلّ أعمدته — بما فيها admin_notes
--  (المخصّصة للإدارة) و suspended_reason و trial_*.
--
--  الحلّ: VIEW عامّةٌ v_subscriber_public بالأعمدة الآمنة فقط (definer،
--  تتجاوز RLS وتَحرس النطاقَ بشرط WHERE)، وتضييقُ سياسة الجدول لتُزيل
--  فرعَ العميل (id = my_subscriber_id) — فيبقى الجدولُ للأدمن/المالك/الفريق،
--  ويقرأ العميلُ بياناتِ حملته العامّة عبر الـVIEW.
--
--  لا يكسر: الأدمن (my_role='admin') والمالك (owner_id) والفريق (can_manage_sub)
--  يقرؤون الجدولَ كاملًا كما كان؛ ودورُ support له سياسته المنفصلة (تُعالَج لاحقًا).
--  forward-only · idempotent · شغّله في Supabase SQL Editor.
-- ============================================================

-- ١) VIEW آمنةُ الأعمدة — تستثني admin_notes / suspended_* / trial_* / owner_id.
--    definer (الافتراضيّ): تتجاوز RLS، فالنطاقُ يُفرَض بشرط WHERE أدناه.
create or replace view public.v_subscriber_public as
select
  s.id, s.org_name, s.slug, s.logo_url, s.stamp_url, s.store_url,
  s.contact_phone, s.license_no, s.carrier_company, s.plan,
  s.bank_account_name, s.bank_name, s.bank_iban, s.created_at
from public.subscribers s
where s.id = public.my_subscriber_id()        -- العميل: حملته فقط
   or public.can_manage_sub(s.id)             -- المالك/الفريق
   or public.my_role() = any (array['admin','support']::user_role[]);  -- الإشراف

grant select on public.v_subscriber_public to authenticated;

-- ٢) تضييقُ سياسة قراءة الجدول: إزالةُ فرع العميل (id = my_subscriber_id).
--    يبقى: الأدمن + المالك + الفريق. (تضييقٌ للوصول — لا توسيع.)
drop policy if exists "subscribers select" on public.subscribers;
create policy "subscribers select" on public.subscribers for select to authenticated using (
  my_role() = 'admin'::user_role
  or owner_id = (select auth.uid())
  or can_manage_sub(id)
);
