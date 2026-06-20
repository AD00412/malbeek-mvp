-- ============================================================
-- ملبّيك · إعادةُ هيكلةِ لوحة الإدارة — دور موظّفين + إجراءات + سجلّ
-- ============================================================
--
-- المشكلة قبل: لوحةُ الإدارة كانت عرضًا فقط — لا إجراءاتٍ فعليّة
-- على المشتركين، لا فريق دعمٍ، لا سجلّ تَدقيق.
--
-- هذا الميغريشن يَضيف:
--   ١) دور 'support' لـuser_role enum (موظّفُ دعمٍ بصلاحيّةِ قراءة + تَنفيذٍ
--      مُحدَّد)
--   ٢) أعمدةٌ جديدةٌ في subscribers:
--      - admin_notes: ملاحظاتٌ خاصّةٌ بالإدارة (لا يَراها المشترك)
--      - suspended_at / suspended_reason: تَعليقُ حسابٍ
--      - trial_extended_until: تَمديدُ تَجربةٍ بقرار إداريّ
--   ٣) جدول platform_audit_log: كلُّ إجراءٍ من إدارة/دعمٍ
--   ٤) ٧ RPCs للإجراءات (مُسجَّلةٌ تلقائيًّا في audit_log)
--
-- idempotent — يَجوز تشغيلُه أكثرَ من مرّة.
-- ============================================================

-- ─── ٢) أعمدةُ subscribers الجديدة ───
alter table public.subscribers
  add column if not exists admin_notes text,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists trial_extended_until timestamptz;

comment on column public.subscribers.admin_notes          is 'ملاحظاتٌ خاصّةٌ بإدارة ملبّيك — لا يَراها المشترك.';
comment on column public.subscribers.suspended_at         is 'وقتُ تعليق الحساب — null يعني نشط.';
comment on column public.subscribers.suspended_reason     is 'سببُ التعليق المرئيُّ للمشترك.';
comment on column public.subscribers.trial_extended_until is 'تَمديدُ تَجربةٍ يَدويٌّ من الإدارة (يَفوق trial_ends_at).';

create index if not exists idx_subscribers_suspended on public.subscribers(suspended_at) where suspended_at is null;

-- ─── ٣) جدول audit log ───
create table if not exists public.platform_audit_log (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid references public.profiles(id) on delete set null,
  admin_name    text,
  admin_role    user_role,
  action        text not null,           -- 'extend_trial', 'suspend', 'restore', 'plan_change', 'add_note', 'staff_role_set', 'staff_removed'
  target_type   text,                    -- 'subscriber', 'profile'
  target_id     uuid,
  target_label  text,
  details       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_audit_target on public.platform_audit_log(target_type, target_id, created_at desc);
create index if not exists idx_audit_admin  on public.platform_audit_log(admin_id, created_at desc);
create index if not exists idx_audit_action on public.platform_audit_log(action, created_at desc);

alter table public.platform_audit_log enable row level security;
drop policy if exists "audit admin support read" on public.platform_audit_log;
create policy "audit admin support read"
  on public.platform_audit_log
  for select to authenticated
  using (my_role() in ('admin'::user_role, 'support'::user_role));
-- لا insert policy — RPCs فقط (SECURITY DEFINER) تَكتب.

-- ─── ٤) دالّةٌ مساعِدةٌ للتسجيل ───
create or replace function public._log_admin_action(
  p_action       text,
  p_target_type  text,
  p_target_id    uuid,
  p_target_label text,
  p_details      jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_role user_role;
  v_name text;
begin
  select role, full_name into v_role, v_name from public.profiles where id = auth.uid();
  insert into public.platform_audit_log
    (admin_id, admin_name, admin_role, action, target_type, target_id, target_label, details)
  values
    (auth.uid(), v_name, v_role, p_action, p_target_type, p_target_id, p_target_label, coalesce(p_details, '{}'::jsonb));
end $$;

-- ─── ٥) RPCs للإجراءات الإداريّة ───

-- تَمديدُ التَّجربة (ايّام إضافيّة من اليوم)
create or replace function public.extend_subscriber_trial(
  p_sub    uuid,
  p_days   integer,
  p_reason text default null
) returns timestamptz
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_new timestamptz; v_org text;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  if p_days is null or p_days <= 0 or p_days > 365 then
    raise exception 'invalid-days' using errcode = '22023';
  end if;
  v_new := now() + (p_days || ' days')::interval;
  update public.subscribers set trial_extended_until = v_new where id = p_sub
    returning org_name into v_org;
  if not found then raise exception 'not-found' using errcode = '02000'; end if;
  perform public._log_admin_action(
    'extend_trial', 'subscriber', p_sub, v_org,
    jsonb_build_object('days', p_days, 'until', v_new, 'reason', p_reason)
  );
  return v_new;
end $$;

