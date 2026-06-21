-- ============================================================
--  ملبّيك — الشكاوى التصاعديّة + تتبّعُ الحلّ   [P3]
--  يُوسّع نظامَ التغذية الراجعة (تذاكر الدعم) بحقولِ تصعيدٍ ومتابعةِ حلّ:
--    • priority    : مستوى الأولويّة (low/normal/high/urgent)
--    • escalated_at: لحظةُ تصعيد التذكرة (للأولويّة العاجلة/الإشراف)
--    • resolved_at : لحظةُ الحلّ (تتبّعٌ مستقلٌّ عن replied_at)
--    • resolution  : ملاحظةُ الحلّ الداخليّة (كيف عُولجت)
--
--  لا تغييرَ على RLS: الأدمنُ وحده يُحدّث feedback (سياسةٌ قائمة)، فالتصعيدُ
--  وتتبّعُ الحلّ إداريّان بالكامل — بلا توسيعِ وصول (§٠).
--  forward-only · idempotent · شغّله في Supabase SQL Editor.
-- ============================================================

alter table public.feedback
  add column if not exists priority     text not null default 'normal',
  add column if not exists escalated_at timestamptz,
  add column if not exists resolved_at  timestamptz,
  add column if not exists resolution   text;

do $$ begin
  alter table public.feedback
    add constraint feedback_priority_chk check (priority in ('low','normal','high','urgent'));
exception when duplicate_object then null; end $$;

-- فهارسُ للتصفية (المُصعَّدة + غير المحلولة الأقدم)
create index if not exists idx_feedback_escalated on public.feedback(escalated_at) where escalated_at is not null;
create index if not exists idx_feedback_open_age  on public.feedback(created_at) where resolved_at is null;
