-- إشعارات الترقية للأدمن كانت kind='new_subscriber' ⇒ deep-link /admin?go=subs خطأ.
-- الصحيح 'upgrade_request' ⇒ /admin?go=upgrades. (التغيير الوحيد هو قيمة kind.)
-- request_plan_upgrade + submit_plan_upgrade — انظر تعريفيهما الكاملين المطبَّقين عبر apply_migration.
create or replace function public.request_plan_upgrade()
 returns uuid language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $function$
declare v_sub uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'must-login' using errcode = '42501'; end if;
  select id into v_sub from public.subscribers where owner_id = auth.uid() limit 1;
  if v_sub is null then raise exception 'no-subscriber' using errcode = '02000', hint = 'لا توجد حملةٌ مَربوطةٌ بحسابك.'; end if;
  select id into v_id from public.plan_upgrade_requests where subscriber_id = v_sub and status in ('pending_proof','submitted') limit 1;
  if v_id is not null then return v_id; end if;
  if exists(select 1 from public.subscribers where id = v_sub and plan = 'paid') then
    raise exception 'already-paid' using errcode = '22023', hint = 'الباقةُ مدفوعةٌ بالفعل.';
  end if;
  insert into public.plan_upgrade_requests (subscriber_id, requested_by, amount) values (v_sub, auth.uid(), 99) returning id into v_id;
  insert into public.notifications(profile_id, audience, kind, title, body)
  select id, 'admin', 'upgrade_request', 'طلبُ ترقيةٍ جديد',
         (select org_name from public.subscribers where id = v_sub) || ' — بانتظار رفع إثبات الدفع'
  from public.profiles where role = 'admin'::user_role;
  return v_id;
end $function$;

create or replace function public.submit_plan_upgrade(p_req uuid, p_proof_url text, p_bank_ref text default null::text, p_notes text default null::text)
 returns void language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $function$
declare v_row public.plan_upgrade_requests%rowtype; v_uid_prefix text;
begin
  if auth.uid() is null then raise exception 'must-login' using errcode = '42501'; end if;
  v_uid_prefix := auth.uid()::text || '/';
  select * into v_row from public.plan_upgrade_requests where id = p_req;
  if v_row is null then raise exception 'not-found' using errcode = '02000'; end if;
  if v_row.requested_by <> auth.uid() then raise exception 'not-owner' using errcode = '42501'; end if;
  if v_row.status <> 'pending_proof' then raise exception 'wrong-stage' using errcode = '22023', hint = 'الحالة الحاليّة: ' || v_row.status; end if;
  if coalesce(p_proof_url,'') = '' then raise exception 'proof-required' using errcode = '22023'; end if;
  if position(v_uid_prefix in p_proof_url) <> 1 then raise exception 'proof-path-invalid' using errcode = '42501', hint = 'المسار خارج مُجلّدك.'; end if;
  update public.plan_upgrade_requests set
    proof_url = p_proof_url, bank_ref = nullif(trim(coalesce(p_bank_ref,'')), ''),
    applicant_notes = nullif(trim(coalesce(p_notes,'')), ''), status = 'submitted', submitted_at = now()
  where id = p_req;
  insert into public.notifications(profile_id, audience, kind, title, body)
  select id, 'admin', 'upgrade_request', 'إثباتُ دفعٍ مَرفوع — طلبُ ترقية',
         (select org_name from public.subscribers where id = v_row.subscriber_id)
  from public.profiles where role = 'admin'::user_role;
end $function$;
