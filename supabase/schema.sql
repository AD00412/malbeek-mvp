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
do $$ begin create type feedback_kind as enum ('suggestion','problem','question','feature'); exception when duplicate_object then null; end $$;

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
alter table public.trips add column if not exists return_at        timestamptz;
alter table public.trips add column if not exists bus_label        text;
alter table public.trips add column if not exists boarding_point   text;
alter table public.trips add column if not exists notes            text;
-- بيانات الباص والطاقم (تظهر في ترويسة الكشف الرسمي)
alter table public.trips add column if not exists bus_plate        text;
alter table public.trips add column if not exists driver_name      text;
alter table public.trips add column if not exists driver_phone     text;
alter table public.trips add column if not exists assistant_name   text;
alter table public.trips add column if not exists assistant_phone  text;
alter table public.trips add column if not exists supervisor_name  text;
alter table public.trips add column if not exists supervisor_phone text;
create index if not exists idx_trips_subscriber on public.trips(subscriber_id);

-- ترويسة المؤسسة في الكشف الرسمي
alter table public.subscribers add column if not exists license_no  text;  -- رقم تصريح/ترخيص النقل
alter table public.subscribers add column if not exists stamp_text  text;  -- نص الختم الإلكتروني
alter table public.subscribers add column if not exists logo_url    text;  -- شعار المؤسسة (اختياري)
alter table public.subscribers add column if not exists contact_phone text;

-- ---------- ركّاب الرحلة (سجلّ الكشف لكل رحلة/باص) ----------
create table if not exists public.passengers (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid not null references public.subscribers(id) on delete cascade,
  trip_id        uuid not null references public.trips(id) on delete cascade,
  full_name      text not null,
  national_id    text,
  phone          text,
  nationality    text,
  seat_no        text,
  boarding_point text,
  status         text not null default 'registered',  -- registered/paid/boarded/checked_in
  notes          text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_passengers_trip       on public.passengers(trip_id);
create index if not exists idx_passengers_subscriber on public.passengers(subscriber_id);

-- التذكرة والباركود + أوقات الحضور (idempotent)
alter table public.passengers add column if not exists ticket_code   text;
alter table public.passengers add column if not exists boarded_at     timestamptz;
alter table public.passengers add column if not exists checked_in_at  timestamptz;
-- خريطة المقاعد: جنس المعتمر، عائلة، وسياسة المقاعد على مستوى الرحلة
alter table public.passengers add column if not exists gender         text;            -- 'male' | 'female'
alter table public.passengers add column if not exists is_family      boolean not null default false;
alter table public.trips      add column if not exists seating_policy text not null default 'all_male';
-- تخطيط الباص القابل للضبط (صفوف ٤ مقاعد + صفّ خلفي)
alter table public.trips      add column if not exists bus_rows       int  not null default 11;
alter table public.trips      add column if not exists bus_back_row   int  not null default 5;
-- منع حجز مقعدٍ مكرّر في نفس الرحلة (يسمح بالـ NULL لمقاعد غير مخصّصة بعد)
create unique index if not exists uniq_passengers_trip_seat
  on public.passengers(trip_id, seat_no) where seat_no is not null;
-- توليد رمز تذكرةٍ فريدٍ للصفوف القديمة ثم جعله افتراضيًّا للجديدة
update public.passengers set ticket_code = 'TKT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))
  where ticket_code is null;
alter table public.passengers alter column ticket_code
  set default 'TKT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
create unique index if not exists uniq_passengers_ticket on public.passengers(ticket_code);
-- ربط الراكب بحساب العميل (لتدفّق الحجز الذاتي) + مرجع الدفع
alter table public.passengers add column if not exists profile_id  uuid references public.profiles(id) on delete set null;
alter table public.passengers add column if not exists payment_ref text;
create index if not exists idx_passengers_profile on public.passengers(profile_id);
-- رابط المتجر الخارجي للمشترك (سلة/زد) لخطوة الدفع
alter table public.subscribers add column if not exists store_url text;

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
--  ★ أمان: لا يُمنح دور admin عبر التسجيل إطلاقًا — raw_user_meta_data
--    يتحكّم بها المستخدم. الترقية إلى admin تتم يدويًّا من القاعدة فقط.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer');
begin
  if v_role = 'admin' then
    v_role := 'customer';                       -- منع رفع الامتياز عند التسجيل
  end if;

  insert into public.profiles (id, role, full_name, phone, subscriber_id)
  values (
    new.id,
    v_role,
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
--  ★ حارس أعمدة الملف الشخصي (يمنع رفع الامتيازات الذاتي)
--  RLS وحده لا يمنع تعديل عمودٍ بعينه؛ هذا التريغر يحرس role و subscriber_id:
--   • لا يستطيع غير الأدمن تغيير دوره بنفسه (يبقى كما هو).
--   • لا يستطيع المستخدم ربط نفسه بحملةٍ لا يملكها (يبقى كما هو) —
--     ويُسمح بالربط بحملةٍ يملكها (يخدم تدفّق المشترك والإصلاح الذاتي).
-- ============================================================
create or replace function public.guard_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), 'customer') <> 'admin' then
    if new.role is distinct from old.role then
      new.role := old.role;
    end if;
    if new.subscriber_id is distinct from old.subscriber_id then
      if new.subscriber_id is not null
         and not exists (select 1 from public.subscribers s
                         where s.id = new.subscriber_id and s.owner_id = auth.uid()) then
        new.subscriber_id := old.subscriber_id;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_profiles_update on public.profiles;
