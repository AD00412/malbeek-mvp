-- ============================================================
--  ملبّيك — نظام الرسائل العامّة من الزوّار (Landing forms)
--  • جدول public_messages: استقبالُ تواصلٍ + ملاحظاتٍ من غير المسجَّلين
--  • RPC submit_public_message: نقطةُ إدخالٍ آمنةٌ تتجاوز RLS بضوابطَ صارمة
--  • bucket public-attachments: مرفقاتٌ عامّةُ الكتابةِ، مقفلةُ القراءة (للإدارة)
--
--  شغّل هذا الملفّ مرّةً واحدةً في Supabase SQL Editor قبل تجربة النموذج.
-- ============================================================

-- PostgreSQL لا يدعم CREATE TYPE IF NOT EXISTS — نلتفّ بـ exception handler.
do $$ begin
  create type public_message_kind as enum
    ('contact', 'suggestion', 'problem', 'question', 'feature');
exception when duplicate_object then null;
end $$;

create table if not exists public.public_messages (
  id            uuid primary key default gen_random_uuid(),
  mode          text not null check (mode in ('contact','feedback')),
  kind          public_message_kind not null,
  name          text not null check (char_length(name) between 2 and 120),
  email         text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subject       text check (subject is null or char_length(subject) <= 200),
  body          text not null check (char_length(body) between 10 and 8000),
  attachments   text[] not null default '{}',           -- مساراتٌ في bucket public-attachments
  reply         text,
  status        text not null default 'open' check (status in ('open','in_progress','resolved','spam')),
  replied_at    timestamptz,
  -- بياناتٌ تشخيصيّةٌ خفيفةٌ (مفيدةٌ لكشف الـ spam)
  ip_hash       text,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_pmsg_status  on public.public_messages(status, created_at desc);
create index if not exists idx_pmsg_email   on public.public_messages(email);

alter table public.public_messages enable row level security;

-- لا أحدَ يقرأ الرسائل العامّة إلّا الإدارة (تقرأ + تردّ).
drop policy if exists "pmsg admin read"   on public.public_messages;
create policy "pmsg admin read"   on public.public_messages for select
  using (public.my_role() = 'admin');

drop policy if exists "pmsg admin update" on public.public_messages;
create policy "pmsg admin update" on public.public_messages for update
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- لا policy للـ INSERT — يُمنع الإدراج المباشر تمامًا. نُسجّل عبر RPC فقط.

-- ============================================================
--  RPC: submit_public_message
--  • SECURITY DEFINER يسمح لها بالكتابة دون أن نمنح anon صلاحيّةً مباشرةً للجدول.
--  • Rate-limit بسيط: ٥ رسائلَ من نفس البريد كلَّ ساعة.
--  • تنظيفٌ خفيفٌ للنصوص + اشتقاقٌ للـ kind من mode.
-- ============================================================
create or replace function public.submit_public_message(
  p_mode        text,
  p_name        text,
  p_email       text,
  p_subject     text,
  p_kind        text,
  p_body        text,
  p_attachments text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_kind   public_message_kind;
  v_recent int;
begin
  -- ١) تحقّقاتٌ مدافِعةٌ مكرَّرةٌ مع الـ CHECKs (مدفعةٌ ثانية)
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

  -- ٢) Rate-limit: ٥ رسائلَ كحدٍّ أقصى من نفس البريد كلَّ ساعة
  select count(*) into v_recent
  from public.public_messages
  where lower(email) = lower(trim(p_email))
    and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'rate-limit' using errcode = '23P01',
      hint = 'حاول بعد ساعة';
  end if;

  -- ٣) اشتقاقُ النوع (kind) من mode/p_kind
  v_kind := case p_mode
    when 'contact' then 'contact'::public_message_kind
    else coalesce(nullif(p_kind,''), 'suggestion')::public_message_kind
  end;

  -- ٤) الإدراج
  insert into public.public_messages
    (mode, kind, name, email, subject, body, attachments)
  values
    (p_mode, v_kind, trim(p_name), lower(trim(p_email)),
     nullif(trim(coalesce(p_subject,'')), ''), trim(p_body),
     coalesce(p_attachments, '{}'))
  returning id into v_id;

  return v_id;
end $$;

-- نمنح للـ anon (وللمسجَّلين) صلاحيّةَ استدعاءِ الـ RPC فقط — لا وصولَ للجدول.
revoke all on function public.submit_public_message(text,text,text,text,text,text,text[]) from public;
grant  execute on function public.submit_public_message(text,text,text,text,text,text,text[]) to anon, authenticated;

-- ============================================================
--  Storage bucket: public-attachments
--  أنشئه يدويًّا من Supabase Dashboard → Storage → New bucket:
--    name:      public-attachments
--    public:    OFF (مرفقاتٌ يقرؤها الإدارةُ فقط)
--    file size: 5 MB
--    allowed:   image/png, image/jpeg, image/webp, application/pdf
--
--  ثمّ أنشئ هاتين الـ policies في Storage → Policies على bucket-id 'public-attachments':
--
--    1) "public anon upload" — INSERT
--       bucket_id = 'public-attachments'
--       AND (storage.foldername(name))[1] = 'public'   -- مجلّدٌ مفروضٌ
--    2) "admin read attachments" — SELECT
--       bucket_id = 'public-attachments' AND public.my_role() = 'admin'
-- ============================================================