-- تَعليقُ الحساب
create or replace function public.suspend_subscriber(
  p_sub    uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org text;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  if char_length(coalesce(trim(p_reason),'')) < 5 then
    raise exception 'reason-required' using errcode = '22023';
  end if;
  update public.subscribers
    set suspended_at = now(), suspended_reason = trim(p_reason)
    where id = p_sub
    returning org_name into v_org;
  if not found then raise exception 'not-found' using errcode = '02000'; end if;
  perform public._log_admin_action(
    'suspend', 'subscriber', p_sub, v_org,
    jsonb_build_object('reason', trim(p_reason))
  );
end $$;

-- إعادةُ تَفعيلٍ
create or replace function public.restore_subscriber(
  p_sub uuid
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org text; v_prev_reason text;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  update public.subscribers
    set suspended_at = null, suspended_reason = null
    where id = p_sub
    returning org_name, suspended_reason into v_org, v_prev_reason;
  if not found then raise exception 'not-found' using errcode = '02000'; end if;
  perform public._log_admin_action(
    'restore', 'subscriber', p_sub, v_org,
    jsonb_build_object('prev_reason', v_prev_reason)
  );
end $$;

-- تَغييرُ الباقة (ترقية/إرجاع)
create or replace function public.set_subscriber_plan(
  p_sub    uuid,
  p_plan   plan_type,
  p_reason text default null
) returns plan_type
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org text; v_old plan_type;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  select org_name, plan into v_org, v_old from public.subscribers where id = p_sub;
  if v_org is null then raise exception 'not-found' using errcode = '02000'; end if;
  if v_old = p_plan then
    return v_old;  -- لا تغيير، لا log
  end if;
  update public.subscribers
    set plan = p_plan,
        plan_started_at = case when p_plan = 'paid' then now() else plan_started_at end
    where id = p_sub;
  perform public._log_admin_action(
    'plan_change', 'subscriber', p_sub, v_org,
    jsonb_build_object('from', v_old::text, 'to', p_plan::text, 'reason', p_reason)
  );
  return p_plan;
end $$;

-- إضافة ملاحظةٍ خاصّةٍ
create or replace function public.set_subscriber_admin_note(
  p_sub  uuid,
  p_note text
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org text; v_old text;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  update public.subscribers set admin_notes = nullif(trim(coalesce(p_note,'')), '') where id = p_sub
    returning org_name, admin_notes into v_org, v_old;
  if not found then raise exception 'not-found' using errcode = '02000'; end if;
  perform public._log_admin_action(
    'set_note', 'subscriber', p_sub, v_org,
    jsonb_build_object('length', char_length(coalesce(p_note,'')))
  );
end $$;

-- ─── ٦) إدارةُ فريق المنصّة (admin + support) ───

-- منحُ دورٍ لمستخدمٍ بالبريد (يَنشئُه فقط إن وُجد، إيميل = ملف وُجد بالـauth)
create or replace function public.platform_grant_role(
  p_email text,
  p_role  text   -- 'admin' | 'support'
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_id uuid; v_old user_role; v_role user_role;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'support') then
    raise exception 'invalid-role' using errcode = '22023';
  end if;
  v_role := p_role::user_role;
  -- ابحث في auth.users ثمّ profiles
  select id into v_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_id is null then
    raise exception 'user-not-found' using errcode = '02000',
      hint = 'يَجب أن يُنشئَ المستخدمُ حسابَه أوّلًا على mulabeek.com ثمّ نُمنحه الصلاحيّة.';
  end if;
  select role into v_old from public.profiles where id = v_id;
  update public.profiles set role = v_role where id = v_id;
  perform public._log_admin_action(
    'staff_role_set', 'profile', v_id, p_email,
    jsonb_build_object('from', v_old::text, 'to', v_role::text)
  );
  return v_id;
end $$;

-- نَزعُ دورٍ (إرجاع إلى subscriber)
create or replace function public.platform_revoke_role(
  p_profile uuid
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_old user_role; v_email text;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  if p_profile = auth.uid() then
    raise exception 'cannot-revoke-self' using errcode = '22023',
      hint = 'لا يَجوز للأدمن نَزعُ صلاحيّاتِه — اطلب من أدمنٍ آخرَ ذلك.';
  end if;
  select role into v_old from public.profiles where id = p_profile;
  if v_old not in ('admin'::user_role, 'support'::user_role) then
    raise exception 'not-staff' using errcode = '22023';
  end if;
  select email into v_email from auth.users where id = p_profile;
  update public.profiles set role = 'subscriber'::user_role where id = p_profile;
  perform public._log_admin_action(
    'staff_removed', 'profile', p_profile, v_email,
    jsonb_build_object('from', v_old::text)
  );
end $$;

-- قائمةُ الفريق
create or replace function public.platform_list_staff()
returns table(
  profile_id uuid,
  full_name  text,
  email      text,
  role       user_role,
  created_at timestamptz
)
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if my_role() not in ('admin'::user_role, 'support'::user_role) then
    raise exception 'admin-or-support-only' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, u.email, p.role, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role in ('admin'::user_role, 'support'::user_role)
    order by p.role, p.created_at;
end $$;

-- ─── ٧) إذنُ الـRPCs لـ authenticated ───
revoke all on function public.extend_subscriber_trial(uuid, integer, text) from public, anon;
grant  execute on function public.extend_subscriber_trial(uuid, integer, text) to authenticated;

revoke all on function public.suspend_subscriber(uuid, text) from public, anon;
grant  execute on function public.suspend_subscriber(uuid, text) to authenticated;

revoke all on function public.restore_subscriber(uuid) from public, anon;
grant  execute on function public.restore_subscriber(uuid) to authenticated;

revoke all on function public.set_subscriber_plan(uuid, plan_type, text) from public, anon;
grant  execute on function public.set_subscriber_plan(uuid, plan_type, text) to authenticated;

revoke all on function public.set_subscriber_admin_note(uuid, text) from public, anon;
grant  execute on function public.set_subscriber_admin_note(uuid, text) to authenticated;

revoke all on function public.platform_grant_role(text, text) from public, anon;
grant  execute on function public.platform_grant_role(text, text) to authenticated;

revoke all on function public.platform_revoke_role(uuid) from public, anon;
grant  execute on function public.platform_revoke_role(uuid) to authenticated;

revoke all on function public.platform_list_staff() from public, anon;
grant  execute on function public.platform_list_staff() to authenticated;

revoke all on function public._log_admin_action(text, text, uuid, text, jsonb) from public, anon, authenticated;

-- إعادةُ تحميل schema لـ PostgREST
notify pgrst, 'reload schema';