create trigger guard_profiles_update
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- ============================================================
--  تفعيل RLS على كل الجداول
-- ============================================================
alter table public.subscribers enable row level security;
alter table public.profiles    enable row level security;
alter table public.trips       enable row level security;
alter table public.customers   enable row level security;
alter table public.passengers  enable row level security;

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
-- الإدارة تُحدّث المشترك (مثل ترقية الباقة trial ↔ paid)
drop policy if exists "subscriber admin update"     on public.subscribers;
create policy "subscriber admin update"     on public.subscribers for update using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ★ حارس فوترة: المشترك لا يرقّي باقته أو يمدّد تجربته أو ينقل ملكيته بنفسه
create or replace function public.guard_subscriber_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), 'customer') <> 'admin' then
    new.plan          := old.plan;
    new.trial_ends_at := old.trial_ends_at;
    new.owner_id      := old.owner_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_subscribers on public.subscribers;
create trigger trg_guard_subscribers
  before update on public.subscribers
  for each row execute function public.guard_subscriber_columns();
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
--  دوال تطبيع/تحقّق مشتركة (هوية/جوال) — مصدرٌ واحدٌ لكلّ الجداول
-- ============================================================
-- تحويل الأرقام العربية-الهنديّة إلى لاتينيّة + قصّ المسافات
create or replace function public.norm_digits(t text)
returns text language sql immutable as $$
  select btrim(translate(coalesce(t, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'))
$$;

-- الهوية/الإقامة: ١٠ أرقام تبدأ بـ 1 (مواطن) أو 2 (مقيم). تُرجع null إن فارغة، وترفع إن غير صحيحة.
create or replace function public.norm_national_id(t text)
returns text language plpgsql immutable as $$
declare v text := nullif(public.norm_digits(t), '');
begin
  if v is not null and v !~ '^[12][0-9]{9}$' then
    raise exception 'رقم الهوية/الإقامة غير صحيح (١٠ أرقام تبدأ بـ ١ أو ٢).';
  end if;
  return v;
end $$;

-- الجوال السعودي → 05XXXXXXXX (يقبل +9665../9665../5../05..). تُرجع null إن فارغ، وترفع إن غير صحيح.
create or replace function public.norm_sa_phone(t text)
returns text language plpgsql immutable as $$
declare p text := regexp_replace(public.norm_digits(t), '[^0-9]', '', 'g');
begin
  if p = '' then return null; end if;
  if p ~ '^9665[0-9]{8}$' then p := '0' || substring(p from 4); end if;
  if p ~ '^5[0-9]{8}$'    then p := '0' || p; end if;
  if p !~ '^05[0-9]{8}$' then
    raise exception 'رقم الجوال غير صحيح (مثال: 05XXXXXXXX).';
  end if;
  return p;
end $$;

-- ★ تطبيع وتحقّق بيانات المعتمر (هوية/جوال) — دفاعٌ مُلزِمٌ على مستوى القاعدة.
--   يُعاد التحقّق عند الإدراج أو تغيّر القيمة فقط (لا يكسر بياناتٍ قديمةً عند تحديثٍ لا يمسّها).
create or replace function public.normalize_customer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.full_name   := btrim(coalesce(new.full_name, ''));
    if new.full_name = '' or array_length(regexp_split_to_array(new.full_name, '\s+'), 1) < 2 then
      raise exception 'الاسم الرباعي مطلوبٌ كاملًا (كلمتان على الأقل).';
    end if;
    new.national_id := public.norm_national_id(new.national_id);
    new.phone       := public.norm_sa_phone(new.phone);
  else
    if new.full_name is distinct from old.full_name then
      new.full_name := btrim(coalesce(new.full_name, ''));
      if new.full_name = '' or array_length(regexp_split_to_array(new.full_name, '\s+'), 1) < 2 then
        raise exception 'الاسم الرباعي مطلوبٌ كاملًا (كلمتان على الأقل).';
      end if;
    end if;
    if new.national_id is distinct from old.national_id then
      new.national_id := public.norm_national_id(new.national_id);
    end if;
    if new.phone is distinct from old.phone then
      new.phone := public.norm_sa_phone(new.phone);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_normalize_customer on public.customers;
create trigger trg_normalize_customer
  before insert or update on public.customers
  for each row execute function public.normalize_customer();

-- ★ حارس أعمدة: العميل لا ينقل نفسه لحملةٍ أخرى ولا يغيّر ربط حسابه
create or replace function public.guard_customer_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), 'customer') <> 'admin'
     and not exists (select 1 from public.subscribers
                     where id = old.subscriber_id and owner_id = auth.uid()) then
    new.subscriber_id := old.subscriber_id;
    new.profile_id    := old.profile_id;
    new.created_at    := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_customers on public.customers;
create trigger trg_guard_customers
  before update on public.customers
  for each row execute function public.guard_customer_columns();

-- ★ منع تكرار سجلّ العميل نفسه داخل الحملة الواحدة
create unique index if not exists uniq_customer_subscriber_profile
  on public.customers(subscriber_id, profile_id) where profile_id is not null;

-- ---------- passengers (ركّاب الرحلة / سجلّ الكشف) ----------
-- المشترك يدير ركّاب رحلات حملته بالكامل
drop policy if exists "passengers owner manage" on public.passengers;
create policy "passengers owner manage" on public.passengers for all
  using      (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()))
  with check (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()));
