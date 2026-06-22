-- RPCs إدارة الرتب/الصلاحيات — حصرية لـ has_perm('staff.manage') (الأدمن دائمًا).
-- طُبِّق على الإنتاج عبر MCP apply_migration (platform_roles_management_rpcs).

create or replace function public.grant_staff_permission(p_profile uuid, p_key platform_permission)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_name text; v_role user_role;
begin
  if not public.has_perm('staff.manage'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_key = 'staff.manage'::platform_permission then
    raise exception 'staff-manage-reserved' using errcode='42501', hint='صلاحيةُ staff.manage حصريّةٌ للمالك.'; end if;
  select full_name, role into v_name, v_role from public.profiles where id=p_profile;
  if v_role is null then raise exception 'not-found' using errcode='02000'; end if;
  insert into public.staff_permissions(profile_id, permission, granted_by)
    values (p_profile, p_key, auth.uid()) on conflict (profile_id, permission) do nothing;
  perform public._log_admin_action('grant_staff_permission','profile',p_profile,v_name, jsonb_build_object('permission',p_key));
end $$;
revoke all on function public.grant_staff_permission(uuid, platform_permission) from public, anon;
grant  execute on function public.grant_staff_permission(uuid, platform_permission) to authenticated;

create or replace function public.revoke_staff_permission(p_profile uuid, p_key platform_permission)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_name text;
begin
  if not public.has_perm('staff.manage'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  select full_name into v_name from public.profiles where id=p_profile;
  delete from public.staff_permissions where profile_id=p_profile and permission=p_key;
  perform public._log_admin_action('revoke_staff_permission','profile',p_profile,v_name, jsonb_build_object('permission',p_key));
end $$;
revoke all on function public.revoke_staff_permission(uuid, platform_permission) from public, anon;
grant  execute on function public.revoke_staff_permission(uuid, platform_permission) to authenticated;

create or replace function public.set_staff_rank(p_profile uuid, p_rank text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_perms platform_permission[]; v_role user_role; v_name text;
begin
  if not public.has_perm('staff.manage'::platform_permission) then raise exception 'forbidden' using errcode='42501'; end if;
  select role, full_name into v_role, v_name from public.profiles where id=p_profile;
  if v_role is null then raise exception 'not-found' using errcode='02000'; end if;
  if v_role = 'admin'::user_role then
    raise exception 'cannot-rank-owner' using errcode='42501', hint='المالك (admin) رتبتُه عليا غير قابلة للتعديل.'; end if;
  v_perms := case p_rank
    when 'ops_manager' then array['subscribers.view','subscribers.manage','subscribers.suspend','feedback.handle','audit.view']::platform_permission[]
    when 'finance'     then array['subscribers.view','billing.manage','audit.view']::platform_permission[]
    when 'support_l1'  then array['subscribers.view','feedback.handle']::platform_permission[]
    when 'marketing'   then array['subscribers.view','marketing.manage']::platform_permission[]
    else null end;
  if v_perms is null then raise exception 'invalid-rank' using errcode='22023', hint='الرتب: ops_manager/finance/support_l1/marketing'; end if;
  update public.profiles set platform_rank = p_rank where id = p_profile;
  delete from public.staff_permissions where profile_id = p_profile;
  insert into public.staff_permissions (profile_id, permission, granted_by)
    select p_profile, unnest(v_perms), auth.uid();
  perform public._log_admin_action('set_staff_rank','profile',p_profile,v_name, jsonb_build_object('rank',p_rank,'permissions',to_jsonb(v_perms)));
end $$;
revoke all on function public.set_staff_rank(uuid, text) from public, anon;
grant  execute on function public.set_staff_rank(uuid, text) to authenticated;

create or replace function public.list_staff_permissions()
returns table(profile_id uuid, full_name text, role user_role, platform_rank text, permissions text[])
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role, p.platform_rank,
    coalesce(array_agg(sp.permission::text order by sp.permission::text)
             filter (where sp.permission is not null), '{}')
  from public.profiles p
  left join public.staff_permissions sp on sp.profile_id = p.id
  where public.has_perm('staff.manage'::platform_permission)
    and p.role in ('admin'::user_role, 'support'::user_role)
  group by p.id, p.full_name, p.role, p.platform_rank
  order by p.role, p.full_name nulls last;
$$;
revoke all on function public.list_staff_permissions() from public, anon;
grant  execute on function public.list_staff_permissions() to authenticated;

notify pgrst, 'reload schema';
