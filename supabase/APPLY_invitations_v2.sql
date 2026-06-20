-- ============================================================
-- ملبّيك · نظامُ التَّوظيف v2 — مَرحلتان + وَثائق + مقابلة + نموذج إداريّ
-- ============================================================
-- يَفترض أنّ APPLY_invitations.sql طُبِّق سابقًا (v1).
-- يُضيف:
--   ① أعمدةً للوثائق والهويّة والمقابلة وقَرارات المراحل
--   ② حالاتٍ جديدة: prelim_approved, interview_done, final_approved,
--      onboarded, rejected_documents, rejected_interview
--   ③ ٥ RPCs جديدة لإدارة الانتقالات
--   ④ bucket تخزينٍ خاصّ + سياسات RLS
--   ٥ guard لمنع الدخول لـ/admin قبل active
-- idempotent بالكامل.
-- ============================================================

-- ─── ١) أعمدةٌ جديدة على staff_invitations ───
alter table public.staff_invitations
  add column if not exists national_id           text,
  add column if not exists id_card_url           text,
  add column if not exists cv_url                text,
  add column if not exists qual_urls             text[] default '{}',
  add column if not exists applicant_address     text,
  add column if not exists applicant_dob         date,
  add column if not exists interview_at          timestamptz,
  add column if not exists interview_location    text,
  add column if not exists interview_notes       text,
  add column if not exists prelim_reviewed_at    timestamptz,
  add column if not exists prelim_reviewed_by    uuid references public.profiles(id),
  add column if not exists final_reviewed_at     timestamptz,
  add column if not exists final_reviewed_by     uuid references public.profiles(id),
  add column if not exists rejection_stage       text,
  add column if not exists final_decision_notes  text,
  add column if not exists onboarded_at          timestamptz,
  add column if not exists activated_at          timestamptz,
  add column if not exists activated_by          uuid references public.profiles(id);

-- ─── ٢) تَحديث قيود الحالات ───
alter table public.staff_invitations
  drop constraint if exists staff_invitations_status_check;
alter table public.staff_invitations
  add constraint staff_invitations_status_check
  check (status in (
    'pending',              -- بُعث الإيميل، ينتظر التسجيل
    'submitted',            -- المتقدّم رفع الوثائق + النموذج
    'rejected_documents',   -- رُفض في مرحلة الوثائق
    'prelim_approved',      -- مُوافقةٌ مَبدئيّة، مَوعدُ مقابلةٍ مُحدَّد
    'interview_done',       -- المقابلة جَرت، بانتظار القرار النهائيّ
    'rejected_interview',   -- رُفض بعد المقابلة
    'final_approved',       -- قَبولٌ نهائيّ، يُفتح نموذجُ التَّوظيف الإداريّ
    'onboarded',            -- مَلأ النموذج الإداريّ، بانتظار تَفعيل الأدمن
    'active',               -- الأدمن فعَّل الدور — يَستطيع الدخول
    'expired',
    'cancelled'
  ));

-- ─── ٣) bucket تَخزين خاصّ ───
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-applications', 'staff-applications', false, 5242880,
  array['application/pdf','image/jpeg','image/png','image/jpg']
)
on conflict (id) do update set
  file_size_limit = 5242880,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/jpg'];

-- سياسات storage.objects للـbucket
drop policy if exists "staff-app insert own"  on storage.objects;
drop policy if exists "staff-app select own"  on storage.objects;
drop policy if exists "staff-app select staff" on storage.objects;
drop policy if exists "staff-app delete own"  on storage.objects;

create policy "staff-app insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'staff-applications'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "staff-app select own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'staff-applications'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "staff-app select staff" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'staff-applications'
    and (select my_role()) in ('admin'::user_role, 'support'::user_role)
  );

