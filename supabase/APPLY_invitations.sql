-- ============================================================
-- ملبّيك · نظام دعوة الفريق + إصلاح platform_list_staff
-- ============================================================
--
-- ١) إصلاحُ خطأ "structure of query does not match function result type":
--    يَحدث لأنّ تواقيعَ user_role القديمةَ مَخزّنةٌ في pg_proc بعد إضافة
--    'support'. الحلّ: drop + recreate صراحةً.
--
-- ٢) جدول staff_invitations + RPCs لنظام الدعوة:
--    - الأدمن يَبعث دعوة (email + role)
--    - يُرسَل بريدٌ بـtoken
--    - الموظّف يَفتح الرابط، يُسجّل حسابًا (أو يُسجّل دخوله)، يَملأ بيانات
--      المؤهّلات (الاسم الكامل، الجوّال، رسالة تَعريفيّة)
--    - الأدمن يَراجع → يُوافق → يُمنح الدور
--
-- idempotent بالكامل.
-- ============================================================

-- ─── ١) إصلاحُ platform_list_staff ───
drop function if exists public.platform_list_staff();
create or replace function public.platform_list_staff()
returns table(
  profile_id uuid,
  full_name  text,
  email      text,
  role       text,        -- ★ text بدل user_role لتجنّب signature mismatch
  created_at timestamptz
)
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if my_role() not in ('admin'::user_role, 'support'::user_role) then
    raise exception 'admin-or-support-only' using errcode = '42501';
  end if;
  return query
    select p.id::uuid,
           p.full_name::text,
           u.email::text,
           p.role::text,
           p.created_at::timestamptz
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role in ('admin'::user_role, 'support'::user_role)
    order by p.role, p.created_at;
end $$;
revoke all on function public.platform_list_staff() from public, anon;
grant  execute on function public.platform_list_staff() to authenticated;

-- ─── ٢) جدول الدعوات ───
create table if not exists public.staff_invitations (
  id                    uuid primary key default gen_random_uuid(),
  email                 text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  invited_role          user_role not null check (invited_role in ('admin'::user_role, 'support'::user_role)),
  invited_by            uuid references public.profiles(id),
  invited_by_name       text,
  token                 text not null unique default encode(gen_random_bytes(24), 'hex'),
  -- ما يَملؤه الموظّف:
  applicant_profile_id  uuid references public.profiles(id),
  applicant_full_name   text,
  applicant_phone       text,
  applicant_message     text,
  -- حالة الدعوة:
  status                text not null default 'pending' check (status in (
    'pending',         -- بُعث الإيميل، ينتظر تَسجيلَ الدخول والـRSVP
    'submitted',       -- المتقدّم رفع بياناتِه، ينتظر مراجعةَ الإدارة
    'approved',        -- وُوفق وأُسند الدور
    'rejected',        -- رُفض
    'expired',         -- انتهت الصلاحيّة
    'cancelled'        -- ألغاها الأدمن قبل التَّسجيل
  )),
  reject_reason         text,
  expires_at            timestamptz not null default (now() + interval '14 days'),
  created_at            timestamptz not null default now(),
  submitted_at          timestamptz,
  reviewed_at           timestamptz,
  reviewed_by           uuid references public.profiles(id)
);
create index if not exists idx_staff_invites_status  on public.staff_invitations(status, created_at desc);
create index if not exists idx_staff_invites_email   on public.staff_invitations(lower(email));
create index if not exists idx_staff_invites_token   on public.staff_invitations(token);

alter table public.staff_invitations enable row level security;
-- لا أحدَ يقرأ مباشرةً — RPCs فقط
drop policy if exists "invites read" on public.staff_invitations;

-- ─── ٣) RPC: إنشاء دعوة (admin) ───
create or replace function public.create_staff_invitation(
  p_email text,
  p_role  text   -- 'admin' | 'support'
) returns table(invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_id uuid; v_token text; v_exp timestamptz; v_role user_role; v_name text;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'support') then
    raise exception 'invalid-role' using errcode = '22023';
  end if;
  if coalesce(p_email,'') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid-email' using errcode = '22023';
  end if;
  -- ألغِ أيَّ دعوةٍ سابقةٍ pending لنفس الإيميل
  update public.staff_invitations
    set status = 'cancelled'
    where lower(email) = lower(trim(p_email))
      and status in ('pending', 'submitted');
  v_role := p_role::user_role;
  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.staff_invitations (email, invited_role, invited_by, invited_by_name)
  values (lower(trim(p_email)), v_role, auth.uid(), v_name)
  returning id, token, expires_at into v_id, v_token, v_exp;

  perform public._log_admin_action('invite_sent', 'invitation', v_id, p_email,
    jsonb_build_object('role', p_role));

  return query select v_id, v_token, v_exp;
