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

-- تفعيل البثّ الحيّ (Realtime) لتحديث المقاعد عند تغيّر passengers
do $$ begin
  alter publication supabase_realtime add table public.passengers;
exception when duplicate_object then null;
when others then null; end $$;

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
