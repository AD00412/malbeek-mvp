-- ============================================================
--  ملبّيك — تزويدُ ما بعد OAuth (Google)   [مصادقة]
--  signInWithOAuth لا يمرّر دورنا/سياقنا، فيُنشأ الملف افتراضيًّا
--  customer بلا حملة. هاتان الدالّتان تُكملان التزويد بأمانٍ بعد
--  العودة من Google (تُستدعيان من /auth/callback):
--    • provision_subscriber_after_oauth: ترقيةُ ملفٍّ جديدٍ لمشترك
--      + إنشاء حملته (لو لم يكن مرتبطًا ولا له حجوزات).
--    • link_customer_to_campaign: ربطُ معتمرٍ بحملةٍ عبر رابطها.
--  SECURITY DEFINER + search_path + grants ضيّقة + علم الثقة
--  malbeek.trusted لتجاوز حارس الأعمدة بمنطقٍ مضبوط.
--  idempotent — شغّله في Supabase SQL Editor.
-- ============================================================

-- ١) مشتركٌ جديدٌ عبر Google: يُنشئ الحملة ويرفع الدور
create or replace function public.provision_subscriber_after_oauth(p_org_name text)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_uid  uuid := auth.uid();
  v_role user_role;
  v_sub  uuid;
  v_new  uuid;
  v_base text;
  v_slug text;
  i int := 0;
begin
  if v_uid is null then raise exception 'must-login' using errcode = '42501'; end if;

  select role, subscriber_id into v_role, v_sub from public.profiles where id = v_uid;
  if v_role = 'admin' then
    raise exception 'admin لا يُزوَّد ذاتيًّا';
  end if;
  if v_sub is not null then
    raise exception 'already-linked: الملفّ مرتبطٌ بحملةٍ مسبقًا';
  end if;
  -- منع التلاعب: حسابٌ معتمرٌ نشِطٌ (له حجوزات) لا يُحوَّل لمشترك
  if exists (select 1 from public.passengers where profile_id = v_uid) then
    raise exception 'has-bookings: حسابٌ معتمرٌ نشِطٌ لا يُحوَّل لمشترك';
  end if;

  -- توليدُ slug فريدٍ من اسم الحملة (ascii فقط؛ يسقط للعربيّة → hamla)
  v_base := regexp_replace(lower(coalesce(p_org_name, '')), '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  if v_base is null or length(v_base) < 4 then v_base := 'hamla'; end if;
  v_base := left(v_base, 36);
  v_slug := v_base;
  while exists (select 1 from public.subscribers where slug = v_slug) and i < 8 loop
    i := i + 1;
    v_slug := left(v_base, 30) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
  end loop;

  insert into public.subscribers (owner_id, org_name, slug, plan)
  values (v_uid, coalesce(nullif(trim(p_org_name), ''), 'حملتي'), v_slug, 'trial')
  returning id into v_new;

  -- ترقيةُ الملفّ (علم الثقة يتجاوز guard_profile_columns بمنطقٍ مضبوط)
  perform set_config('malbeek.trusted', '1', true);
  update public.profiles set role = 'subscriber', subscriber_id = v_new where id = v_uid;

  return v_new;
end $$;

-- ٢) معتمرٌ جديدٌ عبر Google: يربط ملفّه بحملةٍ عبر رابطها
create or replace function public.link_customer_to_campaign(p_subscriber_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_uid  uuid := auth.uid();
  v_role user_role;
  v_sub  uuid;
begin
  if v_uid is null then raise exception 'must-login' using errcode = '42501'; end if;
  if p_subscriber_id is null then raise exception 'no-campaign'; end if;

  select role, subscriber_id into v_role, v_sub from public.profiles where id = v_uid;
  -- لا نمسّ غير المعتمر (مشترك/أدمن لهم حساباتهم)
  if v_role is distinct from 'customer' then
    raise exception 'not-customer: هذا الحساب ليس معتمرًا';
  end if;
  if not exists (select 1 from public.subscribers s where s.id = p_subscriber_id) then
    raise exception 'campaign-not-found: الحملة غير موجودة';
  end if;
  -- مرتبطٌ بنفس الحملة؟ لا عمل (idempotent)
  if v_sub = p_subscriber_id then return; end if;

  perform set_config('malbeek.trusted', '1', true);
  update public.profiles set subscriber_id = p_subscriber_id where id = v_uid;
end $$;

-- ٣) الصلاحيّات — لا anon، للمصادَقين فقط
revoke all on function public.provision_subscriber_after_oauth(text) from public, anon;
grant  execute on function public.provision_subscriber_after_oauth(text) to authenticated;
revoke all on function public.link_customer_to_campaign(uuid) from public, anon;
grant  execute on function public.link_customer_to_campaign(uuid) to authenticated;