end $$;
revoke all on function public.create_staff_invitation(text, text) from public, anon;
grant  execute on function public.create_staff_invitation(text, text) to authenticated;

-- ─── ٤) RPC: قراءةُ دعوةٍ بالـtoken (anon — للصفحة العامّة) ───
create or replace function public.get_invitation_info(p_token text)
returns table(
  invitation_id uuid,
  email         text,
  invited_role  text,
  invited_by_name text,
  status        text,
  is_valid      boolean,
  expires_at    timestamptz
)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype;
begin
  select * into v_row from public.staff_invitations where token = p_token;
  if v_row is null then
    return query select null::uuid, null::text, null::text, null::text, 'not_found'::text, false, null::timestamptz;
    return;
  end if;
  return query
    select v_row.id, v_row.email, v_row.invited_role::text, v_row.invited_by_name,
           v_row.status,
           (v_row.status = 'pending' and v_row.expires_at > now()),
           v_row.expires_at;
end $$;
revoke all on function public.get_invitation_info(text) from public;
grant  execute on function public.get_invitation_info(text) to anon, authenticated;

-- ─── ٥) RPC: رفعُ بيانات المُتقدّم (مستخدمٌ مسجَّلٌ دخوله) ───
create or replace function public.submit_staff_invitation(
  p_token   text,
  p_full_name text,
  p_phone   text,
  p_message text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype; v_user_email text;
begin
  if auth.uid() is null then
    raise exception 'must-login' using errcode = '42501',
      hint = 'يَجب تَسجيل الدخول أوّلًا.';
  end if;
  select * into v_row from public.staff_invitations where token = p_token;
  if v_row is null then raise exception 'invitation-not-found' using errcode = '02000'; end if;
  if v_row.status <> 'pending' then
    raise exception 'invitation-not-pending' using errcode = '22023',
      hint = 'الحالة الحاليّة: ' || v_row.status;
  end if;
  if v_row.expires_at < now() then
    update public.staff_invitations set status = 'expired' where id = v_row.id;
    raise exception 'invitation-expired' using errcode = '22023';
  end if;

  -- يَجب أن يَتطابق إيميل المستخدم مع إيميل الدعوة
  select email into v_user_email from auth.users where id = auth.uid();
  if lower(v_user_email) <> lower(v_row.email) then
    raise exception 'email-mismatch' using errcode = '22023',
      hint = 'الدعوة لـ' || v_row.email || ' — سجّل دخولك بهذا الإيميل.';
  end if;

  if char_length(coalesce(trim(p_full_name),'')) < 2 then
    raise exception 'name-required' using errcode = '22023';
  end if;
  if char_length(coalesce(trim(p_phone),'')) < 8 then
    raise exception 'phone-required' using errcode = '22023';
  end if;

  update public.staff_invitations set
    applicant_profile_id = auth.uid(),
    applicant_full_name = trim(p_full_name),
    applicant_phone = trim(p_phone),
    applicant_message = nullif(trim(coalesce(p_message,'')), ''),
    status = 'submitted',
    submitted_at = now()
  where id = v_row.id;

  -- أَنشئ إشعارًا للأدمن
  insert into public.notifications(profile_id, audience, kind, title, body)
  select id, 'admin', 'new_subscriber',
         'دعوةٌ مَرفوعةٌ للمراجعة',
         trim(p_full_name) || ' (' || v_row.email || ') — ' || v_row.invited_role::text
  from public.profiles where role = 'admin'::user_role;

  return v_row.id;
end $$;
revoke all on function public.submit_staff_invitation(text, text, text, text) from public, anon;
grant  execute on function public.submit_staff_invitation(text, text, text, text) to authenticated;

-- ─── ٦) RPC: الموافقة (admin) ───
create or replace function public.approve_staff_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  select * into v_row from public.staff_invitations where id = p_invitation;
  if v_row is null then raise exception 'not-found' using errcode = '02000'; end if;
  if v_row.status <> 'submitted' then
    raise exception 'not-submitted' using errcode = '22023',
      hint = 'الحالة الحاليّة: ' || v_row.status;
  end if;
  if v_row.applicant_profile_id is null then
    raise exception 'no-applicant-profile' using errcode = '22023';
  end if;
  -- أَسنِد الدور
  update public.profiles set role = v_row.invited_role where id = v_row.applicant_profile_id;
  update public.staff_invitations set
    status = 'approved',
    reviewed_at = now(),
    reviewed_by = auth.uid()
  where id = p_invitation;
  perform public._log_admin_action('invite_approved', 'invitation', p_invitation, v_row.email,
    jsonb_build_object('role', v_row.invited_role::text, 'applicant', v_row.applicant_full_name));
