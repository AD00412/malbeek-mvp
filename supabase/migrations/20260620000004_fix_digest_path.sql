-- ============================================================
-- إصلاحٌ عاجلٌ: _client_ip_hash لا تَجد digest() من pgcrypto
-- ============================================================
-- المشكلة:
-- في Supabase، pgcrypto يُثبَّت في schema 'extensions' لا 'public'.
-- دالّتنا كانت بـsearch_path = public, pg_catalog → digest غير مرئيّة
-- → فشل بـ "function digest(text, text) does not exist" → الواجهةُ
-- تَلتقط النصَّ "function … does not exist" وتُريد المستخدم رسالةً
-- مُضلِّلةً «خدمة النموذج غير مهيّأة بعد».
--
-- الإصلاح:
-- ١) إضافةُ extensions لـ search_path في _client_ip_hash.
-- ٢) تأمينٌ مضاعف: تَغليفُ تحويل jsonb بـbegin/exception (لو
--    request.headers ليست JSON صالحة لأيِّ سبب).
-- ٣) إضافةُ نفس search_path لـsubmit_public_message — يَضمن الإدراج
--    حتّى لو احتاج عرضًا لجداولِ extensions مستقبلًا.
-- ============================================================

-- ─── إصلاح _client_ip_hash ───
create or replace function public._client_ip_hash()
returns text
language plpgsql stable
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  hdrs jsonb;
  ip   text;
begin
  -- استخراجُ headers بتأمينٍ مضاعف
  begin
    hdrs := current_setting('request.headers', true)::jsonb;
  exception when others then
    return null;
  end;
  if hdrs is null then return null; end if;

  ip := coalesce(
    hdrs ->> 'cf-connecting-ip',
    hdrs ->> 'x-real-ip',
    split_part(coalesce(hdrs ->> 'x-forwarded-for', ''), ',', 1)
  );
  if ip is null or btrim(ip) = '' then return null; end if;

  -- ★ digest الآن مرئيّةٌ من schema extensions
  return encode(digest(btrim(ip), 'sha256'), 'hex');
end $$;

revoke all on function public._client_ip_hash() from public, anon, authenticated;

-- ─── إصلاح submit_public_message: إضافةُ extensions للـsearch_path ───
create or replace function public.submit_public_message(
  p_mode        text,
  p_name        text,
  p_email       text,
  p_subject     text,
  p_kind        text,
  p_body        text,
  p_attachments text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  v_id        uuid;
  v_kind      public_message_kind;
  v_recent_em int;
  v_recent_ip int;
  v_ip_hash   text;
  v_path      text;
  v_user_agent text;
begin
  -- ١) تحقّقاتٌ مدافِعةٌ
  if p_mode not in ('contact','feedback') then
    raise exception 'mode-invalid' using errcode = '22023';
  end if;
  if char_length(coalesce(trim(p_name),'')) < 2 then
    raise exception 'name-too-short' using errcode = '22023';
  end if;
  if coalesce(p_email,'') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'email-invalid' using errcode = '22023';
  end if;
  if char_length(coalesce(trim(p_body),'')) < 10 then
    raise exception 'body-too-short' using errcode = '22023';
  end if;
  if coalesce(array_length(p_attachments, 1), 0) > 3 then
    raise exception 'too-many-attachments' using errcode = '22023';
  end if;

  -- فحصُ مساراتِ المرفقات
  if p_attachments is not null then
    foreach v_path in array p_attachments loop
      if v_path is not null and v_path !~ '^public/' then
        raise exception 'attachment-path-invalid' using errcode = '22023',
          hint = 'paths must start with public/';
      end if;
    end loop;
  end if;

  -- ٢) Rate-limit مزدوج
  select count(*) into v_recent_em
  from public.public_messages
  where lower(email) = lower(trim(p_email))
    and created_at > now() - interval '1 hour';
  if v_recent_em >= 5 then
    raise exception 'rate-limit-email' using errcode = '23P01',
      hint = 'حاول بعد ساعة';
  end if;

  v_ip_hash := public._client_ip_hash();
  if v_ip_hash is not null then
    select count(*) into v_recent_ip
    from public.public_messages
    where ip_hash = v_ip_hash
      and created_at > now() - interval '1 hour';
    if v_recent_ip >= 15 then
      raise exception 'rate-limit-ip' using errcode = '23P01',
        hint = 'حاول بعد ساعة';
    end if;
  end if;

  -- ٣) اشتقاقُ النوع
  v_kind := case p_mode
    when 'contact' then 'contact'::public_message_kind
    else coalesce(nullif(p_kind,''), 'suggestion')::public_message_kind
  end;

  -- ٤) استخراج user_agent بتأمين
  begin
    v_user_agent := left(coalesce(current_setting('request.headers', true)::jsonb ->> 'user-agent', ''), 500);
  exception when others then
    v_user_agent := '';
  end;

  -- ٥) الإدراج
  insert into public.public_messages
    (mode, kind, name, email, subject, body, attachments, ip_hash, user_agent)
  values
    (p_mode, v_kind, trim(p_name), lower(trim(p_email)),
     nullif(trim(coalesce(p_subject,'')), ''), trim(p_body),
     coalesce(p_attachments, '{}'),
     v_ip_hash,
     v_user_agent)
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.submit_public_message(text,text,text,text,text,text,text[]) from public;
grant  execute on function public.submit_public_message(text,text,text,text,text,text,text[]) to anon, authenticated;

notify pgrst, 'reload schema';

-- اختبار: التَأكّد أنّ digest الآن مرئيّة
select 'pgcrypto digest visible' as test,
       case when count(*) > 0 then 'YES ✓' else 'NO ✗' end as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.proname = 'digest' and n.nspname = 'extensions';
