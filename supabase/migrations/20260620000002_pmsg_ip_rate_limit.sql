-- ============================================================
-- ملبّيك · تَقويةُ rate-limit لـ submit_public_message
-- ============================================================
-- المشكلةُ: القيدُ القديمُ يَعتمد على البريدِ فقط (٥/ساعة) → مهاجمٌ
-- يُدوِّر إيميلاتٍ متعدّدةً يَتجاوزه بسهولةٍ ويُغرق الجدول.
--
-- الإصلاح:
-- ١) إضافةُ rate-limit ثانٍ على ip_hash (١٥/ساعة) — أَكثرُ سخاءً قليلًا
--    لأنّ مستخدمين متعدّدين قد يَتشاركون IP خلف NAT/Proxy.
-- ٢) العمودُ ip_hash كان موجودًا أصلًا لكن لم يُعبَّأ — الآن نَملأه من
--    headers الطلب الواردة عبر PostgREST.
-- ٣) فحصُ المسار /public/ للمرفقات (M4 من التقرير) — يَمنع مرفقاتٍ
--    على مساراتٍ غير المسموحة.
-- ============================================================

-- pgcrypto لـ sha256 — يَكون مفعَّلًا في Supabase افتراضيًّا، نَضمن
create extension if not exists pgcrypto;

-- ─── دالّةٌ مساعِدةٌ لاستخراج hash IP من headers الطلب ───
create or replace function public._client_ip_hash()
returns text
language plpgsql stable
security definer
set search_path = public, pg_catalog
as $$
declare
  hdrs jsonb;
  ip   text;
begin
  begin
    hdrs := current_setting('request.headers', true)::jsonb;
  exception when others then
    return null;
  end;
  if hdrs is null then return null; end if;

  -- ترتيبٌ من الأكثرِ موثوقيّةً للأقلّ (cf-connecting-ip أصدقُ في Cloudflare)
  ip := coalesce(
    hdrs ->> 'cf-connecting-ip',
    hdrs ->> 'x-real-ip',
    split_part(coalesce(hdrs ->> 'x-forwarded-for', ''), ',', 1)
  );
  if ip is null or btrim(ip) = '' then return null; end if;

  return encode(digest(btrim(ip), 'sha256'), 'hex');
end $$;

revoke all on function public._client_ip_hash() from public, anon, authenticated;
-- لا تُستدعى مباشرةً من العميل — فقط من داخل submit_public_message

-- ─── إعادةُ كتابة submit_public_message مع IP rate-limit ───
create or replace function public.submit_public_message(
  p_mode        text,
  p_name        text,
  p_email       text,
  p_subject     text,
  p_kind        text,
  p_body        text,
  p_attachments text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_id        uuid;
  v_kind      public_message_kind;
  v_recent_em int;
  v_recent_ip int;
  v_ip_hash   text;
  v_path      text;
begin
  -- ١) تحقّقاتٌ مدافِعةٌ (نفسُ السابقة)
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

  -- ★ ١-أ) فحصُ مساراتِ المرفقات (M4): يَجب أن تَبدأ بـ public/
  if p_attachments is not null then
    foreach v_path in array p_attachments loop
      if v_path is not null and v_path !~ '^public/' then
        raise exception 'attachment-path-invalid' using errcode = '22023',
          hint = 'paths must start with public/';
      end if;
    end loop;
  end if;

  -- ٢) Rate-limit مزدوج: ٥/ساعة بالبريد + ١٥/ساعة بـ IP hash
  select count(*) into v_recent_em
  from public.public_messages
  where lower(email) = lower(trim(p_email))
    and created_at > now() - interval '1 hour';
  if v_recent_em >= 5 then
    raise exception 'rate-limit-email' using errcode = '23P01',
      hint = 'حاول بعد ساعة';
  end if;

  -- استخرج IP hash. لو رجع null (مثلًا اختبار محلّيّ) نَتخطّى فحص IP بدل الفشل.
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

  -- ٣) اشتقاقُ النوع (kind)
  v_kind := case p_mode
    when 'contact' then 'contact'::public_message_kind
    else coalesce(nullif(p_kind,''), 'suggestion')::public_message_kind
  end;

  -- ٤) الإدراج (مع تعبئة ip_hash و user_agent)
  insert into public.public_messages
    (mode, kind, name, email, subject, body, attachments, ip_hash, user_agent)
  values
    (p_mode, v_kind, trim(p_name), lower(trim(p_email)),
     nullif(trim(coalesce(p_subject,'')), ''), trim(p_body),
     coalesce(p_attachments, '{}'),
     v_ip_hash,
     left(coalesce(current_setting('request.headers', true)::jsonb ->> 'user-agent', ''), 500))
  returning id into v_id;

  return v_id;
end $$;

-- فهرسٌ للـ ip_hash يُسرّع فحصَ rate-limit
create index if not exists idx_pmsg_ip_hash on public.public_messages(ip_hash, created_at desc);

-- إعادةُ ضبط الصلاحيّات (الميغريشن السابقة قد غيّرتها)
revoke all on function public.submit_public_message(text,text,text,text,text,text,text[]) from public;
grant  execute on function public.submit_public_message(text,text,text,text,text,text,text[]) to anon, authenticated;

notify pgrst, 'reload schema';