-- ملاحظة أمان: الآن جدول passengers يحوي profile_id، فنسمح للعميل بإدارة
-- سجلّه فقط (قراءةً وإنشاءً وتعديلًا) ضمن حملته — دون رؤية بيانات بقية المعتمرين.
drop policy if exists "passengers customer read" on public.passengers;
create policy "passengers customer read" on public.passengers for select
  using (profile_id = auth.uid());
drop policy if exists "passengers customer insert" on public.passengers;
create policy "passengers customer insert" on public.passengers for insert
  with check (profile_id = auth.uid() and subscriber_id = public.my_subscriber_id());
drop policy if exists "passengers customer update" on public.passengers;
create policy "passengers customer update" on public.passengers for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and subscriber_id = public.my_subscriber_id());
-- الإدارة تقرأ الكل
drop policy if exists "passengers admin read" on public.passengers;
create policy "passengers admin read" on public.passengers for select using (public.my_role() = 'admin');

-- ============================================================
--  إشغال مقاعد رحلةٍ بلا بياناتٍ حساسة (لاختيار العميل مقعدًا حرًّا)
--  يُرجع رقم المقعد + الجنس + عائلة فقط — بلا اسمٍ أو هوية. SECURITY DEFINER
--  مع تقييدٍ صريحٍ: المستدعي مالكُ الحملة أو عميلٌ ضمنها أو إدارة.
-- ============================================================
create or replace function public.trip_seat_occupancy(p_trip uuid)
returns table(seat_no text, gender text, is_family boolean)
language sql stable security definer set search_path = public as $$
  select p.seat_no, p.gender, p.is_family
  from public.passengers p
  join public.trips t on t.id = p.trip_id
  where p.trip_id = p_trip
    and p.seat_no is not null
    and (
      t.subscriber_id in (select id from public.subscribers where owner_id = auth.uid())
      or t.subscriber_id = public.my_subscriber_id()
      or public.my_role() = 'admin'
    );
$$;
grant execute on function public.trip_seat_occupancy(uuid) to authenticated;

-- ============================================================
--  حدّ الباقة التجريبية: رحلةٌ واحدةٌ فقط للمشترك على الباقة 'trial'
-- ============================================================
create or replace function public.enforce_trial_trip_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plan plan_type;
  v_count int;
