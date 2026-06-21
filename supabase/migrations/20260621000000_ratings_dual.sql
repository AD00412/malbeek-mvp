-- ============================================================
--  ملبّيك — نظامُ التَّقييم الثُّنائيّ (مشترك ↔ معتمر)   [P1]
--  جدولٌ واحدٌ باتّجاهين، تقييمٌ لكلِّ (رحلة × معتمر × اتّجاه):
--    • customer_to_subscriber : المعتمرُ يقيّم الحملةَ بعد انتهاء الرحلة.
--        — عامٌّ للحملة: يراه فريقُها (ومُجمَّعُه يُعرَض كمتوسّطٍ في التحليلات).
--    • subscriber_to_customer : الحملةُ تقيّم المعتمرَ (سُمعة/التزام).
--        — خاصٌّ بالحملة: لا يراه المعتمرُ إطلاقًا (RLS يمنعه).
--
--  الأمانُ يتّكئُ على الدوالِّ القائمة: can_manage_sub / my_role / auth.uid.
--  شغّل هذا الملفَّ مرّةً واحدةً في Supabase SQL Editor.
-- ============================================================

create table if not exists public.ratings (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  trip_id       uuid not null references public.trips(id)        on delete cascade,
  -- حسابُ المعتمر الذي يُقيِّم أو يُقيَّم (مرجعُ الطرفين)
  profile_id    uuid not null references public.profiles(id)     on delete cascade,
  -- سجلُّ الراكب المرتبط (للاتّجاه subscriber_to_customer) — اختياريٌّ وللربط فقط
  passenger_id  uuid references public.passengers(id)            on delete set null,
  direction     text not null check (direction in ('customer_to_subscriber','subscriber_to_customer')),
  stars         int  not null check (stars between 1 and 5),
  comment       text check (comment is null or char_length(comment) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- تقييمٌ واحدٌ لكلِّ (رحلة × معتمر × اتّجاه) — يُمكِّن التعديلَ عبر select-then-update.
create unique index if not exists uniq_rating_trip_profile_dir
  on public.ratings(trip_id, profile_id, direction);

create index if not exists idx_ratings_subscriber_dir on public.ratings(subscriber_id, direction);
create index if not exists idx_ratings_profile        on public.ratings(profile_id);

-- updated_at تلقائيٌّ عند التعديل
create or replace function public.ratings_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_ratings_updated_at on public.ratings;
create trigger trg_ratings_updated_at
  before update on public.ratings
  for each row execute function public.ratings_touch_updated_at();

alter table public.ratings enable row level security;

-- ── المعتمر: يرى/يكتب اتّجاهَه فقط، ولرحلةٍ حجزها فعلًا ──────────────
--   using يَحرس القراءة/التعديل/الحذف؛ check يَحرس الإدراج/التعديل.
--   شرطُ "حجزَ الرحلةَ فعلًا" يَمنع تقييمَ حملةٍ لم يُسافر معها.
drop policy if exists "ratings customer rw" on public.ratings;
create policy "ratings customer rw" on public.ratings for all
  using (
    direction = 'customer_to_subscriber'
    and profile_id = auth.uid()
  )
  with check (
    direction = 'customer_to_subscriber'
    and profile_id = auth.uid()
    and exists (
      select 1 from public.passengers p
      where p.trip_id = ratings.trip_id
        and p.profile_id = auth.uid()
        and p.subscriber_id = ratings.subscriber_id
    )
  );

-- ── فريقُ الحملة: يرى الاتّجاهين (تقييمُ المعتمرين له + ملاحظاتُه عنهم)،
--    ويكتبُ اتّجاهَه فقط (subscriber_to_customer) لحملته. ──────────────
drop policy if exists "ratings manager rw" on public.ratings;
create policy "ratings manager rw" on public.ratings for all
  using (public.can_manage_sub(subscriber_id))
  with check (
    public.can_manage_sub(subscriber_id)
    and direction = 'subscriber_to_customer'
  );

-- ── الأدمن: قراءةٌ كاملةٌ للإشراف ──────────────────────────────────
drop policy if exists "ratings admin read" on public.ratings;
create policy "ratings admin read" on public.ratings for select
  using (public.my_role() = 'admin');

grant select, insert, update, delete on public.ratings to authenticated;
