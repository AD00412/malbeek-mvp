-- ============================================================
-- ملبّيك · تَصلُّبٌ أَمنيٌّ — submit_staff_invitation v2.1
-- ============================================================
-- يَفترض أنّ APPLY_invitations_v2.sql طُبِّق سابقًا.
-- يُضيف تَحقّقًا: مَساراتُ الوَثائق يَجب أن تَكون ضِمن مُجلَّد
-- المتقدّم (auth.uid()/...) — يُحبط هجومًا يَعرض ملفّاتِ غيره.
-- ============================================================
drop function if exists public.submit_staff_invitation(text, text, text, text, text, text, text, text[], text, date);
create or replace function public.submit_staff_invitation(
  p_token text, p_full_name text, p_phone text, p_message text default null,
  p_national_id text default null, p_id_card_url text default null,
  p_cv_url text default null, p_qual_urls text[] default '{}',
  p_address text default null, p_dob date default null
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_row public.staff_invitations%rowtype;
  v_user_email text;
  v_uid_prefix text;
  v_p text;
begin
  if auth.uid() is null then raise exception 'must-login' using errcode = '42501'; end if;
  v_uid_prefix := auth.uid()::text || '/';
  select * into v_row from public.staff_invitations where token = p_token;
  if v_row is null then raise exception 'invitation-not-found' using errcode = '02000'; end if;
  if v_row.status <> 'pending' then
    raise exception 'invitation-not-pending' using errcode = '22023', hint = v_row.status;
  end if;
  if v_row.expires_at < now() then
    update public.staff_invitations set status = 'expired' where id = v_row.id;
    raise exception 'invitation-expired' using errcode = '22023';
  end if;
  select email into v_user_email from auth.users where id = auth.uid();
  if lower(v_user_email) <> lower(v_row.email) then
    raise exception 'email-mismatch' using errcode = '22023', hint = 'الدعوة لـ' || v_row.email;
  end if;
  if char_length(coalesce(trim(p_full_name),'')) < 2 then raise exception 'name-required' using errcode = '22023'; end if;
  if char_length(coalesce(trim(p_phone),''))     < 8 then raise exception 'phone-required' using errcode = '22023'; end if;
  if char_length(coalesce(trim(p_national_id),''))< 8 then raise exception 'national-id-required' using errcode = '22023'; end if;
  if coalesce(p_id_card_url,'') = '' then raise exception 'id-card-required' using errcode = '22023'; end if;
  if coalesce(p_cv_url,'') = ''      then raise exception 'cv-required' using errcode = '22023'; end if;

  -- ★ تَحقّقٌ أَمنيٌّ: المسارات ضِمن مُجلَّد المتقدّم
  if position(v_uid_prefix in p_id_card_url) <> 1 then
    raise exception 'id-card-path-invalid' using errcode = '42501', hint = 'المسار خارج مُجلّدك.';
  end if;
  if position(v_uid_prefix in p_cv_url) <> 1 then
    raise exception 'cv-path-invalid' using errcode = '42501';
  end if;
  foreach v_p in array coalesce(p_qual_urls, '{}'::text[]) loop
    if position(v_uid_prefix in v_p) <> 1 then
      raise exception 'qual-path-invalid' using errcode = '42501';
    end if;
  end loop;

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

-- إصلاحُ تَعارض أعمدة RETURN في create_staff_invitation
drop function if exists public.create_staff_invitation(text, text);
create or replace function public.create_staff_invitation(
  p_email text, p_role text
) returns table(out_invitation_id uuid, out_token text, out_expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_id uuid; v_token text; v_exp timestamptz; v_role user_role; v_name text;
begin
  if my_role() <> 'admin'::user_role then raise exception 'admin-only' using errcode = '42501'; end if;
  if p_role not in ('admin', 'support') then raise exception 'invalid-role' using errcode = '22023'; end if;
  if coalesce(p_email,'') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid-email' using errcode = '22023'; end if;
  update public.staff_invitations set status='cancelled'
    where lower(email) = lower(trim(p_email)) and status in ('pending','submitted');
  v_role := p_role::user_role;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.staff_invitations (email, invited_role, invited_by, invited_by_name)
  values (lower(trim(p_email)), v_role, auth.uid(), v_name)
  returning id, token, expires_at into v_id, v_token, v_exp;
  perform public._log_admin_action('invite_sent','invitation', v_id, p_email,
    jsonb_build_object('role', p_role));
  out_invitation_id := v_id; out_token := v_token; out_expires_at := v_exp;
  return next;
end $$;
revoke all on function public.create_staff_invitation(text, text) from public, anon;
grant  execute on function public.create_staff_invitation(text, text) to authenticated;

notify pgrst, 'reload schema';