begin
  select plan into v_plan from public.subscribers where id = new.subscriber_id;
  if v_plan = 'trial' then
    select count(*) into v_count from public.trips where subscriber_id = new.subscriber_id;
    if v_count >= 1 then
      raise exception 'TRIAL_TRIP_LIMIT'
        using hint = 'الباقة التجريبية تسمح برحلةٍ واحدة. رقِّ باقتك لإضافة المزيد.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_trial_trip_limit on public.trips;
create trigger trg_trial_trip_limit
  before insert on public.trips
  for each row execute function public.enforce_trial_trip_limit();

-- ============================================================
--  ★ حارس أعمدة الراكب: يمنع العميل من تزوير الحالة/الحضور أو نقل حجزه،
--    ويتحقّق أنّ المقعد ضمن تخطيط الباص. (المالك/الإدارة بلا قيد)
-- ============================================================
create or replace function public.guard_passenger_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner boolean;
  v_total int;
begin
  select (exists (select 1 from public.subscribers s
                  where s.id = new.subscriber_id and s.owner_id = auth.uid())
          or public.my_role() = 'admin') into v_owner;

  -- تطبيع/تحقّق الاسم والهوية والجوال (عند الإدراج أو تغيّر القيمة فقط — لا يكسر بياناتٍ قديمة)
  if tg_op = 'INSERT' then
    new.full_name := btrim(coalesce(new.full_name, ''));
    if new.full_name = '' then raise exception 'اسم المعتمر مطلوب.'; end if;
    new.national_id := public.norm_national_id(new.national_id);
    new.phone       := public.norm_sa_phone(new.phone);
  else
    if new.full_name is distinct from old.full_name then
      new.full_name := btrim(coalesce(new.full_name, ''));
      if new.full_name = '' then raise exception 'اسم المعتمر مطلوب.'; end if;
    end if;
    if new.national_id is distinct from old.national_id then
      new.national_id := public.norm_national_id(new.national_id);
    end if;
    if new.phone is distinct from old.phone then
      new.phone := public.norm_sa_phone(new.phone);
    end if;
  end if;

  -- نطاق المقعد ضمن تخطيط الباص (يسري على الجميع)
  if new.seat_no is not null and new.seat_no ~ '^[0-9]+$' then
    select (t.bus_rows * 4 + t.bus_back_row) into v_total from public.trips t where t.id = new.trip_id;
    if v_total is not null and (new.seat_no::int < 1 or new.seat_no::int > v_total) then
      raise exception 'SEAT_OUT_OF_RANGE' using hint = 'رقم المقعد خارج تخطيط الباص.';
    end if;
  end if;

  -- العميل لا يرفع حالته ذاتيًّا ولا يزوّر الحضور ولا ينقل حجزه
  if not v_owner then
    if tg_op = 'INSERT' then
      new.status := 'registered';
      new.boarded_at := null;
      new.checked_in_at := null;
    else
      new.status        := old.status;
      new.trip_id       := old.trip_id;
      new.subscriber_id := old.subscriber_id;
      new.profile_id    := old.profile_id;
      new.boarded_at    := old.boarded_at;
      new.checked_in_at := old.checked_in_at;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_passengers on public.passengers;
create trigger trg_guard_passengers
  before insert or update on public.passengers
  for each row execute function public.guard_passenger_columns();

-- ---------- passengers customer delete (لإلغاء حجزه ذاتيًّا) ----------
drop policy if exists "passengers customer delete" on public.passengers;
create policy "passengers customer delete" on public.passengers for delete
  using (profile_id = auth.uid());

