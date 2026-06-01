-- ============================================================
--  ملبّيك · مخطط قاعدة البيانات وسياسات الأمان (RLS)
--  نسخة الأساس: المصادقة، الأدوار الثلاثة، وعزل بيانات كل حملة
--  شغّل هذا الملف في:  Supabase ▸ SQL Editor
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- الأنواع ----------
do $$ begin create type user_role as enum ('admin','subscriber','customer'); exception when duplicate_object then null; end $$;
do $$ begin create type plan_type as enum ('trial','paid'); exception when duplicate_object then null; end $$;
do $$ begin create type trip_status as enum ('draft','open','closed','done'); exception when duplicate_object then null; end $$;

-- ---------- المشتركون (الحملات / المستأجرون) ----------
create table if not exists public.subscribers (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  org_name      text not null,
  slug          text not null unique,                 -- يُستخدم في رابط المشاركة /j/:slug
  plan          plan_type not null default 'trial',
  trial_ends_at timestamptz default (now() + interval '14 days'),
  created_at    timestamptz not null default now()
);
create index if not exists idx_subscribers_owner on public.subscribers(owner_id);

-- حملةٌ واحدةٌ لكل مالك: نُزيل أي تكرارٍ سابق (نُبقي الأقدم) ثم نمنع تكراره مستقبلًا.
-- آمنٌ على التثبيت الجديد (لا صفوف ⇒ لا حذف). الحذف يتعاقب على رحلات النسخ المكرّرة فقط.
delete from public.subscribers a
  using public.subscribers b
  where a.owner_id = b.owner_id
    and (a.created_at > b.created_at
         or (a.created_at = b.created_at and a.id > b.id));
create unique index if not exists uniq_subscribers_owner on public.subscribers(owner_id);

-- ---------- الملفات الشخصية (سجلّ لكل مستخدم) ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          user_role not null default 'customer',
  full_name     text,
  phone         text,
  subscriber_id uuid references public.subscribers(id) on delete set null, -- للمشترك: حملته · للعميل: حملة الرابط
  created_at    timestamptz not null default now()
);
create index if not exists idx_profiles_subscriber on public.profiles(subscriber_id);

-- ---------- الرحلات ----------
create table if not exists public.trips (
  id              uuid primary key default gen_random_uuid(),
  subscriber_id   uuid not null references public.subscribers(id) on delete cascade,
  title           text not null,
  route_from      text,
  route_to        text default 'مكة المكرمة',
  depart_at       timestamptz,
  return_at       timestamptz,
  capacity        int default 0,
  bus_label       text,
  boarding_point  text,
  status          trip_status not null default 'open',
  notes           text,
  created_at      timestamptz not null default now()
);
-- ترقية القواعد القديمة (idempotent) — تضيف الأعمدة إن غابت دون حذف بيانات
alter table public.trips add column if not exists return_at      timestamptz;
alter table public.trips add column if not exists bus_label      text;
alter table public.trips add column if not exists boarding_point text;
alter table public.trips add column if not exists notes          text;
create index if not exists idx_trips_subscriber on public.trips(subscriber_id);

-- ---------- المعتمرون (بيانات العميل المحفوظة دائمًا) ----------
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  profile_id    uuid references public.profiles(id) on delete set null,    -- حساب العميل
  full_name     text not null,
  national_id   text,
  phone         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_customers_subscriber on public.customers(subscriber_id);
create index if not exists idx_customers_profile    on public.customers(profile_id);

-- ============================================================
--  دوال مساعدة (SECURITY DEFINER لتفادي التكرار داخل سياسات profiles)
-- ============================================================
create or replace function public.my_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.my_subscriber_id()
returns uuid language sql stable security definer set search_path = public as $$
  select subscriber_id from public.profiles where id = auth.uid();
$$;

-- ============================================================
--  إنشاء الملف الشخصي تلقائيًا عند التسجيل (يقرأ بيانات التسجيل)
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name, phone, subscriber_id)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer'),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    nullif(new.raw_user_meta_data->>'subscriber_id','')::uuid
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
--  تفعيل RLS على كل الجداول
-- ============================================================
alter table public.subscribers enable row level security;
alter table public.profiles    enable row level security;
alter table public.trips       enable row level security;
alter table public.customers   enable row level security;

-- ---------- profiles ----------
drop policy if exists "profile self read"   on public.profiles;
create policy "profile self read"   on public.profiles for select using (id = auth.uid() or public.my_role() = 'admin');
drop policy if exists "profile self update" on public.profiles;
create policy "profile self update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "profile self insert" on public.profiles;
create policy "profile self insert" on public.profiles for insert with check (id = auth.uid());

-- ---------- subscribers ----------
drop policy if exists "subscriber owner all"        on public.subscribers;
create policy "subscriber owner all"        on public.subscribers for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "subscriber admin read"       on public.subscribers;
create policy "subscriber admin read"       on public.subscribers for select using (public.my_role() = 'admin');
-- العميل يقرأ حملته فقط (لعرض اسم/شعار الحملة)
drop policy if exists "subscriber customer read"    on public.subscribers;
create policy "subscriber customer read"    on public.subscribers for select using (id = public.my_subscriber_id());

-- ---------- trips ----------
-- المشترك يدير رحلات حملته بالكامل
drop policy if exists "trips owner manage" on public.trips;
create policy "trips owner manage" on public.trips for all
  using      (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()))
  with check (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()));
-- ★ جوهر الخصوصية: العميل يرى رحلات حملته فقط
drop policy if exists "trips customer read scoped" on public.trips;
create policy "trips customer read scoped" on public.trips for select
  using (subscriber_id = public.my_subscriber_id());
-- الإدارة ترى كل الرحلات
drop policy if exists "trips admin read" on public.trips;
create policy "trips admin read" on public.trips for select using (public.my_role() = 'admin');

-- ---------- customers ----------
-- المشترك يدير معتمري حملته
drop policy if exists "customers owner manage" on public.customers;
create policy "customers owner manage" on public.customers for all
  using      (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()))
  with check (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()));
-- العميل يقرأ/يعدّل سجلّه فقط
drop policy if exists "customers self read"   on public.customers;
create policy "customers self read"   on public.customers for select using (profile_id = auth.uid());
drop policy if exists "customers self update" on public.customers;
create policy "customers self update" on public.customers for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());
-- العميل ينشئ سجلّه عند التسجيل ضمن حملته فقط
drop policy if exists "customers self insert" on public.customers;
create policy "customers self insert" on public.customers for insert
  with check (profile_id = auth.uid() and subscriber_id = public.my_subscriber_id());
-- الإدارة تقرأ الكل
drop policy if exists "customers admin read" on public.customers;
create policy "customers admin read" on public.customers for select using (public.my_role() = 'admin');

-- ============================================================
--  عرضٌ عام لصفحة انضمام العميل: يحوّل الـ slug إلى اسم الحملة
--  يكشف (id, org_name, slug) فقط — بيانات غير حساسة لازمة للرابط
-- ============================================================
create or replace view public.public_subscribers as
  select id, org_name, slug from public.subscribers;
grant select on public.public_subscribers to anon, authenticated;

-- ============================================================
--  (اختياري) ترقية مستخدم إلى إدارة بعد إنشائه من لوحة Supabase Auth:
--  update public.profiles set role = 'admin' where id = '<USER_UUID>';
-- ============================================================
