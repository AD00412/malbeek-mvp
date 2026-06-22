-- ============================================================
--  ملبّيك — وصولُ الدعم المؤقّت (JIT Access)   [أمن]
--  المشكلة: دور support كان يقرأ كلَّ PII المعتمرين (هويّات/جوّالات/مبالغ)
--  عبر كلّ الحملات افتراضيًّا (APPLY_support_readonly).
--
--  الحلّ (JIT):
--   • الافتراضيّ للدعم: إحصاءاتٌ مجمّعةٌ فقط (admin_campaign_stats) — بلا PII خام.
--   • PII الحسّاس (passengers/customers/payments/refunds/waitlist): يُقرأ
--     فقط بمنحةٍ نشطةٍ لحملةٍ بعينها، صلاحيّتها افتراضيًّا ٢٤ ساعة، قابلةٌ للسحب،
--     وكلُّ منحٍ/سحبٍ مُوثَّقٌ في platform_audit_log.
--   • الأدمن يقرأ كلَّ شيءٍ بلا قيد (غير متأثّر).
--
--  forward-only · idempotent · شغّله في Supabase SQL Editor.
-- ============================================================

-- ١) جدولُ المنح
create table if not exists public.support_access_grants (
  id            uuid primary key default gen_random_uuid(),
  support_id    uuid not null references public.profiles(id)    on delete cascade,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  granted_by    uuid references public.profiles(id)             on delete set null,
  reason        text,
  granted_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '24 hours'),
  revoked_at    timestamptz
);
create index if not exists idx_sag_active
  on public.support_access_grants(support_id, subscriber_id)
  where revoked_at is null;
create index if not exists idx_sag_subscriber on public.support_access_grants(subscriber_id);

alter table public.support_access_grants enable row level security;

-- الأدمن يدير كلَّ المنح؛ موظّفُ الدعم يقرأ منحَه فقط (لمعرفة ما أُتيح له).
drop policy if exists "sag admin all" on public.support_access_grants;
create policy "sag admin all" on public.support_access_grants for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists "sag support read own" on public.support_access_grants;
create policy "sag support read own" on public.support_access_grants for select
  using (support_id = auth.uid());

grant select, insert, update, delete on public.support_access_grants to authenticated;

-- ٢) helper: هل لموظّف الدعم الحاليّ منحةٌ نشطةٌ لهذه الحملة؟
create or replace function public.support_has_grant(p_sub uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.support_access_grants g
    where g.support_id = auth.uid()
      and g.subscriber_id = p_sub
      and g.revoked_at is null
      and g.expires_at > now()
  );
$$;
revoke all on function public.support_has_grant(uuid) from public, anon;
grant  execute on function public.support_has_grant(uuid) to authenticated;

-- ٣) تقييدُ قراءة PII للدعم بمنحةٍ نشطة (الأدمن بلا قيد).
--    نُعيد بناء سياسة «admin read» على الجداول الخمسة الحسّاسة فقط.
--    السياساتُ الأخرى (المالك/الفريق/العميل) تبقى كما هي.
drop policy if exists "passengers admin read" on public.passengers;
create policy "passengers admin read" on public.passengers for select using (
  public.my_role() = 'admin'
  or (public.my_role() = 'support' and public.support_has_grant(subscriber_id))
);

drop policy if exists "customers admin read" on public.customers;
create policy "customers admin read" on public.customers for select using (
  public.my_role() = 'admin'
  or (public.my_role() = 'support' and public.support_has_grant(subscriber_id))
);

drop policy if exists "payments admin read" on public.payments;
create policy "payments admin read" on public.payments for select using (
  public.my_role() = 'admin'
  or (public.my_role() = 'support' and public.support_has_grant(subscriber_id))
);

drop policy if exists "refunds admin read" on public.refunds;
create policy "refunds admin read" on public.refunds for select using (
  public.my_role() = 'admin'
  or (public.my_role() = 'support' and public.support_has_grant(subscriber_id))
);

drop policy if exists "wait admin read" on public.waitlist;
create policy "wait admin read" on public.waitlist for select using (
  public.my_role() = 'admin'
  or (public.my_role() = 'support' and public.support_has_grant(subscriber_id))
);

-- ٤) RPC: منحُ وصولٍ مؤقّت (أدمن فقط) + توثيق
create or replace function public.grant_support_access(
  p_support uuid,
  p_sub     uuid,
  p_hours   int  default 24,
  p_reason  text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_id uuid; v_org text; v_name text; v_role user_role;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 168 then
    raise exception 'invalid-hours' using errcode = '22023';  -- ١ ساعة .. ٧ أيّام
  end if;
  select role, full_name into v_role, v_name from public.profiles where id = p_support;
  if v_role is distinct from 'support'::user_role then
    raise exception 'not-support' using errcode = '22023', hint = 'المستخدمُ ليس بدور دعم.';
  end if;
  select org_name into v_org from public.subscribers where id = p_sub;
  if v_org is null then raise exception 'not-found' using errcode = '02000'; end if;

  insert into public.support_access_grants (support_id, subscriber_id, granted_by, reason, expires_at)
  values (p_support, p_sub, auth.uid(), p_reason, now() + make_interval(hours => p_hours))
  returning id into v_id;

  perform public._log_admin_action(
    'grant_support_access', 'subscriber', p_sub, v_org,
    jsonb_build_object('support_id', p_support, 'support_name', v_name, 'hours', p_hours, 'reason', p_reason)
  );
  return v_id;
end $$;
revoke all on function public.grant_support_access(uuid, uuid, int, text) from public, anon;
grant  execute on function public.grant_support_access(uuid, uuid, int, text) to authenticated;

-- ٥) RPC: سحبُ منحةٍ (أدمن فقط) + توثيق
create or replace function public.revoke_support_access(p_grant uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_sub uuid; v_org text; v_support uuid;
begin
  if my_role() <> 'admin'::user_role then
    raise exception 'admin-only' using errcode = '42501';
  end if;
  update public.support_access_grants
     set revoked_at = now()
   where id = p_grant and revoked_at is null
   returning subscriber_id, support_id into v_sub, v_support;
  if v_sub is null then raise exception 'not-found-or-revoked' using errcode = '02000'; end if;
  select org_name into v_org from public.subscribers where id = v_sub;
  perform public._log_admin_action(
    'revoke_support_access', 'subscriber', v_sub, v_org,
    jsonb_build_object('grant_id', p_grant, 'support_id', v_support)
  );
end $$;
revoke all on function public.revoke_support_access(uuid) from public, anon;
grant  execute on function public.revoke_support_access(uuid) to authenticated;

-- ٦) RPC: قائمةُ مستخدمي الدعم (لاختيارهم في واجهة المنح — أدمن فقط)
create or replace function public.list_support_users()
returns table(id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name
  from public.profiles p
  where p.role = 'support'::user_role
    and (select my_role()) = 'admin'::user_role
  order by p.full_name nulls last;
$$;
revoke all on function public.list_support_users() from public, anon;
grant  execute on function public.list_support_users() to authenticated;

notify pgrst, 'reload schema';