-- ============================================================
--  نظام التغذية الراجعة (شكاوى/اقتراحات/أسئلة/طلب ميزة)
-- ============================================================
create table if not exists public.feedback (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid references public.subscribers(id) on delete set null,
  profile_id    uuid references public.profiles(id) on delete set null,
  audience      text not null,                          -- 'subscriber' | 'customer'
  kind          feedback_kind not null default 'suggestion',
  subject       text,
  body          text not null,
  reply         text,
  status        text not null default 'open',           -- 'open' | 'in_progress' | 'resolved'
  replied_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_feedback_profile    on public.feedback(profile_id);
create index if not exists idx_feedback_subscriber on public.feedback(subscriber_id);
create index if not exists idx_feedback_status     on public.feedback(status);

alter table public.feedback enable row level security;

-- المستخدم يُنشئ ملاحظته (مع تثبيت هويته)؛ يقرأها فقط؛ الإدارة تقرأ الكل وتردّ.
drop policy if exists "feedback self insert" on public.feedback;
create policy "feedback self insert" on public.feedback for insert
  with check (profile_id = auth.uid());
drop policy if exists "feedback self read" on public.feedback;
create policy "feedback self read" on public.feedback for select
  using (profile_id = auth.uid() or public.my_role() = 'admin');
drop policy if exists "feedback admin update" on public.feedback;
create policy "feedback admin update" on public.feedback for update
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ★ حارس أعمدة feedback: يمنع المستخدم من تزييف "ردّ الإدارة" أو تشويش الحملة/الجمهور
create or replace function public.guard_feedback_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role  user_role := coalesce(public.my_role(), 'customer');
  v_mysub uuid     := public.my_subscriber_id();
begin
  if v_role <> 'admin' then
    -- لا يُسمح بضبط حقول الإدارة عند الإنشاء
    new.reply      := null;
    new.replied_at := null;
    new.status     := 'open';
    -- جمهور الإرسال يُشتقّ من دور المرسِل لا من العميل
    new.audience := case when v_role = 'subscriber' then 'subscriber' else 'customer' end;
    -- ربط الحملة: المشترك بحملته فقط؛ العميل بحملته فقط؛ غير ذلك null
    if v_role = 'subscriber' then
      new.subscriber_id := (select id from public.subscribers where owner_id = auth.uid() limit 1);
    elsif v_role = 'customer' then
      new.subscriber_id := v_mysub;
    else
      new.subscriber_id := null;
    end if;
    -- تثبيت هوية المرسِل
    new.profile_id := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_feedback on public.feedback;
create trigger trg_guard_feedback
  before insert on public.feedback
  for each row execute function public.guard_feedback_columns();

-- ============================================================
--  قائمة انتظار المقاعد (تُبلَّغ عند تفريغ مقعد)
-- ============================================================
create table if not exists public.waitlist (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  trip_id       uuid not null references public.trips(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  full_name     text,
  phone         text,
  notified_at   timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists uniq_waitlist_trip_profile on public.waitlist(trip_id, profile_id);
create index if not exists idx_waitlist_trip on public.waitlist(trip_id, created_at);

alter table public.waitlist enable row level security;
-- المالك يدير قائمة انتظار حملته
drop policy if exists "wait owner manage" on public.waitlist;
create policy "wait owner manage" on public.waitlist for all
  using      (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()))
  with check (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()));
-- العميل يقرأ/يُدرج/يحذف سجلّه فقط ضمن حملته
drop policy if exists "wait self read"   on public.waitlist;
create policy "wait self read"   on public.waitlist for select using (profile_id = auth.uid());
drop policy if exists "wait self insert" on public.waitlist;
create policy "wait self insert" on public.waitlist for insert
  with check (profile_id = auth.uid() and subscriber_id = public.my_subscriber_id());
drop policy if exists "wait self delete" on public.waitlist;
create policy "wait self delete" on public.waitlist for delete using (profile_id = auth.uid());
drop policy if exists "wait admin read"  on public.waitlist;
create policy "wait admin read"  on public.waitlist for select using (public.my_role() = 'admin');

-- ★ تريغر: عند تفريغ مقعدٍ (delete) أو إلغاءٍ، يُبلَّغ منتظرو الرحلة
create or replace function public.notify_waitlist_on_seat_free()
returns trigger language plpgsql security definer set search_path = public as $$
declare w record; v_trip_alive boolean;
begin
  if tg_op = 'DELETE' and old.seat_no is not null then
    -- تأكّد أن الرحلة لا تزال نشطةً (تجنّب إشعار "تفرّغ مقعد" لرحلةٍ مُلغاة/منتهية)
    select exists (select 1 from public.trips where id = old.trip_id
                   and status in ('draft','open')) into v_trip_alive;
    if not v_trip_alive then return old; end if;
    for w in
      select id, profile_id from public.waitlist
      where trip_id = old.trip_id and notified_at is null
      order by created_at asc limit 5
    loop
      insert into public.notifications(profile_id, audience, kind, title, body, ref_trip)
      values (w.profile_id, 'customer', 'new_booking',
              'تفرّغ مقعدٌ في رحلتك المُنتظَرة',
              'سارع لحجز مقعدك قبل امتلائها مجدّدًا.',
              old.trip_id);
      update public.waitlist set notified_at = now() where id = w.id;
    end loop;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_notify_waitlist on public.passengers;
create trigger trg_notify_waitlist
  after delete on public.passengers
  for each row execute function public.notify_waitlist_on_seat_free();

-- ============================================================
--  مركز الإشعارات الداخلي (للمشترك/العميل/الإدارة)
-- ============================================================
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid references public.profiles(id) on delete cascade,
  audience      text not null,                              -- 'admin' | 'subscriber' | 'customer'
  kind          text not null,                              -- new_booking | payment_pending | booking_canceled | feedback_reply | trial_ending | upgrade_request | low_occupancy | trial_limit_hit | new_subscriber | new_feedback | trip_changed
  title         text not null,
  body          text,
  link          text,
  ref_trip      uuid references public.trips(id) on delete cascade,
  ref_passenger uuid references public.passengers(id) on delete set null,
  ref_feedback  uuid references public.feedback(id) on delete set null,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_notif_profile_unread on public.notifications(profile_id, read_at) where read_at is null;
create index if not exists idx_notif_audience       on public.notifications(audience);
create index if not exists idx_notif_created        on public.notifications(created_at desc);

alter table public.notifications enable row level security;
-- العميل/المشترك يقرأ ويُعلِّم إشعاراته فقط
drop policy if exists "notif self read"   on public.notifications;
create policy "notif self read"   on public.notifications for select using (profile_id = auth.uid());
drop policy if exists "notif self update" on public.notifications;
create policy "notif self update" on public.notifications for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());
-- الإدارة تقرأ كل إشعارات الإدارة
drop policy if exists "notif admin read"  on public.notifications;
create policy "notif admin read"  on public.notifications for select using (public.my_role() = 'admin' and audience = 'admin');
drop policy if exists "notif admin update" on public.notifications;
create policy "notif admin update" on public.notifications for update using (public.my_role() = 'admin' and audience = 'admin') with check (public.my_role() = 'admin' and audience = 'admin');
-- لا insert من العميل: التريغرات تُنشئ الإشعارات (بصلاحية SECURITY DEFINER)