create policy "staff-app delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'staff-applications'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- ─── ٤) إعادةُ كتابة submit_staff_invitation لتَستقبل الوثائق ───
create or replace function public.submit_staff_invitation(
  p_token        text,
  p_full_name    text,
  p_phone        text,
  p_message      text default null,
  p_national_id  text default null,
  p_id_card_url  text default null,
  p_cv_url       text default null,
  p_qual_urls    text[] default '{}',
  p_address      text default null,
  p_dob          date default null
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype; v_user_email text;
begin
  if auth.uid() is null then
    raise exception 'must-login' using errcode = '42501', hint = 'يَجب تَسجيل الدخول أوّلًا.';
  end if;
  select * into v_row from public.staff_invitations where token = p_token;
  if v_row is null then raise exception 'invitation-not-found' using errcode = '02000'; end if;
  if v_row.status <> 'pending' then
    raise exception 'invitation-not-pending' using errcode = '22023', hint = 'الحالة الحاليّة: ' || v_row.status;
  end if;
  if v_row.expires_at < now() then
    update public.staff_invitations set status = 'expired' where id = v_row.id;
    raise exception 'invitation-expired' using errcode = '22023';
  end if;
  select email into v_user_email from auth.users where id = auth.uid();
  if lower(v_user_email) <> lower(v_row.email) then
    raise exception 'email-mismatch' using errcode = '22023',
      hint = 'الدعوة لـ' || v_row.email || ' — سجّل دخولك بهذا الإيميل.';
  end if;

  if char_length(coalesce(trim(p_full_name),'')) < 2 then raise exception 'name-required' using errcode = '22023'; end if;
  if char_length(coalesce(trim(p_phone),''))     < 8 then raise exception 'phone-required' using errcode = '22023'; end if;
  if char_length(coalesce(trim(p_national_id),''))< 8 then raise exception 'national-id-required' using errcode = '22023'; end if;
  if coalesce(p_id_card_url,'') = ''                 then raise exception 'id-card-required' using errcode = '22023'; end if;
  if coalesce(p_cv_url,'') = ''                      then raise exception 'cv-required' using errcode = '22023'; end if;

  update public.staff_invitations set
    applicant_profile_id = auth.uid(),
    applicant_full_name  = trim(p_full_name),
    applicant_phone      = trim(p_phone),
    applicant_message    = nullif(trim(coalesce(p_message,'')), ''),
    applicant_address    = nullif(trim(coalesce(p_address,'')), ''),
    applicant_dob        = p_dob,
    national_id          = trim(p_national_id),
    id_card_url          = p_id_card_url,
    cv_url               = p_cv_url,
    qual_urls            = coalesce(p_qual_urls, '{}'),
    status               = 'submitted',
    submitted_at         = now()
  where id = v_row.id;

  insert into public.notifications(profile_id, audience, kind, title, body)
  select id, 'admin', 'new_subscriber',
         'طلبُ توظيفٍ مَرفوعٌ للمراجعة',
         trim(p_full_name) || ' (' || v_row.email || ') — ' || v_row.invited_role::text
  from public.profiles where role = 'admin'::user_role;

  return v_row.id;
end $$;
revoke all on function public.submit_staff_invitation(text, text, text, text, text, text, text, text[], text, date) from public, anon;
grant  execute on function public.submit_staff_invitation(text, text, text, text, text, text, text, text[], text, date) to authenticated;

-- ─── ٥) RPC: مُوافقةٌ مَبدئيّة + تَحديد موعد مقابلة ───
create or replace function public.preliminary_approve_invitation(
  p_invitation uuid,
  p_interview_at timestamptz,
  p_location text default null,
  p_notes text default null
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype;
begin
  if my_role() <> 'admin'::user_role then raise exception 'admin-only' using errcode = '42501'; end if;
  if p_interview_at is null or p_interview_at < now() then
    raise exception 'interview-time-invalid' using errcode = '22023', hint = 'حدّد وقتًا مُستقبليًّا للمقابلة.';
  end if;
  select * into v_row from public.staff_invitations where id = p_invitation;
  if v_row is null then raise exception 'not-found' using errcode = '02000'; end if;
  if v_row.status <> 'submitted' then
    raise exception 'wrong-stage' using errcode = '22023', hint = 'الحالة الحاليّة: ' || v_row.status;
  end if;
  update public.staff_invitations set
    status              = 'prelim_approved',
    interview_at        = p_interview_at,
    interview_location  = nullif(trim(coalesce(p_location,'')), ''),
    interview_notes     = nullif(trim(coalesce(p_notes,'')), ''),
    prelim_reviewed_at  = now(),
    prelim_reviewed_by  = auth.uid()
  where id = p_invitation;
  perform public._log_admin_action('invite_prelim_ok', 'invitation', p_invitation, v_row.email,
    jsonb_build_object('interview_at', p_interview_at, 'location', p_location));
end $$;
revoke all on function public.preliminary_approve_invitation(uuid, timestamptz, text, text) from public, anon;
grant  execute on function public.preliminary_approve_invitation(uuid, timestamptz, text, text) to authenticated;

-- ─── ٦) RPC: تَعليم انتهاء المقابلة ───
create or replace function public.mark_interview_done(p_invitation uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype;
begin
  if my_role() <> 'admin'::user_role then raise exception 'admin-only' using errcode = '42501'; end if;
  select * into v_row from public.staff_invitations where id = p_invitation;
  if v_row is null then raise exception 'not-found' using errcode = '02000'; end if;
  if v_row.status <> 'prelim_approved' then
    raise exception 'wrong-stage' using errcode = '22023', hint = 'الحالة الحاليّة: ' || v_row.status;
  end if;
  update public.staff_invitations set status = 'interview_done' where id = p_invitation;
  perform public._log_admin_action('invite_interview_done', 'invitation', p_invitation, v_row.email, '{}'::jsonb);
end $$;
revoke all on function public.mark_interview_done(uuid) from public, anon;
grant  execute on function public.mark_interview_done(uuid) to authenticated;

-- ─── ٧) RPC: قَبولٌ نهائيٌّ (فتحُ نموذج التَّوظيف الإداريّ) ───
create or replace function public.final_approve_invitation(
  p_invitation uuid,
  p_notes text default null
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype;
begin
  if my_role() <> 'admin'::user_role then raise exception 'admin-only' using errcode = '42501'; end if;
  select * into v_row from public.staff_invitations where id = p_invitation;
  if v_row is null then raise exception 'not-found' using errcode = '02000'; end if;
  if v_row.status not in ('interview_done', 'prelim_approved') then
    raise exception 'wrong-stage' using errcode = '22023', hint = 'الحالة الحاليّة: ' || v_row.status;
  end if;
  update public.staff_invitations set
    status               = 'final_approved',
    final_reviewed_at    = now(),
    final_reviewed_by    = auth.uid(),
    final_decision_notes = nullif(trim(coalesce(p_notes,'')), '')
  where id = p_invitation;
  perform public._log_admin_action('invite_final_ok', 'invitation', p_invitation, v_row.email,
    jsonb_build_object('notes', p_notes));
end $$;
revoke all on function public.final_approve_invitation(uuid, text) from public, anon;
grant  execute on function public.final_approve_invitation(uuid, text) to authenticated;

-- ─── ٨) RPC: رفضٌ مع تَحديد المرحلة ───
drop function if exists public.reject_staff_invitation(uuid, text);
create or replace function public.reject_staff_invitation(
  p_invitation uuid,
  p_reason text,
  p_stage text default null
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype; v_new_status text;
begin
  if my_role() <> 'admin'::user_role then raise exception 'admin-only' using errcode = '42501'; end if;
  if char_length(coalesce(trim(p_reason),'')) < 5 then raise exception 'reason-required' using errcode = '22023'; end if;
  select * into v_row from public.staff_invitations where id = p_invitation;
  if v_row is null then raise exception 'not-found' using errcode = '02000'; end if;
  v_new_status := case v_row.status
    when 'submitted'       then 'rejected_documents'
    when 'prelim_approved' then 'rejected_interview'
    when 'interview_done'  then 'rejected_interview'
    else null end;
  if v_new_status is null then
    raise exception 'cannot-reject' using errcode = '22023', hint = 'الحالة الحاليّة: ' || v_row.status;
  end if;
  update public.staff_invitations set
    status           = v_new_status,
    reject_reason    = trim(p_reason),
    rejection_stage  = case v_row.status when 'submitted' then 'docs' else 'interview' end,
    final_reviewed_at= now(),
    final_reviewed_by= auth.uid()
  where id = p_invitation;
  perform public._log_admin_action('invite_rejected', 'invitation', p_invitation, v_row.email,
    jsonb_build_object('reason', trim(p_reason), 'stage', case v_row.status when 'submitted' then 'docs' else 'interview' end));
end $$;
revoke all on function public.reject_staff_invitation(uuid, text, text) from public, anon;
grant  execute on function public.reject_staff_invitation(uuid, text, text) to authenticated;

-- ─── ٩) RPC: إكمالُ نموذج التَّوظيف الإداريّ (الموظَّف) ───
create or replace function public.complete_invitation_onboarding(
  p_token text,
  p_emergency_contact text,
  p_bank_iban text default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'must-login' using errcode = '42501'; end if;
  select * into v_row from public.staff_invitations where token = p_token;
  if v_row is null then raise exception 'not-found' using errcode = '02000'; end if;
  if v_row.applicant_profile_id <> auth.uid() then raise exception 'not-applicant' using errcode = '42501'; end if;
  if v_row.status <> 'final_approved' then
    raise exception 'wrong-stage' using errcode = '22023', hint = 'الحالة الحاليّة: ' || v_row.status;
  end if;
  if char_length(coalesce(trim(p_emergency_contact),'')) < 5 then
    raise exception 'emergency-contact-required' using errcode = '22023';
  end if;
  update public.staff_invitations set
    status        = 'onboarded',
    onboarded_at  = now(),
    final_decision_notes = coalesce(final_decision_notes,'') ||
      E'\n— onboarding —\n' ||
      'emergency: ' || trim(p_emergency_contact) ||
      coalesce(E'\niban: ' || trim(p_bank_iban), '') ||
      coalesce(E'\nnotes: ' || trim(p_notes), '')
  where id = v_row.id;

  insert into public.notifications(profile_id, audience, kind, title, body)
  select id, 'admin', 'new_subscriber',
         'موظّفٌ أَكمل نموذجَ التَّوظيف',
         v_row.applicant_full_name || ' — جاهزٌ للتَّفعيل'
  from public.profiles where role = 'admin'::user_role;

  return v_row.id;
end $$;
revoke all on function public.complete_invitation_onboarding(text, text, text, text) from public, anon;
grant  execute on function public.complete_invitation_onboarding(text, text, text, text) to authenticated;

-- ─── ١٠) RPC: تَفعيلٌ نهائيٌّ (يَمنح الدور) ───
create or replace function public.activate_staff_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype;
begin
  if my_role() <> 'admin'::user_role then raise exception 'admin-only' using errcode = '42501'; end if;
  select * into v_row from public.staff_invitations where id = p_invitation;
  if v_row is null then raise exception 'not-found' using errcode = '02000'; end if;
  if v_row.status <> 'onboarded' then
    raise exception 'wrong-stage' using errcode = '22023', hint = 'الحالة الحاليّة: ' || v_row.status;
  end if;
  if v_row.applicant_profile_id is null then
    raise exception 'no-applicant-profile' using errcode = '22023';
  end if;
  update public.profiles set role = v_row.invited_role where id = v_row.applicant_profile_id;
  update public.staff_invitations set
    status        = 'active',
    activated_at  = now(),
    activated_by  = auth.uid()
  where id = p_invitation;
  perform public._log_admin_action('invite_activated', 'invitation', p_invitation, v_row.email,
    jsonb_build_object('role', v_row.invited_role::text));
