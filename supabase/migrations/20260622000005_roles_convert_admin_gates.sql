-- تحويل بوّابات إدارة المنصّة من my_role()='admin' / is_staff() إلى has_perm().
-- الأدمن يمرّ دائمًا (has_perm فرعه الأول role='admin') — المالك لا يُقفل.
-- طُبِّق على الإنتاج عبر MCP apply_migration (٣ وحدات: subscribers / billing+trial / feedback+audit RLS).
-- خارج النطاق (تبقى admin-only): دعوات التوظيف، grant/revoke_support_access، platform_grant/revoke_role.
-- ملاحظة: التسويق مملوكٌ للمشترك (can_manage_sub) لا للمنصّة — لا تحويل؛ marketing.manage مفتاحٌ محجوز.

-- ===== subscribers.suspend =====
create or replace function public.suspend_subscriber(p_sub uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare v_org text;
begin
  if not public.has_perm('subscribers.suspend'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  if char_length(coalesce(trim(p_reason),'')) < 5 then raise exception 'reason-required' using errcode='22023'; end if;
  update public.subscribers set suspended_at=now(), suspended_reason=trim(p_reason) where id=p_sub returning org_name into v_org;
  if not found then raise exception 'not-found' using errcode='02000'; end if;
  perform public._log_admin_action('suspend','subscriber',p_sub,v_org, jsonb_build_object('reason', trim(p_reason)));
end $$;

create or replace function public.restore_subscriber(p_sub uuid)
returns void language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare v_org text; v_prev_reason text;
begin
  if not public.has_perm('subscribers.suspend'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  update public.subscribers set suspended_at=null, suspended_reason=null where id=p_sub returning org_name, suspended_reason into v_org, v_prev_reason;
  if not found then raise exception 'not-found' using errcode='02000'; end if;
  perform public._log_admin_action('restore','subscriber',p_sub,v_org, jsonb_build_object('prev_reason', v_prev_reason));
end $$;

-- ===== subscribers.manage =====
create or replace function public.set_subscriber_plan(p_sub uuid, p_plan plan_type, p_reason text default null)
returns plan_type language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare v_org text; v_old plan_type;
begin
  if not public.has_perm('subscribers.manage'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  select org_name, plan into v_org, v_old from public.subscribers where id=p_sub;
  if v_org is null then raise exception 'not-found' using errcode='02000'; end if;
  if v_old = p_plan then return v_old; end if;
  update public.subscribers set plan=p_plan, plan_started_at=case when p_plan='paid' then now() else plan_started_at end where id=p_sub;
  perform public._log_admin_action('plan_change','subscriber',p_sub,v_org, jsonb_build_object('from',v_old::text,'to',p_plan::text,'reason',p_reason));
  return p_plan;
end $$;

create or replace function public.extend_subscriber_trial(p_sub uuid, p_days integer, p_reason text default null)
returns timestamptz language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare v_new timestamptz; v_org text;
begin
  if not public.has_perm('subscribers.manage'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_days is null or p_days <= 0 or p_days > 365 then raise exception 'invalid-days' using errcode='22023'; end if;
  v_new := now() + (p_days || ' days')::interval;
  update public.subscribers set trial_extended_until=v_new where id=p_sub returning org_name into v_org;
  if not found then raise exception 'not-found' using errcode='02000'; end if;
  perform public._log_admin_action('extend_trial','subscriber',p_sub,v_org, jsonb_build_object('days',p_days,'until',v_new,'reason',p_reason));
  return v_new;
end $$;

create or replace function public.set_subscriber_admin_note(p_sub uuid, p_note text)
returns void language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare v_org text; v_old text;
begin
  if not public.has_perm('subscribers.manage'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  update public.subscribers set admin_notes=nullif(trim(coalesce(p_note,'')),'') where id=p_sub returning org_name, admin_notes into v_org, v_old;
  if not found then raise exception 'not-found' using errcode='02000'; end if;
  perform public._log_admin_action('set_note','subscriber',p_sub,v_org, jsonb_build_object('length', char_length(coalesce(p_note,''))));
end $$;

create or replace function public.set_trial_trip_limit(p_sub uuid, p_limit integer, p_reason text default null)
returns integer language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare v_org text; v_old int;
begin
  if not public.has_perm('subscribers.manage'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'invalid-limit' using errcode='22023'; end if;
  select trial_trip_limit, org_name into v_old, v_org from public.subscribers where id=p_sub;
  if not found then raise exception 'not-found' using errcode='02000'; end if;
  update public.subscribers set trial_trip_limit=p_limit where id=p_sub;
  perform public._log_admin_action('set_trip_limit','subscriber',p_sub,v_org, jsonb_build_object('old',v_old,'new',p_limit,'reason',p_reason));
  return p_limit;
end $$;

-- ===== billing.manage (الترقيات) =====
create or replace function public.admin_upgrade_subscriber(p_sub uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare v_org text; v_old plan_type;
begin
  if not public.has_perm('billing.manage'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  select org_name, plan into v_org, v_old from public.subscribers where id=p_sub;
  if v_org is null then raise exception 'not-found' using errcode='02000'; end if;
  if v_old='paid' then raise exception 'already-paid' using errcode='22023', hint='الباقةُ مدفوعةٌ بالفعل.'; end if;
  update public.subscribers set plan='paid', plan_started_at=now() where id=p_sub;
  update public.plan_upgrade_requests set status='approved',
    admin_notes = coalesce(admin_notes,'') || E'\n[تَرقيةٌ يدويّةٌ من الإدارة] ' || coalesce(trim(p_reason),''),
    reviewed_at=now(), reviewed_by=auth.uid()
  where subscriber_id=p_sub and status in ('pending_proof','submitted');
  perform public._log_admin_action('manual_upgrade','subscriber',p_sub,v_org, jsonb_build_object('reason', coalesce(p_reason,'')));
end $$;

create or replace function public.approve_plan_upgrade(p_req uuid, p_notes text default null)
returns void language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare v_row public.plan_upgrade_requests%rowtype; v_sub_name text;
begin
  if not public.has_perm('billing.manage'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_row from public.plan_upgrade_requests where id=p_req;
  if v_row is null then raise exception 'not-found' using errcode='02000'; end if;
  if v_row.status <> 'submitted' then raise exception 'wrong-stage' using errcode='22023', hint=v_row.status; end if;
  update public.subscribers set plan='paid', plan_started_at=now() where id=v_row.subscriber_id returning org_name into v_sub_name;
  update public.plan_upgrade_requests set status='approved', admin_notes=nullif(trim(coalesce(p_notes,'')),''), reviewed_at=now(), reviewed_by=auth.uid() where id=p_req;
  perform public._log_admin_action('upgrade_approved','subscriber',v_row.subscriber_id,v_sub_name, jsonb_build_object('amount',v_row.amount,'req',p_req));
end $$;

create or replace function public.reject_plan_upgrade(p_req uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare v_row public.plan_upgrade_requests%rowtype; v_sub_name text;
begin
  if not public.has_perm('billing.manage'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  if char_length(coalesce(trim(p_reason),'')) < 5 then raise exception 'reason-required' using errcode='22023'; end if;
  select * into v_row from public.plan_upgrade_requests where id=p_req;
  if v_row is null then raise exception 'not-found' using errcode='02000'; end if;
  if v_row.status <> 'submitted' then raise exception 'wrong-stage' using errcode='22023'; end if;
  update public.plan_upgrade_requests set status='rejected', reject_reason=trim(p_reason), reviewed_at=now(), reviewed_by=auth.uid() where id=p_req;
  select org_name into v_sub_name from public.subscribers where id=v_row.subscriber_id;
  perform public._log_admin_action('upgrade_rejected','subscriber',v_row.subscriber_id,v_sub_name, jsonb_build_object('reason', trim(p_reason)));
end $$;

create or replace function public.list_plan_upgrade_requests(p_filter text default 'review')
returns table(id uuid, subscriber_id uuid, org_name text, owner_email text, amount numeric, proof_url text, bank_ref text, applicant_notes text, status text, reject_reason text, admin_notes text, requested_at timestamptz, submitted_at timestamptz, reviewed_at timestamptz)
language plpgsql security definer set search_path to 'public','pg_catalog' as $$
begin
  if not public.has_perm('billing.manage'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  return query
    select r.id::uuid, r.subscriber_id::uuid, s.org_name::text, u.email::text, r.amount::numeric,
           r.proof_url::text, r.bank_ref::text, r.applicant_notes::text, r.status::text, r.reject_reason::text,
           r.admin_notes::text, r.requested_at::timestamptz, r.submitted_at::timestamptz, r.reviewed_at::timestamptz
    from public.plan_upgrade_requests r
    left join public.subscribers s on s.id=r.subscriber_id
    left join auth.users u on u.id=r.requested_by
    where (p_filter='all' or (p_filter='review' and r.status='submitted') or (p_filter='pending' and r.status='pending_proof')
        or (p_filter='approved' and r.status='approved') or (p_filter='rejected' and r.status='rejected'))
    order by case r.status when 'submitted' then 0 when 'pending_proof' then 1 else 2 end, r.requested_at desc
    limit 200;
end $$;

-- ===== feedback.handle / audit.view (RLS — is_staff() ⇒ has_perm) =====
drop policy if exists "feedback admin read" on public.feedback;
create policy "feedback admin read" on public.feedback for select to authenticated
  using (public.has_perm('feedback.handle'::platform_permission));
drop policy if exists "feedback admin update" on public.feedback;
create policy "feedback admin update" on public.feedback for update to authenticated
  using (public.has_perm('feedback.handle'::platform_permission)) with check (public.has_perm('feedback.handle'::platform_permission));

drop policy if exists "pmsg admin read" on public.public_messages;
create policy "pmsg admin read" on public.public_messages for select to authenticated
  using (public.has_perm('feedback.handle'::platform_permission));
drop policy if exists "pmsg admin update" on public.public_messages;
create policy "pmsg admin update" on public.public_messages for update to authenticated
  using (public.has_perm('feedback.handle'::platform_permission)) with check (public.has_perm('feedback.handle'::platform_permission));

drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs for select to authenticated
  using (public.has_perm('audit.view'::platform_permission));
drop policy if exists "audit admin support read" on public.platform_audit_log;
create policy "audit admin support read" on public.platform_audit_log for select to authenticated
  using (public.has_perm('audit.view'::platform_permission));

notify pgrst, 'reload schema';