-- ★ حارس أعمدة notifications: غير الأدمن يحدّث read_at فقط
create or replace function public.guard_notification_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), 'customer') <> 'admin' then
    new.profile_id := old.profile_id;
    new.audience   := old.audience;
    new.kind       := old.kind;
    new.title      := old.title;
    new.body       := old.body;
    new.link       := old.link;
    new.ref_trip   := old.ref_trip;
    new.ref_passenger := old.ref_passenger;
    new.ref_feedback  := old.ref_feedback;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_notifications on public.notifications;
create trigger trg_guard_notifications
  before update on public.notifications
  for each row execute function public.guard_notification_columns();

-- مساعد: عدّ غير المقروء للمستخدم الحالي
create or replace function public.unread_notifications_count()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.notifications
  where read_at is null
    and (profile_id = auth.uid()
         or (public.my_role() = 'admin' and audience = 'admin'));
$$;
grant execute on function public.unread_notifications_count() to authenticated;

-- ★ تريغر: إشعارات passengers (حجزٌ جديد للمشترك، تأكيد الدفع/الصعود/التسكين للعميل، إلغاء حجز)
create or replace function public.notify_passengers_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner_id uuid;
  v_trip     record;
  v_admins   record;
begin
  if tg_op = 'INSERT' then
    select owner_id into v_owner_id from public.subscribers where id = new.subscriber_id;
    select title, route_from, route_to into v_trip from public.trips where id = new.trip_id;
    -- إشعار المشترك بكل حجزٍ جديد (سواء من المشترك أو من العميل)
    if v_owner_id is not null then
      insert into public.notifications(profile_id, audience, kind, title, body, ref_trip, ref_passenger)
      values (v_owner_id, 'subscriber', 'new_booking',
              'حجزٌ جديد: ' || coalesce(new.full_name,'معتمر'),
              'في رحلة «' || coalesce(v_trip.title,'') || '» — مقعد ' || coalesce(new.seat_no,'—'),
              new.trip_id, new.id);
    end if;
    -- إن وُجد مرجع دفعٍ للمشترك بانتظار التأكيد
    if new.payment_ref is not null and new.status = 'registered' and v_owner_id is not null then
      insert into public.notifications(profile_id, audience, kind, title, body, ref_trip, ref_passenger)
      values (v_owner_id, 'subscriber', 'payment_pending',
              'دفعٌ بانتظار التأكيد',
              coalesce(new.full_name,'معتمر') || ' — مرجع: ' || new.payment_ref,
              new.trip_id, new.id);
    end if;
  elsif tg_op = 'UPDATE' then
    -- إشعار العميل بتغيّر حالة حجزه
    if new.profile_id is not null and new.status is distinct from old.status then
      insert into public.notifications(profile_id, audience, kind, title, body, ref_trip, ref_passenger)
      values (new.profile_id, 'customer',
              case new.status when 'paid' then 'payment_pending'
                              when 'boarded' then 'new_booking'
                              when 'checked_in' then 'new_booking'
                              else 'new_booking' end,
              case new.status
                when 'paid'       then 'تمّ تأكيد دفعك ✓'
                when 'boarded'    then 'تمّ تسجيل صعودك الحافلة'
                when 'checked_in' then 'تمّ استلام غرفتك'
                else 'تحدّثت حالة حجزك'
              end,
              'حجزك في رحلتك الحالية',
              new.trip_id, new.id);
    end if;
  elsif tg_op = 'DELETE' then
    select owner_id into v_owner_id from public.subscribers where id = old.subscriber_id;
    if v_owner_id is not null then
      insert into public.notifications(profile_id, audience, kind, title, body, ref_trip)
      values (v_owner_id, 'subscriber', 'booking_canceled',
              'أُلغي حجز: ' || coalesce(old.full_name,'معتمر'),
              'تفرّغ المقعد ' || coalesce(old.seat_no,'—'),
              old.trip_id);
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_notify_passengers on public.passengers;
create trigger trg_notify_passengers
  after insert or update or delete on public.passengers
  for each row execute function public.notify_passengers_change();