end $$;
revoke all on function public.activate_staff_invitation(uuid) from public, anon;
grant  execute on function public.activate_staff_invitation(uuid) to authenticated;

-- ─── ١١) إعادةُ كتابة get_invitation_info لإرجاع كلّ التفاصيل اللازمة للواجهة ───
drop function if exists public.get_invitation_info(text);
create or replace function public.get_invitation_info(p_token text)
returns table(
  invitation_id    uuid,
  email            text,
  invited_role     text,
  invited_by_name  text,
  status           text,
  is_valid         boolean,
  expires_at       timestamptz,
  interview_at     timestamptz,
  interview_location text,
  interview_notes  text,
  reject_reason    text,
  rejection_stage  text,
  applicant_full_name text
)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype;
begin
  select * into v_row from public.staff_invitations where token = p_token;
  if v_row is null then
    return query select null::uuid, null::text, null::text, null::text, 'not_found'::text,
      false, null::timestamptz, null::timestamptz, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  return query
    select v_row.id, v_row.email, v_row.invited_role::text, v_row.invited_by_name,
           v_row.status,
           (v_row.status in ('pending','prelim_approved','interview_done','final_approved')
             and v_row.expires_at > now()),
           v_row.expires_at,
           v_row.interview_at, v_row.interview_location, v_row.interview_notes,
           v_row.reject_reason, v_row.rejection_stage, v_row.applicant_full_name;
