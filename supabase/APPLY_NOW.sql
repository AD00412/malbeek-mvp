-- ============================================================
-- ملبّيك · ميغرشنات ٢٠٢٦-٠٦-٢٠ — اِلصقها مرّةً في SQL Editor
-- ============================================================
-- يَجمع ٣ ميغرشنات:
--   ١) إصلاحُ admin_campaign_stats (C1) — حرجٌ، لوحةُ الأدمن مكسورة
--   ٢) سياسةُ DELETE على feedback (H4)
--   ٣) rate-limit بـIP + فحصُ مسار المرفقات (H5 + M4)
--
-- الميغرشناتُ idempotent — يَجوز تَشغيلُها أكثرَ من مرّة دون ضرر.
-- يُفترض تشغيلُها كاملةً في معاملةٍ واحدةٍ (BEGIN/COMMIT أوتوماتيكيّ
-- في SQL Editor عند تنفيذ كامل الـscript).
-- ============================================================


-- ============================================================
-- ١) revert INVOKER → DEFINER لـ admin_campaign_stats
-- ============================================================
alter function public.admin_campaign_stats() security definer;
-- unread_notifications_count يَبقى INVOKER (يَعمل صحيحًا).


-- ============================================================
-- ٢) سياسةُ DELETE على feedback — تنظيفُ السبام
-- ============================================================
drop policy if exists "feedback delete" on public.feedback;
create policy "feedback delete"
  on public.feedback
  for delete
  to authenticated
  using (my_role() = 'admin'::user_role);


-- ============================================================
-- ٣) rate-limit بـIP + فحصُ مسار المرفقات لـ submit_public_message
-- ============================================================

-- pgcrypto لـ sha256
create extension if not exists pgcrypto;

-- دالّةٌ مساعِدةٌ لاستخراج hash IP من headers الطلب
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

  ip := coalesce(
    hdrs ->> 'cf-connecting-ip',
    hdrs ->> 'x-real-ip',
    split_part(coalesce(hdrs ->> 'x-forwarded-for', ''), ',', 1)
  );
  if ip is null or btrim(ip) = '' then return null; end if;

  return encode(digest(btrim(ip), 'sha256'), 'hex');
end $$;

revoke all on function public._client_ip_hash() from public, anon, authenticated;

-- إعادةُ كتابة submit_public_message
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

  -- ★ فحصُ مساراتِ المرفقات (M4)
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

  -- ٤) الإدراج
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

create index if not exists idx_pmsg_ip_hash on public.public_messages(ip_hash, created_at desc);

revoke all on function public.submit_public_message(text,text,text,text,text,text,text[]) from public;
grant  execute on function public.submit_public_message(text,text,text,text,text,text,text[]) to anon, authenticated;


-- ============================================================
-- التحقّق
-- ============================================================
notify pgrst, 'reload schema';

-- اختبارٌ سريع: هذه الاستعلامات يَجب أن تَنجح
select 'admin_campaign_stats' as func,
       case when prosecdef then 'DEFINER ✓' else 'INVOKER ✗' end as security
  from pg_proc where proname = 'admin_campaign_stats'
union all
select 'feedback delete policy',
       case when count(*) > 0 then 'EXISTS ✓' else 'MISSING ✗' end
  from pg_policies where tablename = 'feedback' and cmd = 'DELETE'
union all
select '_client_ip_hash function',
       case when count(*) > 0 then 'EXISTS ✓' else 'MISSING ✗' end
  from pg_proc where proname = '_client_ip_hash'
union all
select 'idx_pmsg_ip_hash',
       case when count(*) > 0 then 'EXISTS ✓' else 'MISSING ✗' end
  from pg_indexes where indexname = 'idx_pmsg_ip_hash';
