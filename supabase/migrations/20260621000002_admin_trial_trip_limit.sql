-- ============================================================
--  ملبّيك — حدُّ الرحلات التجريبيّة قابلٌ للتمديد إداريًّا   [P1]
--  كان الحدُّ مثبَّتًا على رحلةٍ واحدةٍ داخل enforce_trial_trip_limit.
--  الآن: عمودٌ trial_trip_limit على المشترك (افتراضيًّا ١) يَقرؤه المحفّز،
--  و RPC إداريٌّ set_trial_trip_limit يَرفعه/يُعيده بقرار إدارةٍ موثَّق.
--  forward-only · idempotent · شغّله في Supabase SQL Editor.
-- ============================================================

-- ١) العمودُ الجديد (افتراضيٌّ ١ = سلوكٌ غير مُتغيّرٍ للمشتركين الحاليّين)
alter table public.subscribers
  add column if not exists trial_trip_limit int not null default 1;

-- حارسُ نطاقٍ معقول (١..١٠٠) — يَمنع القيمَ السالبة/الجامحة
do $$ begin
  alter table public.subscribers
    add constraint subscribers_trial_trip_limit_chk check (trial_trip_limit between 1 and 100);
exception when duplicate_object then null; end $$;

-- ٢) المحفّزُ يَقرأ الحدَّ من المشترك بدلَ الرقم المثبَّت
create or replace function public.enforce_trial_trip_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plan  plan_type;
  v_limit int;
  v_count int;
begin
  select plan, coalesce(trial_trip_limit, 1)
    into v_plan, v_limit
    from public.subscribers where id = new.subscriber_id;
  if v_plan = 'trial' then
    select count(*) into v_count from public.trips where subscriber_id = new.subscriber_id;
    if v_count >= v_limit then
      raise exception 'TRIAL_TRIP_LIMIT'
        using hint = 'بلغتَ حدَّ الباقة التجريبيّة لعدد الرحلات. رقِّ باقتك أو اطلب تمديدًا من الإدارة.';
    end if;
  end if;
  return new;
end $$;
-- المحفّزُ نفسُه قائمٌ (before insert on trips) — لا حاجة لإعادة إنشائه.

-- ٣) RPC إداريٌّ: ضبطُ حدِّ الرحلات التجريبيّة (بنفس نمط extend_subscriber_trial)
create or replace function public.set_trial_trip_limit(
  p_sub    uuid,
  p_limit  integer,
  p_reason text default null
) returns integer
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org text; v_old int;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid-limit' using errcode = '22023';
  end if;
  select trial_trip_limit, org_name into v_old, v_org from public.subscribers where id = p_sub;
  if not found then raise exception 'not-found' using errcode = '02000'; end if;
  update public.subscribers set trial_trip_limit = p_limit where id = p_sub;
  perform public._log_admin_action(
    'set_trip_limit', 'subscriber', p_sub, v_org,
    jsonb_build_object('old', v_old, 'new', p_limit, 'reason', p_reason)
  );
  return p_limit;
end $$;

revoke execute on function public.set_trial_trip_limit(uuid, integer, text) from public, anon;
grant  execute on function public.set_trial_trip_limit(uuid, integer, text) to authenticated;
