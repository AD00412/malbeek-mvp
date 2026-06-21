-- ============================================================
--  ملبّيك — فصلُ ملاحظة الحلّ الداخليّة عن ردّ المُبلِّغ   [أمن]
--  reply: يراه المُبلِّغ (الردُّ الرسميّ).
--  resolution_internal: للفريق فقط — يمنعه RLS عن المُبلِّغ.
--
--  بما أنّ RLS صفّيّ (لا يقيّد الأعمدة)، نتبع نمطَ #١:
--  VIEW v_my_feedback بأعمدةٍ آمنةٍ (بلا resolution_internal) للمُبلِّغ،
--  وتضييقُ قراءة الجدول لتقتصر على الأدمن.
--  forward-only · idempotent · شغّله في Supabase SQL Editor.
-- ============================================================

-- ١) إعادةُ تسمية resolution → resolution_internal (idempotent)
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='feedback' and column_name='resolution')
     and not exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='feedback' and column_name='resolution_internal') then
    alter table public.feedback rename column resolution to resolution_internal;
  end if;
end $$;
alter table public.feedback add column if not exists resolution_internal text;

-- ٢) VIEW آمنةٌ للمُبلِّغ — بلا resolution_internal، مقصورةٌ على صفوفه.
create or replace view public.v_my_feedback as
select id, audience, kind, subject, body, reply, status, priority,
       escalated_at, resolved_at, replied_at, created_at, attachment_url,
       subscriber_id, profile_id
from public.feedback
where profile_id = auth.uid();

grant select on public.v_my_feedback to authenticated;

-- ٣) تضييقُ قراءة الجدول: المُبلِّغ يقرأ عبر الـVIEW؛ الجدولُ للأدمن فقط.
drop policy if exists "feedback self read"  on public.feedback;
drop policy if exists "feedback admin read" on public.feedback;
create policy "feedback admin read" on public.feedback for select
  using (public.my_role() = 'admin');
