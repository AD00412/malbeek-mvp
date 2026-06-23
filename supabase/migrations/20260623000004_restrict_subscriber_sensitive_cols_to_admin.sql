-- إقفال نطاق الدعم (PII): الأعمدة الحسّاسة في subscribers (bank_iban/bank_name/
-- bank_account_name، admin_notes، suspended_reason) تُقرأ من الأدمن فقط.
--
-- 1) إسقاط سياسة قراءة الموظّفين الكاملة (is_staff) — كانت تمنح الدعم قراءةَ كل
--    الأعمدة. الأدمن يبقى عبر «subscribers select» (my_role()='admin')، والمالك
--    عبر صفّه. الدعم لم يعد يقرأ جدول subscribers مباشرةً (يرجع 0 صفّ).
drop policy if exists "subscriber admin read" on public.subscribers;

-- 2) VIEW للموظّفين (نفس نمط v_subscriber_public): security definer + بوّابة
--    is_staff داخليّة، والأعمدة الحسّاسة تُقنَّع (null) لغير الأدمن. تُغذّي واجهة
--    AdminSubDetail فيعمل الدعم بلا كشف الأسرار. (advisor security_definer_view
--    متوقّعٌ — نفس النمط المقبول لـ v_subscriber_public/v_my_feedback.)
create or replace view public.v_subscriber_staff as
select
  id, owner_id, org_name, slug, plan, trial_ends_at, created_at,
  license_no, stamp_text, stamp_url, logo_url, contact_phone, store_url, carrier_company,
  suspended_at, trial_extended_until, plan_started_at, trial_trip_limit,
  case when public.my_role() = 'admin' then admin_notes       else null end as admin_notes,
  case when public.my_role() = 'admin' then suspended_reason   else null end as suspended_reason,
  case when public.my_role() = 'admin' then bank_account_name  else null end as bank_account_name,
  case when public.my_role() = 'admin' then bank_name          else null end as bank_name,
  case when public.my_role() = 'admin' then bank_iban          else null end as bank_iban
from public.subscribers
where public.is_staff();

grant select on public.v_subscriber_staff to authenticated;