-- ★ تريغر: ردّ الإدارة على ملاحظة → إشعار للمرسِل
create or replace function public.notify_feedback_reply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.reply is not null
     and (old.reply is null or old.reply is distinct from new.reply)
     and new.profile_id is not null then
    insert into public.notifications(profile_id, audience, kind, title, body, ref_feedback)
    values (new.profile_id,
            case when new.audience = 'subscriber' then 'subscriber' else 'customer' end,
            'feedback_reply',
            'ردّ إدارة ملبّيك على ملاحظتك',
            left(new.reply, 160),
            new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_feedback_reply on public.feedback;
create trigger trg_notify_feedback_reply
  after update on public.feedback
  for each row execute function public.notify_feedback_reply();

-- ★ تريغر: ملاحظة جديدة → إشعار للإدارة
create or replace function public.notify_new_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  for a in select id from public.profiles where role = 'admin' loop
    insert into public.notifications(profile_id, audience, kind, title, body, ref_feedback)
    values (a.id, 'admin', 'new_feedback',
            'ملاحظةٌ جديدة (' || new.audience || ')',
            coalesce(new.subject,'') || ' — ' || left(coalesce(new.body,''), 140),
            new.id);
  end loop;
  return new;
end $$;
drop trigger if exists trg_notify_new_feedback on public.feedback;
create trigger trg_notify_new_feedback
  after insert on public.feedback
  for each row execute function public.notify_new_feedback();

-- ★ تريغر: مشترك جديد → إشعار للإدارة
create or replace function public.notify_new_subscriber()
returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  for a in select id from public.profiles where role = 'admin' loop
    insert into public.notifications(profile_id, audience, kind, title, body)
    values (a.id, 'admin', 'new_subscriber',
            'مشترك جديد: ' || coalesce(new.org_name,''),
            'انضمت حملةٌ جديدةٌ بالباقة ' || new.plan::text);
  end loop;
  return new;
end $$;
drop trigger if exists trg_notify_new_subscriber on public.subscribers;
create trigger trg_notify_new_subscriber
  after insert on public.subscribers
  for each row execute function public.notify_new_subscriber();

-- تفعيل البثّ الحيّ (Realtime) لتحديث المقاعد + التغذية الراجعة + الباقات
do $$ begin alter publication supabase_realtime add table public.passengers;  exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.feedback;    exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.subscribers; exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.trips;       exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.waitlist;      exception when duplicate_object then null; when others then null; end $$;

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