end $$;
revoke all on function public.get_invitation_info(text) from public;
grant  execute on function public.get_invitation_info(text) to anon, authenticated;

-- ─── ١٢) إعادةُ كتابة list_staff_invitations مع كلّ الحقول للأدمن ───
drop function if exists public.list_staff_invitations(text);
create or replace function public.list_staff_invitations(p_filter text default 'all')
returns table(
  id                    uuid,
  email                 text,
  invited_role          text,
  invited_by_name       text,
  applicant_full_name   text,
  applicant_phone       text,
  applicant_message     text,
  applicant_address     text,
  national_id           text,
  id_card_url           text,
  cv_url                text,
  qual_urls             text[],
  interview_at          timestamptz,
  interview_location    text,
  interview_notes       text,
  status                text,
  reject_reason         text,
  rejection_stage       text,
  final_decision_notes  text,
  created_at            timestamptz,
  submitted_at          timestamptz,
  prelim_reviewed_at    timestamptz,
  final_reviewed_at     timestamptz,
  onboarded_at          timestamptz,
  activated_at          timestamptz,
  expires_at            timestamptz
)
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if my_role() not in ('admin'::user_role, 'support'::user_role) then
    raise exception 'admin-or-support-only' using errcode = '42501';
  end if;
  return query
    select i.id, i.email, i.invited_role::text, i.invited_by_name,
           i.applicant_full_name, i.applicant_phone, i.applicant_message, i.applicant_address,
           i.national_id, i.id_card_url, i.cv_url, i.qual_urls,
           i.interview_at, i.interview_location, i.interview_notes,
           i.status, i.reject_reason, i.rejection_stage, i.final_decision_notes,
           i.created_at, i.submitted_at, i.prelim_reviewed_at, i.final_reviewed_at,
           i.onboarded_at, i.activated_at, i.expires_at
    from public.staff_invitations i
    where (p_filter = 'all'
      or  (p_filter = 'review'   and i.status in ('submitted','interview_done','onboarded'))
      or  (p_filter = 'pending'  and i.status = 'pending')
      or  (p_filter = 'active'   and i.status = 'active')
      or  (p_filter = 'rejected' and i.status in ('rejected_documents','rejected_interview')))
    order by
      case i.status
        when 'submitted'       then 0
        when 'interview_done'  then 1
        when 'onboarded'       then 2
        when 'prelim_approved' then 3
        when 'pending'         then 4
        else 5 end,
      i.created_at desc
    limit 200;