end $$;
revoke all on function public.approve_staff_invitation(uuid) from public, anon;
grant  execute on function public.approve_staff_invitation(uuid) to authenticated;

-- ─── ٧) RPC: الرفض (admin) ───
create or replace function public.reject_staff_invitation(p_invitation uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  if char_length(coalesce(trim(p_reason),'')) < 5 then
    raise exception 'reason-required' using errcode = '22023';
  end if;
  select * into v_row from public.staff_invitations where id = p_invitation;
  if v_row is null then raise exception 'not-found' using errcode = '02000'; end if;
  if v_row.status <> 'submitted' then
    raise exception 'not-submitted' using errcode = '22023';
  end if;
  update public.staff_invitations set
    status = 'rejected',
    reject_reason = trim(p_reason),
    reviewed_at = now(),
    reviewed_by = auth.uid()
  where id = p_invitation;
  perform public._log_admin_action('invite_rejected', 'invitation', p_invitation, v_row.email,
    jsonb_build_object('reason', trim(p_reason)));
end $$;
revoke all on function public.reject_staff_invitation(uuid, text) from public, anon;
grant  execute on function public.reject_staff_invitation(uuid, text) to authenticated;

-- ─── ٨) RPC: قائمةُ الدعوات (admin + support) ───
create or replace function public.list_staff_invitations(p_filter text default 'all')
returns table(
  id                    uuid,
  email                 text,
  invited_role          text,
  invited_by_name       text,
  applicant_full_name   text,
  applicant_phone       text,
  applicant_message     text,
  status                text,
  reject_reason         text,
  created_at            timestamptz,
  submitted_at          timestamptz,
  expires_at            timestamptz
)
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if my_role() not in ('admin'::user_role, 'support'::user_role) then
    raise exception 'admin-or-support-only' using errcode = '42501';
  end if;
  return query
    select i.id, i.email, i.invited_role::text, i.invited_by_name,
           i.applicant_full_name, i.applicant_phone, i.applicant_message,
           i.status, i.reject_reason, i.created_at, i.submitted_at, i.expires_at
    from public.staff_invitations i
    where (p_filter = 'all'
      or  (p_filter = 'pending'   and i.status = 'pending')
      or  (p_filter = 'submitted' and i.status = 'submitted')
      or  (p_filter = 'approved'  and i.status = 'approved')
      or  (p_filter = 'rejected'  and i.status = 'rejected'))
    order by
      case i.status when 'submitted' then 0 when 'pending' then 1 else 2 end,
      i.created_at desc
    limit 100;
end $$;
revoke all on function public.list_staff_invitations(text) from public, anon;
grant  execute on function public.list_staff_invitations(text) to authenticated;

-- ─── ٩) RPC: إلغاء دعوة معلَّقة (admin) ───
create or replace function public.cancel_staff_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype;
begin
  if my_role() <> 'admin'::user_role then raise exception 'admin-only' using errcode = '42501'; end if;
  select * into v_row from public.staff_invitations where id = p_invitation;
  if v_row is null then raise exception 'not-found' using errcode = '02000'; end if;
  if v_row.status not in ('pending', 'submitted') then
    raise exception 'cannot-cancel' using errcode = '22023';
  end if;
  update public.staff_invitations set status = 'cancelled', reviewed_at = now(), reviewed_by = auth.uid()
    where id = p_invitation;
  perform public._log_admin_action('invite_cancelled', 'invitation', p_invitation, v_row.email, '{}'::jsonb);
end $$;
revoke all on function public.cancel_staff_invitation(uuid) from public, anon;
grant  execute on function public.cancel_staff_invitation(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ─── تحقّق ───
select 'platform_list_staff' as item,
       case when exists(select 1 from pg_proc where proname = 'platform_list_staff') then 'OK ✓' else 'MISSING ✗' end as status
union all
select 'staff_invitations table',
       case when to_regclass('public.staff_invitations') is not null then 'OK ✓' else 'MISSING ✗' end
union all
select 'invitation RPCs (6)',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in (
          'create_staff_invitation','get_invitation_info','submit_staff_invitation',
          'approve_staff_invitation','reject_staff_invitation','list_staff_invitations'
        )) || ' / 6';
