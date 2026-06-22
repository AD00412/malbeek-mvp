-- نظام الرتب والصلاحيات الحبيبيّة لإدارة ملبّيك — الأساس (إضافيّ غير متلف، idempotent).
-- ضمانُ السلامة: has_perm() يُرجِع true دائمًا للأدمن (المالك لا يُقفل أبدًا).
-- طُبِّق على الإنتاج عبر MCP apply_migration (platform_roles_foundation).

do $$ begin
  create type platform_permission as enum (
    'subscribers.view','subscribers.manage','subscribers.suspend',
    'billing.manage','pii.view','feedback.handle','marketing.manage',
    'staff.manage','audit.view');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists platform_rank text;

create table if not exists public.staff_permissions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  permission platform_permission not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (profile_id, permission)
);
alter table public.staff_permissions enable row level security;

create or replace function public.has_perm(p_key platform_permission)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'admin'::user_role, false)
      or exists (select 1 from public.staff_permissions sp
                 where sp.profile_id = auth.uid() and sp.permission = p_key);
$$;
revoke all on function public.has_perm(platform_permission) from public, anon;
grant  execute on function public.has_perm(platform_permission) to authenticated;

drop policy if exists "staff_perms read" on public.staff_permissions;
create policy "staff_perms read" on public.staff_permissions for select to authenticated
  using (profile_id = auth.uid() or public.has_perm('staff.manage'::platform_permission));
grant select on public.staff_permissions to authenticated;

notify pgrst, 'reload schema';