end $$;
revoke all on function public.list_staff_invitations(text) from public, anon;
grant  execute on function public.list_staff_invitations(text) to authenticated;

-- ─── ١٣) RPC: signed URL لمستندات المتقدّم (admin/support فقط) ───
create or replace function public.get_invitation_doc_url(p_invitation uuid, p_path text)
returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.staff_invitations%rowtype; v_valid boolean := false;
begin
  if my_role() not in ('admin'::user_role, 'support'::user_role) then
    raise exception 'admin-or-support-only' using errcode = '42501';
  end if;
  select * into v_row from public.staff_invitations where id = p_invitation;
  if v_row is null then raise exception 'not-found' using errcode = '02000'; end if;
  if p_path = v_row.id_card_url or p_path = v_row.cv_url or p_path = any(v_row.qual_urls) then
    v_valid := true;
  end if;
  if not v_valid then raise exception 'path-not-linked' using errcode = '22023'; end if;
  -- الواجهة ستُولّد signed URL بنفسها عبر storage.from(...).createSignedUrl
  -- هذه الدالّة فقط تَتحقّق من الصلاحيّة وتُرجع المسار الصافي
  return p_path;
end $$;
revoke all on function public.get_invitation_doc_url(uuid, text) from public, anon;
grant  execute on function public.get_invitation_doc_url(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- ─── تحقّق ───
select 'submit_staff_invitation v2 (with docs)' as item,
       case when exists(
         select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='submit_staff_invitation'
           and pg_get_function_identity_arguments(p.oid) like '%national_id%'
       ) then 'OK ✓' else 'MISSING ✗' end as status
union all
select 'new statuses',
       case when exists(
         select 1 from information_schema.check_constraints
         where constraint_name='staff_invitations_status_check'
           and check_clause like '%prelim_approved%'
       ) then 'OK ✓' else 'MISSING ✗' end
union all
select 'staff-applications bucket',
       case when exists(select 1 from storage.buckets where id='staff-applications') then 'OK ✓' else 'MISSING ✗' end
union all
select 'new RPCs',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in (
          'preliminary_approve_invitation','mark_interview_done','final_approve_invitation',
          'complete_invitation_onboarding','activate_staff_invitation','get_invitation_doc_url'
        )) || ' / 6';
