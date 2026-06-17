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

-- ============================================================
--  فريق الحملة وصلاحيّاته (المرحلة ٨): لكلّ مشتركٍ مالكٌ + أعضاءُ فريق.
--  الأدوار: owner (المالك، كامل الصلاحيّات) · manager (مشرف، تشغيلٌ كامل)
--           · staff (موظّف، تشغيلٌ كامل حاليًّا — قابلٌ للتدقيق مستقبلًا).
--  إدارة الأعضاء والباقة للمالك فقط. التسكين/التشغيل لكلّ الأعضاء.
-- ============================================================
create table if not exists public.subscriber_members (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  role          text not null default 'staff' check (role in ('owner','manager','staff')),
  created_at    timestamptz not null default now(),
  unique (subscriber_id, profile_id)
);
create index if not exists idx_members_profile on public.subscriber_members(profile_id);

-- المالك عضوٌ ضمنيّ: تهيئةٌ للحملات القائمة + تريغرٌ لكلّ حملةٍ جديدة.
insert into public.subscriber_members (subscriber_id, profile_id, role)
  select id, owner_id, 'owner' from public.subscribers
  on conflict (subscriber_id, profile_id) do nothing;
create or replace function public.add_owner_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriber_members (subscriber_id, profile_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (subscriber_id, profile_id) do nothing;
  return new;
end $$;
drop trigger if exists trg_add_owner_member on public.subscribers;
create trigger trg_add_owner_member after insert on public.subscribers
  for each row execute function public.add_owner_member();

-- ★ هل يدير المستخدم الحاليّ هذه الحملة؟ (مالكٌ أو عضوُ فريق). أساسُ صلاحيّات التشغيل.
create or replace function public.can_manage_sub(p_sub uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subscribers s where s.id = p_sub and s.owner_id = auth.uid())
      or exists (select 1 from public.subscriber_members m where m.subscriber_id = p_sub and m.profile_id = auth.uid());
$$;

-- ★ الحملة التي يديرها المستخدم (يملكها أو عضوٌ فيها) — صفٌّ واحد.
create or replace function public.my_managed_subscriber_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.subscribers where owner_id = auth.uid()
  union
  select subscriber_id from public.subscriber_members where profile_id = auth.uid()
  limit 1;
$$;

-- ★ دورُ المستخدم في حملةٍ (للواجهة): owner|manager|staff|null
create or replace function public.subscriber_my_role(p_sub uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.subscribers s where s.id = p_sub and s.owner_id = auth.uid()) then 'owner'
    else (select role from public.subscriber_members where subscriber_id = p_sub and profile_id = auth.uid())
  end;
$$;

alter table public.subscriber_members enable row level security;
-- عضوُ الحملة يقرأ أعضاءها؛ المالك وحده يضيف/يحذف (عبر RPC الموثوق غالبًا)
drop policy if exists "members read" on public.subscriber_members;
create policy "members read" on public.subscriber_members for select
  using (public.can_manage_sub(subscriber_id) or public.my_role() = 'admin');
drop policy if exists "members owner manage" on public.subscriber_members;
create policy "members owner manage" on public.subscriber_members for all
  using      (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()) or public.my_role() = 'admin')
  with check (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()) or public.my_role() = 'admin');

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
alter table public.subscribers add column if not exists stamp_text  text;  -- نص الختم الإلكتروني (احتياطيٌّ — الآن نستخدم stamp_url)
alter table public.subscribers add column if not exists stamp_url   text;  -- صورة الختم الإلكتروني (PNG شفّاف يُفضَّل)
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
-- التسعير والتحصيل (تتبّعٌ ماليٌّ للدفع اليدويّ — يمهّد لبوّابة الدفع لاحقًا)
alter table public.trips      add column if not exists price          numeric(10,2);   -- سعر المقعد (اختياري)
alter table public.passengers add column if not exists paid_at        timestamptz;     -- وقت تأكيد الدفع
alter table public.passengers add column if not exists amount         numeric(10,2);   -- المبلغ المحصّل
alter table public.passengers add column if not exists payment_provider text;          -- مزوّد الدفع (عند التأكيد الآليّ)

-- سجلّ معاملات الدفع (مصدر الحقيقة للتدقيق؛ يكتبه الـ Webhook بصلاحية service_role فقط)
create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  passenger_id  uuid references public.passengers(id) on delete set null,
  trip_id       uuid references public.trips(id) on delete set null,
  subscriber_id uuid references public.subscribers(id) on delete set null,
  provider      text not null,                       -- moyasar | tap | generic | ...
  provider_ref  text not null,                        -- معرّف العملية لدى المزوّد (للتمييز ومنع التكرار)
  amount        numeric(10,2),
  currency      text default 'SAR',
  status        text not null default 'paid',
  raw           jsonb,
  created_at    timestamptz not null default now()
);
create unique index if not exists uniq_payment_provider_ref on public.payments(provider, provider_ref);
create index if not exists idx_payments_passenger on public.payments(passenger_id);
create index if not exists idx_payments_subscriber on public.payments(subscriber_id);
alter table public.payments enable row level security;
-- المالك يقرأ مدفوعات حملته، والإدارة الكلّ؛ لا كتابةٌ من العميل (الـ Webhook يكتب بـ service_role متجاوزًا RLS)
drop policy if exists "payments owner read" on public.payments;
create policy "payments owner read" on public.payments for select
  using (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()));
drop policy if exists "payments admin read" on public.payments;
create policy "payments admin read" on public.payments for select using (public.my_role() = 'admin');

-- ============================================================
--  الفنادق والغرف (التسكين) — يحوّل ملبّيك إلى حلٍّ كامل: نقلٌ + سكن
-- ============================================================
create table if not exists public.hotels (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  trip_id       uuid not null references public.trips(id) on delete cascade,
  name          text not null,
  city          text default 'مكة المكرمة',
  check_in      date,
  check_out     date,
  distance_text text,                                                  -- مثل "٢٠٠م من الحرم"
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_hotels_trip on public.hotels(trip_id);

create table if not exists public.hotel_rooms (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  trip_id       uuid not null references public.trips(id) on delete cascade,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  room_number   text not null,
  capacity      int  not null default 2 check (capacity > 0),
  gender        text not null default 'mixed' check (gender in ('male','female','mixed')),
  notes         text,
  created_at    timestamptz not null default now(),
  unique (hotel_id, room_number)
);
create index if not exists idx_hotel_rooms_hotel on public.hotel_rooms(hotel_id);

-- ربط الراكب بالغرفة (FK اختياريّ — تُسنَد عند التسكين)
alter table public.passengers add column if not exists room_id uuid references public.hotel_rooms(id) on delete set null;
create index if not exists idx_passengers_room on public.passengers(room_id);

alter table public.hotels      enable row level security;
alter table public.hotel_rooms enable row level security;
-- المالك يدير فنادق حملته بالكامل
drop policy if exists "hotels owner manage" on public.hotels;
create policy "hotels owner manage" on public.hotels for all
  using      (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()))
  with check (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()));
-- العميل ضمن الحملة يقرأ فنادق الرحلات غير المسوّدة (للعرض في تذكرته)
drop policy if exists "hotels customer read" on public.hotels;
create policy "hotels customer read" on public.hotels for select
  using (subscriber_id = public.my_subscriber_id()
         and exists (select 1 from public.trips t where t.id = trip_id and t.status <> 'draft'));
-- الإدارة تقرأ الكل
drop policy if exists "hotels admin read" on public.hotels;
create policy "hotels admin read" on public.hotels for select using (public.my_role() = 'admin');

drop policy if exists "rooms owner manage" on public.hotel_rooms;
create policy "rooms owner manage" on public.hotel_rooms for all
  using      (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()))
  with check (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()));
drop policy if exists "rooms customer read" on public.hotel_rooms;
create policy "rooms customer read" on public.hotel_rooms for select
  using (subscriber_id = public.my_subscriber_id()
         and exists (select 1 from public.trips t where t.id = trip_id and t.status <> 'draft'));
drop policy if exists "rooms admin read" on public.hotel_rooms;
create policy "rooms admin read" on public.hotel_rooms for select using (public.my_role() = 'admin');

-- ============================================================
--  سجلّ التدقيق — مصدرُ حقيقةٍ لمن غيّر ماذا متى (لا يُمكن تخطّيه)
-- ============================================================
create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references auth.users(id) on delete set null,
  actor_email   text,                                                -- لقطةٌ لحظة التسجيل
  actor_role    text,                                                -- 'admin' | 'subscriber' | 'customer' | 'system'
  subscriber_id uuid references public.subscribers(id) on delete cascade,
  trip_id       uuid references public.trips(id) on delete set null,
  entity        text not null,                                       -- passenger | trip | bus | hotel | room
  entity_id     uuid,
  entity_label  text,                                                -- لقطةٌ نصّيّةٌ للعرض (الاسم/الرقم)
  action        text not null,                                       -- create | update | delete | status_change | seat_assign | room_assign | payment_confirmed
  changes       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_audit_subscriber on public.audit_logs(subscriber_id, created_at desc);
create index if not exists idx_audit_trip       on public.audit_logs(trip_id, created_at desc);
create index if not exists idx_audit_entity     on public.audit_logs(entity, entity_id);

alter table public.audit_logs enable row level security;
-- المالك يقرأ سجلّ حملته فقط
drop policy if exists "audit owner read" on public.audit_logs;
create policy "audit owner read" on public.audit_logs for select
  using (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()));
-- الإدارة تقرأ الكلّ
drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs for select using (public.my_role() = 'admin');
-- لا كتابة من العميل: التريغرات تكتب بـ SECURITY DEFINER وتتجاوز RLS.

-- ★ helper: يلتقط بيانات المُنفِّذ من JWT (يصلح للسياقات الموثوقة بـ actor_id=null)
create or replace function public.audit_actor()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text; v_role text;
begin
  if auth.uid() is null then
    return jsonb_build_object('actor_id', null, 'actor_email', null, 'actor_role', 'system');
  end if;
  select email into v_email from auth.users where id = auth.uid();
  v_role := coalesce(public.my_role()::text, 'unknown');
  return jsonb_build_object('actor_id', auth.uid(), 'actor_email', v_email, 'actor_role', v_role);
end $$;

-- ★ تريغر: سجلّ تغييرات passengers
create or replace function public.audit_passenger_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a jsonb := public.audit_actor();
  v_changes jsonb := '{}'::jsonb;
  v_action text;
  v_sub uuid; v_trip uuid; v_eid uuid; v_label text;
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_sub := new.subscriber_id; v_trip := new.trip_id; v_eid := new.id;
    v_label := new.full_name;
    v_changes := jsonb_build_object('seat_no', new.seat_no, 'status', new.status);
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
    v_sub := old.subscriber_id; v_trip := old.trip_id; v_eid := old.id;
    v_label := old.full_name;
    v_changes := jsonb_build_object('seat_no', old.seat_no, 'status', old.status);
  else
    if new.status     is distinct from old.status     then v_changes := v_changes || jsonb_build_object('status',  jsonb_build_object('old', old.status,  'new', new.status));  end if;
    if new.seat_no    is distinct from old.seat_no    then v_changes := v_changes || jsonb_build_object('seat_no', jsonb_build_object('old', old.seat_no, 'new', new.seat_no)); end if;
    if new.bus_id     is distinct from old.bus_id     then v_changes := v_changes || jsonb_build_object('bus_id',  jsonb_build_object('old', old.bus_id,  'new', new.bus_id));  end if;
    if new.room_id    is distinct from old.room_id    then v_changes := v_changes || jsonb_build_object('room_id', jsonb_build_object('old', old.room_id, 'new', new.room_id)); end if;
    if new.amount     is distinct from old.amount     then v_changes := v_changes || jsonb_build_object('amount',  jsonb_build_object('old', old.amount,  'new', new.amount));  end if;
    if new.paid_at    is distinct from old.paid_at    then v_changes := v_changes || jsonb_build_object('paid_at', jsonb_build_object('old', old.paid_at, 'new', new.paid_at)); end if;
    if new.payment_proof_url is distinct from old.payment_proof_url then v_changes := v_changes || jsonb_build_object('payment_proof_url', jsonb_build_object('old', old.payment_proof_url, 'new', new.payment_proof_url)); end if;
    if v_changes = '{}'::jsonb then return new; end if;
    v_action := case
      when new.status  is distinct from old.status  then (case when new.status = 'paid' then 'payment_confirmed' else 'status_change' end)
      when new.seat_no is distinct from old.seat_no then 'seat_assign'
      when new.bus_id  is distinct from old.bus_id  then 'bus_assign'
      when new.room_id is distinct from old.room_id then 'room_assign'
      when new.amount  is distinct from old.amount  then 'amount_change'
      when new.payment_proof_url is distinct from old.payment_proof_url then
        (case when new.payment_proof_url is not null then 'proof_attached' else 'proof_removed' end)
      else 'update'
    end;
    v_sub := new.subscriber_id; v_trip := new.trip_id; v_eid := new.id;
    v_label := new.full_name;
  end if;

  insert into public.audit_logs (actor_id, actor_email, actor_role, subscriber_id, trip_id, entity, entity_id, entity_label, action, changes)
  values ((a->>'actor_id')::uuid, a->>'actor_email', a->>'actor_role', v_sub, v_trip, 'passenger', v_eid, v_label, v_action, v_changes);
  return coalesce(new, old);
end $$;
drop trigger if exists trg_audit_passenger on public.passengers;
create trigger trg_audit_passenger
  after insert or update or delete on public.passengers
  for each row execute function public.audit_passenger_change();

-- ★ تريغر: سجلّ تغييرات trips (للحالة/السعر/السعة فقط — تجنّب الضوضاء)
create or replace function public.audit_trip_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare a jsonb := public.audit_actor(); v_changes jsonb := '{}'::jsonb; v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
    insert into public.audit_logs (actor_id, actor_email, actor_role, subscriber_id, trip_id, entity, entity_id, entity_label, action, changes)
    values ((a->>'actor_id')::uuid, a->>'actor_email', a->>'actor_role', new.subscriber_id, new.id, 'trip', new.id, new.title, 'create',
            jsonb_build_object('status', new.status, 'price', new.price));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs (actor_id, actor_email, actor_role, subscriber_id, trip_id, entity, entity_id, entity_label, action, changes)
    values ((a->>'actor_id')::uuid, a->>'actor_email', a->>'actor_role', old.subscriber_id, old.id, 'trip', old.id, old.title, 'delete',
            jsonb_build_object('status', old.status));
    return old;
  else
    if new.status   is distinct from old.status   then v_changes := v_changes || jsonb_build_object('status',   jsonb_build_object('old', old.status,   'new', new.status));   end if;
    if new.price    is distinct from old.price    then v_changes := v_changes || jsonb_build_object('price',    jsonb_build_object('old', old.price,    'new', new.price));    end if;
    if new.capacity is distinct from old.capacity then v_changes := v_changes || jsonb_build_object('capacity', jsonb_build_object('old', old.capacity, 'new', new.capacity)); end if;
    if v_changes = '{}'::jsonb then return new; end if;
    v_action := case when new.status is distinct from old.status then 'status_change' else 'update' end;
    insert into public.audit_logs (actor_id, actor_email, actor_role, subscriber_id, trip_id, entity, entity_id, entity_label, action, changes)
    values ((a->>'actor_id')::uuid, a->>'actor_email', a->>'actor_role', new.subscriber_id, new.id, 'trip', new.id, new.title, v_action, v_changes);
    return new;
  end if;
end $$;
drop trigger if exists trg_audit_trip on public.trips;
create trigger trg_audit_trip
  after insert or update or delete on public.trips
  for each row execute function public.audit_trip_change();

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
-- مسار صورة إثبات الدفع (لقطة إتمام الطلب من متجر زد/سلة) في bucket خاصّ
alter table public.passengers add column if not exists payment_proof_url text;
create index if not exists idx_passengers_profile on public.passengers(profile_id);
-- رابط المتجر الخارجي للمشترك (سلة/زد) لخطوة الدفع
alter table public.subscribers add column if not exists store_url text;

-- ============================================================
--  تعدّد الباصات في الرحلة (المرحلة ١: أساسٌ خلفيٌّ متوافقٌ تمامًا)
--  كلّ رحلةٍ تملك باصًا واحدًا على الأقلّ. الرحلات الحالية تُهاجَر إلى
--  "باص ١" يعكس تخطيطها الحالي (bus_rows/bus_back_row/seating_policy).
-- ============================================================
create table if not exists public.trip_buses (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references public.trips(id) on delete cascade,
  subscriber_id  uuid not null references public.subscribers(id) on delete cascade,
  bus_number     int  not null default 1,
  label          text,
  plate          text,
  bus_rows       int  not null default 11,
  bus_back_row   int  not null default 5,
  seating_policy text not null default 'all_male',
  created_at     timestamptz not null default now()
);
create index if not exists idx_trip_buses_trip on public.trip_buses(trip_id, bus_number);
create unique index if not exists uniq_trip_bus_number on public.trip_buses(trip_id, bus_number);

-- migration: نسخ تخطيط كلّ رحلةٍ حاليّةٍ إلى باصٍ رقم ١ (مرّة واحدة، idempotent)
insert into public.trip_buses (trip_id, subscriber_id, bus_number, label, plate, bus_rows, bus_back_row, seating_policy)
select t.id, t.subscriber_id, 1, t.bus_label, t.bus_plate,
       coalesce(t.bus_rows, 11), coalesce(t.bus_back_row, 5), coalesce(t.seating_policy, 'all_male')
from public.trips t
where not exists (select 1 from public.trip_buses b where b.trip_id = t.id and b.bus_number = 1);

-- ربط الراكب بباصٍ معيّن (افتراضيًّا باص ١ — يُسنَد تلقائيًّا عبر الحارس)
alter table public.passengers add column if not exists bus_id uuid references public.trip_buses(id) on delete set null;
create index if not exists idx_passengers_bus on public.passengers(bus_id);
-- فهرس أداءٍ لإحصاءات الإدارة/المالك وتجميع التحصيل (مرشّحٌ على subscriber_id + status)
create index if not exists idx_passengers_subscriber_status on public.passengers(subscriber_id, status);
-- backfill: كلّ راكبٍ حاليٍّ ينتمي إلى باص ١ في رحلته
update public.passengers p set bus_id = b.id
from public.trip_buses b
where b.trip_id = p.trip_id and b.bus_number = 1 and p.bus_id is null;

-- استبدال فهرس تفرّد المقعد ليصبح على مستوى (رحلة، باص، مقعد)
drop index if exists public.uniq_passengers_trip_seat;
create unique index if not exists uniq_passengers_trip_bus_seat
  on public.passengers(trip_id, bus_id, seat_no) where seat_no is not null;

alter table public.trip_buses enable row level security;
drop policy if exists "trip_buses owner manage" on public.trip_buses;
create policy "trip_buses owner manage" on public.trip_buses for all
  using      (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()))
  with check (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()));
drop policy if exists "trip_buses customer read" on public.trip_buses;
create policy "trip_buses customer read" on public.trip_buses for select
  using (subscriber_id = public.my_subscriber_id());
drop policy if exists "trip_buses admin read" on public.trip_buses;
create policy "trip_buses admin read" on public.trip_buses for select using (public.my_role() = 'admin');

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
alter table public.customers add column if not exists pickup_location text;  -- مكانٌ افتراضيٌّ للركوب (يُملأ في حجوزاته)
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
  -- سياقٌ موثوقٌ محصور: دوالّ إدارة الفريق (SECURITY DEFINER) تضبط هذا العلَم
  -- محلّيًّا داخل معاملتها لتُسند دور/حملة العضو. العميل لا يملك مسارًا لضبطه.
  if current_setting('malbeek.trusted', true) = '1' then return new; end if;
  -- يُجمَّد الدور/الربط فقط لمستخدمٍ مصدَّقٍ فعليٍّ غير admin.
  -- السياقات الموثوقة بلا JWT (محرّر SQL / service_role) تستطيع التهيئة وإنشاء أوّل admin —
  -- وهذا لا يمنح المستخدم العاديّ شيئًا (auth.uid() لديه غير فارغٍ دائمًا فيبقى مُجمَّدًا).
  if auth.uid() is not null and coalesce(public.my_role(), 'customer') <> 'admin' then
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
  -- تطبيع جوال التواصل عند تغيّره (يُعيد استخدام دالّة الجوال المشتركة)
  if new.contact_phone is distinct from old.contact_phone then
    new.contact_phone := public.norm_sa_phone(new.contact_phone);
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
-- العميل لا يرى المسوّدات (drafts) — يحجب نسخ الفوج التالي قبل أن يفتحها المالك
create policy "trips customer read scoped" on public.trips for select
  using (subscriber_id = public.my_subscriber_id() and status <> 'draft');
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
     and not public.can_manage_sub(old.subscriber_id) then
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
--  p_bus اختياري: عند تمريره يُرجع إشغال ذلك الباص فقط؛ وإلّا كلّ الرحلة (سلوك المرحلة ١).
drop function if exists public.trip_seat_occupancy(uuid);
create or replace function public.trip_seat_occupancy(p_trip uuid, p_bus uuid default null)
returns table(seat_no text, gender text, is_family boolean)
language sql stable security definer set search_path = public as $$
  select p.seat_no, p.gender, p.is_family
  from public.passengers p
  join public.trips t on t.id = p.trip_id
  where p.trip_id = p_trip
    and p.seat_no is not null
    and (p_bus is null or p.bus_id = p_bus)
    and (
      public.can_manage_sub(t.subscriber_id)
      or t.subscriber_id = public.my_subscriber_id()
      or public.my_role() = 'admin'
    );
$$;
revoke all on function public.trip_seat_occupancy(uuid, uuid) from public;
grant execute on function public.trip_seat_occupancy(uuid, uuid) to authenticated;

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

-- ★ تحقّق منطق الرحلة + تطبيع أرقام الطاقم (عند الإدراج أو تغيّر القيمة فقط — لا يكسر بياناتٍ قديمة)
create or replace function public.validate_trip()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- السعة غير سالبة (عند الإدراج أو تغيّرها فقط)
  if (tg_op = 'INSERT' or new.capacity is distinct from old.capacity)
     and new.capacity is not null and new.capacity < 0 then
    new.capacity := 0;
  end if;

  -- التواريخ: العودة بعد الذهاب
  if tg_op = 'INSERT' then
    if new.depart_at is not null and new.return_at is not null and new.return_at < new.depart_at then
      raise exception 'تاريخ العودة يجب أن يكون بعد تاريخ الذهاب.';
    end if;
    new.driver_phone     := public.norm_sa_phone(new.driver_phone);
    new.assistant_phone  := public.norm_sa_phone(new.assistant_phone);
    new.supervisor_phone := public.norm_sa_phone(new.supervisor_phone);
  else
    if new.depart_at is distinct from old.depart_at or new.return_at is distinct from old.return_at then
      if new.depart_at is not null and new.return_at is not null and new.return_at < new.depart_at then
        raise exception 'تاريخ العودة يجب أن يكون بعد تاريخ الذهاب.';
      end if;
    end if;
    if new.driver_phone     is distinct from old.driver_phone     then new.driver_phone     := public.norm_sa_phone(new.driver_phone);     end if;
    if new.assistant_phone  is distinct from old.assistant_phone  then new.assistant_phone  := public.norm_sa_phone(new.assistant_phone);  end if;
    if new.supervisor_phone is distinct from old.supervisor_phone then new.supervisor_phone := public.norm_sa_phone(new.supervisor_phone); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_validate_trip on public.trips;
create trigger trg_validate_trip
  before insert or update on public.trips
  for each row execute function public.validate_trip();

-- ★ كلّ رحلةٍ جديدةٍ تحصل على "باص ١" تلقائيًّا يعكس تخطيطها (أساس تعدّد الباصات)
create or replace function public.ensure_primary_bus()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_buses (trip_id, subscriber_id, bus_number, label, plate, bus_rows, bus_back_row, seating_policy)
  values (new.id, new.subscriber_id, 1, new.bus_label, new.bus_plate,
          coalesce(new.bus_rows, 11), coalesce(new.bus_back_row, 5), coalesce(new.seating_policy, 'all_male'))
  on conflict (trip_id, bus_number) do nothing;
  return new;
end $$;
drop trigger if exists trg_ensure_primary_bus on public.trips;
create trigger trg_ensure_primary_bus
  after insert on public.trips
  for each row execute function public.ensure_primary_bus();

-- ★ مزامنة "باص ١" مع تعديلات تخطيط الرحلة (BusEditor يكتب في trips في المرحلة ١)
create or replace function public.sync_primary_bus()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.bus_rows is distinct from old.bus_rows
     or new.bus_back_row is distinct from old.bus_back_row
     or new.seating_policy is distinct from old.seating_policy
     or new.bus_label is distinct from old.bus_label
     or new.bus_plate is distinct from old.bus_plate then
    update public.trip_buses set
      bus_rows = coalesce(new.bus_rows, bus_rows),
      bus_back_row = coalesce(new.bus_back_row, bus_back_row),
      seating_policy = coalesce(new.seating_policy, seating_policy),
      label = new.bus_label, plate = new.bus_plate
    where trip_id = new.id and bus_number = 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_sync_primary_bus on public.trips;
create trigger trg_sync_primary_bus
  after update on public.trips
  for each row execute function public.sync_primary_bus();

-- ============================================================
--  ★ حارس أعمدة الراكب: يمنع العميل من تزوير الحالة/الحضور أو نقل حجزه،
--    ويتحقّق أنّ المقعد ضمن تخطيط الباص. (المالك/الإدارة بلا قيد)
-- ============================================================
create or replace function public.guard_passenger_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner boolean;
  v_total int;
  v_cap int;
  v_room_gender text;
  v_used int;
  v_trip_status trip_status;
  v_trip_depart timestamptz;
begin
  -- المالك أو عضوُ الفريق أو الإدارة = سلطةٌ تشغيليّة (ليس عميلًا).
  select (public.can_manage_sub(new.subscriber_id) or public.my_role() = 'admin') into v_owner;

  -- ★ دورة حياة الرحلة: لا يُنشئ العميلُ حجزًا في رحلةٍ غير مفتوحةٍ أو فات موعدها.
  --   (المالك/الإدارة مستثنون لإدارةٍ تشغيليّةٍ كاملة، والتعديل/الإلغاء غير محظور.)
  if not v_owner and tg_op = 'INSERT' then
    select status, depart_at into v_trip_status, v_trip_depart from public.trips where id = new.trip_id;
    if v_trip_status is distinct from 'open' then
      raise exception 'TRIP_NOT_BOOKABLE' using hint = 'الحجز مغلقٌ على هذه الرحلة حاليًّا.';
    end if;
    if v_trip_depart is not null and v_trip_depart < now() then
      raise exception 'TRIP_DEPARTED' using hint = 'انطلقت هذه الرحلة — تعذّر الحجز.';
    end if;
  end if;

  -- إسناد/تحقّق الباص: يجب أن ينتمي الباص للرحلة نفسها؛ وإلّا (أو إن كان فارغًا)
  -- يُربط الراكب بأوّل باصٍ في الرحلة. يمنع إسناد باصٍ من رحلةٍ أخرى (تماسك البيانات).
  if new.bus_id is null or not exists (
       select 1 from public.trip_buses where id = new.bus_id and trip_id = new.trip_id) then
    select id into new.bus_id from public.trip_buses
     where trip_id = new.trip_id order by bus_number asc limit 1;
  end if;

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

  -- نطاق المقعد ضمن تخطيط الباص المُسنَد (يسري على الجميع) — يقرأ من باص الراكب لا من الرحلة
  if new.seat_no is not null and new.seat_no ~ '^[0-9]+$' then
    select (b.bus_rows * 4 + b.bus_back_row) into v_total from public.trip_buses b where b.id = new.bus_id;
    if v_total is not null and (new.seat_no::int < 1 or new.seat_no::int > v_total) then
      raise exception 'SEAT_OUT_OF_RANGE' using hint = 'رقم المقعد خارج تخطيط الباص.';
    end if;
  end if;

  -- ★ التسكين: تحقّق سعة الغرفة + توافق الجنس + انتماء الغرفة للرحلة نفسها.
  --   نقفل صفّ الغرفة بـ FOR UPDATE لتفادي تجاوز السعة عند إسنادين متوازيين.
  if new.room_id is not null and (tg_op = 'INSERT' or new.room_id is distinct from old.room_id) then
    declare v_room_trip uuid;
    begin
      select capacity, gender, trip_id into v_cap, v_room_gender, v_room_trip
        from public.hotel_rooms where id = new.room_id for update;
      if v_room_trip is distinct from new.trip_id then
        raise exception 'ROOM_TRIP_MISMATCH' using hint = 'الغرفة لا تنتمي لهذه الرحلة.';
      end if;
      if v_room_gender = 'male'   and new.gender = 'female' then
        raise exception 'ROOM_GENDER_MISMATCH' using hint = 'هذه الغرفة مخصّصةٌ للرجال.';
      end if;
      if v_room_gender = 'female' and new.gender = 'male'   then
        raise exception 'ROOM_GENDER_MISMATCH' using hint = 'هذه الغرفة مخصّصةٌ للنساء.';
      end if;
      select count(*) into v_used from public.passengers
        where room_id = new.room_id and id <> new.id;
      if v_used >= v_cap then
        raise exception 'ROOM_FULL' using hint = 'الغرفة مكتملةٌ (' || v_cap || ' أشخاص).';
      end if;
    end;
  end if;

  -- العميل لا يرفع حالته ذاتيًّا ولا يزوّر الحضور ولا ينقل حجزه.
  -- يُطبَّق على مستخدمٍ مصدَّقٍ فعليّ فقط (auth.uid() غير فارغ)؛ السياقات الموثوقة بلا JWT
  -- (service_role لبوّابة الدفع / محرّر SQL) معفاةٌ لتأكيد الدفع آليًّا — والعميل دائمًا مصدَّقٌ فيبقى محروسًا.
  if auth.uid() is not null and not v_owner then
    if tg_op = 'INSERT' then
      new.status := 'registered';
      new.boarded_at := null;
      new.checked_in_at := null;
      new.amount := null;            -- العميل لا يضبط مبلغًا/ختم دفعٍ بنفسه
      new.paid_at := null;
      new.room_id := null;            -- التسكين قرارٌ تشغيليٌّ من المالك فقط
    else
      new.status        := old.status;
      new.trip_id       := old.trip_id;
      new.subscriber_id := old.subscriber_id;
      new.profile_id    := old.profile_id;
      new.boarded_at    := old.boarded_at;
      new.checked_in_at := old.checked_in_at;
      new.amount        := old.amount;     -- حقولٌ ماليّةٌ محميّةٌ من تلاعب العميل
      new.paid_at       := old.paid_at;
      new.room_id       := old.room_id;    -- التسكين قرارُ المالك
    end if;
  end if;

  -- ختم التحصيل تلقائيًّا عند الانتقال إلى "مدفوع" (للجميع — لكنّ العميل لا يبلغ هذه الحالة)
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    if new.paid_at is null then new.paid_at := now(); end if;
    if new.amount is null then
      select price into new.amount from public.trips where id = new.trip_id;
    end if;
  elsif tg_op = 'UPDATE' and new.status <> 'paid' and old.status = 'paid' then
    new.paid_at := null;   -- التراجع عن التأكيد يُلغي ختم الدفع
  end if;

  return new;
end $$;
drop trigger if exists trg_guard_passengers on public.passengers;
create trigger trg_guard_passengers
  before insert or update on public.passengers
  for each row execute function public.guard_passenger_columns();

-- ---------- passengers customer delete (لإلغاء حجزه ذاتيًّا) ----------
-- العميل يُلغي حجزه غير المدفوع فقط؛ الحجوزات المدفوعة/المصعّدة تُلغى عبر الحملة (حمايةً للسجلّ المالي).
drop policy if exists "passengers customer delete" on public.passengers;
create policy "passengers customer delete" on public.passengers for delete
  using (profile_id = auth.uid() and status = 'registered');

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
alter table public.feedback add column if not exists attachment_url text;  -- لقطةُ شاشةٍ للخطأ (اختياريّة)
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
      new.subscriber_id := public.my_managed_subscriber_id();
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
revoke all on function public.unread_notifications_count() from public;
grant execute on function public.unread_notifications_count() to authenticated;

-- ★ نظرةٌ تشغيليّةٌ وماليّةٌ للإدارة عبر كلّ الحملات (مقصورةٌ على admin، SECURITY DEFINER)
create or replace function public.admin_campaign_stats()
returns table(
  subscriber_id uuid, org_name text, slug text, plan plan_type,
  trips_count int, pax_count int, paid_count int, collected numeric, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id, s.org_name, s.slug, s.plan,
    (select count(*)::int from public.trips t where t.subscriber_id = s.id),
    (select count(*)::int from public.passengers p where p.subscriber_id = s.id),
    (select count(*)::int from public.passengers p
       where p.subscriber_id = s.id and p.status in ('paid','boarded','checked_in')),
    (select coalesce(sum(p.amount),0) from public.passengers p
       where p.subscriber_id = s.id and p.status in ('paid','boarded','checked_in')),
    s.created_at
  from public.subscribers s
  where public.my_role() = 'admin'      -- غير الأدمن: لا صفوف (رغم SECURITY DEFINER)
  order by s.created_at desc;
$$;
revoke all on function public.admin_campaign_stats() from public;
grant execute on function public.admin_campaign_stats() to authenticated;

-- ★ استنساخُ رحلةٍ (مع باصاتها) — مع إزاحة التواريخ ولاحقة الاسم.
--   لا يستنسخ الركّاب ولا قائمة الانتظار ولا المدفوعات (يبدأ "فوجًا جديدًا").
--   مقيّدٌ بمالك الحملة فقط. يحترم enforce_trial_trip_limit عبر تريغر INSERT.
--   يُرجع الصفّ كاملًا ليفتحه المالك في الواجهة بلا قراءةٍ إضافيّة.
-- DROP أوّلًا لأنّ نوع الإرجاع تغيّر من uuid إلى trips (PostgreSQL يمنع تغييره عبر REPLACE).
-- بعد DROP لا حاجة لـ `or replace` — الدالّة معدومة.
drop function if exists public.duplicate_trip(uuid, text, int);
create function public.duplicate_trip(
  p_trip_id uuid, p_name_suffix text default ' — نسخة',
  p_shift_days int default 0
) returns public.trips language plpgsql security definer set search_path = public as $$
declare v_old public.trips; v_new public.trips; v_owner boolean;
begin
  select * into v_old from public.trips where id = p_trip_id;
  if not found then
    raise exception 'TRIP_NOT_FOUND' using hint = 'الرحلة غير موجودة.';
  end if;

  -- مالك الحملة أو عضوُ فريقها (أو الإدارة)
  select (public.can_manage_sub(v_old.subscriber_id) or public.my_role() = 'admin') into v_owner;
  if not v_owner then
    raise exception 'NOT_AUTHORIZED' using hint = 'غير مصرّحٍ بهذه العمليّة.';
  end if;

  insert into public.trips (
    subscriber_id, title, route_from, route_to,
    depart_at, return_at, capacity, bus_label, boarding_point,
    status, notes,
    bus_plate, driver_name, driver_phone, assistant_name, assistant_phone,
    supervisor_name, supervisor_phone,
    seating_policy, bus_rows, bus_back_row, price
  ) values (
    v_old.subscriber_id,
    coalesce(v_old.title,'رحلة') || coalesce(p_name_suffix,''),
    v_old.route_from, v_old.route_to,
    -- null + interval = null; ts + '0 days' = ts → لا حاجة لـ CASE
    v_old.depart_at + (p_shift_days || ' days')::interval,
    v_old.return_at + (p_shift_days || ' days')::interval,
    v_old.capacity, v_old.bus_label, v_old.boarding_point,
    'draft', v_old.notes,                          -- ابدأ مسودّة، يفتحها المالك عند الجاهزيّة
    v_old.bus_plate, v_old.driver_name, v_old.driver_phone,
    v_old.assistant_name, v_old.assistant_phone,
    v_old.supervisor_name, v_old.supervisor_phone,
    v_old.seating_policy, v_old.bus_rows, v_old.bus_back_row, v_old.price
  ) returning * into v_new;

  -- استنساخ الباصات. ON CONFLICT DO NOTHING يحفظ ذرّيًّا تعايشَ تريغر ensure_primary_bus
  -- (الذي ينشئ الباص ١ تلقائيًّا) دون اقترانٍ خفيٍّ على bus_number > 1.
  insert into public.trip_buses (trip_id, subscriber_id, bus_number, label, plate, bus_rows, bus_back_row, seating_policy)
  select v_new.id, b.subscriber_id, b.bus_number, b.label, b.plate, b.bus_rows, b.bus_back_row, b.seating_policy
  from public.trip_buses b
  where b.trip_id = p_trip_id
  on conflict (trip_id, bus_number) do nothing;

  return v_new;
end $$;
revoke all on function public.duplicate_trip(uuid, text, int) from public;
grant execute on function public.duplicate_trip(uuid, text, int) to authenticated;

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

-- ★ تريغر دورة حياة الرحلة: إغلاق الحجز/انتهاء الرحلة → إشعار كلّ معتمريها
create or replace function public.notify_trip_lifecycle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('closed','done') then
    insert into public.notifications(profile_id, audience, kind, title, body, ref_trip)
    select distinct p.profile_id, 'customer', 'trip_changed',
           case new.status when 'closed' then 'أُغلق الحجز على رحلتك'
                           else 'انتهت رحلتك — تقبّل الله طاعتكم' end,
           'رحلة «' || coalesce(new.title,'') || '»'
             || case new.status when 'closed' then ' — لم يعد الحجز متاحًا.'
                                else ' — نسأل الله أن يتقبّل منكم.' end,
           new.id
    from public.passengers p
    where p.trip_id = new.id and p.profile_id is not null;
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_trip_lifecycle on public.trips;
create trigger trg_notify_trip_lifecycle
  after update on public.trips
  for each row execute function public.notify_trip_lifecycle();

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

-- ============================================================
--  المرحلة ٧ — طلبات الاسترداد (إلغاء حجزٍ مدفوع)
--  عند إلغاء العميل حجزًا مدفوعًا يُفرَّغ المقعد ويُسجَّل طلب استردادٍ
--  لصاحب الحملة ليعالجه عبر متجره (زد/سلة). لقطةٌ ماليّةٌ للأثر.
-- ============================================================
create table if not exists public.refunds (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid not null references public.subscribers(id) on delete cascade,
  trip_id        uuid references public.trips(id) on delete set null,
  profile_id     uuid references public.profiles(id) on delete set null,
  passenger_name text,
  national_id    text,
  amount         numeric,
  status         text not null default 'requested'
                 check (status in ('requested','refunded','rejected')),
  reason         text,                                 -- سبب الإلغاء (من العميل)
  refund_ref     text,                                 -- مرجع/ملاحظة صاحب الحملة
  requested_at   timestamptz not null default now(),
  resolved_at    timestamptz
);
create index if not exists idx_refunds_subscriber on public.refunds(subscriber_id, status);
create index if not exists idx_refunds_profile    on public.refunds(profile_id);
-- قيد الحالة (idempotent) — يحمي دورة الحياة من قيمٍ حرّةٍ لو وُجد الجدول مسبقًا
do $$ begin
  alter table public.refunds add constraint refunds_status_chk check (status in ('requested','refunded','rejected'));
exception when duplicate_object then null; when duplicate_table then null; end $$;

alter table public.refunds enable row level security;
-- العميل: يقرأ طلباته فقط (الإنشاء يتمّ عبر RPC الموثوق أدناه)
drop policy if exists "refunds customer read" on public.refunds;
create policy "refunds customer read" on public.refunds for select using (profile_id = auth.uid());
-- صاحب الحملة: يقرأ ويعالج طلبات حملته
drop policy if exists "refunds owner read" on public.refunds;
create policy "refunds owner read" on public.refunds for select
  using (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()));
drop policy if exists "refunds owner update" on public.refunds;
create policy "refunds owner update" on public.refunds for update
  using      (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()))
  with check (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()));
-- الإدارة تقرأ الكل
drop policy if exists "refunds admin read" on public.refunds;
create policy "refunds admin read" on public.refunds for select using (public.my_role() = 'admin');

-- ★ حارس أعمدة: صاحب الحملة يحدّث الحالة/المرجع فقط، ولا يزوّر اللقطة الماليّة
create or replace function public.guard_refund_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(),'customer') <> 'admin' then
    new.subscriber_id  := old.subscriber_id;
    new.trip_id        := old.trip_id;
    new.profile_id     := old.profile_id;
    new.passenger_name := old.passenger_name;
    new.national_id    := old.national_id;
    new.amount         := old.amount;
    new.requested_at   := old.requested_at;
  end if;
  if new.status in ('refunded','rejected') and old.status = 'requested' and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_refunds on public.refunds;
create trigger trg_guard_refunds before update on public.refunds
  for each row execute function public.guard_refund_columns();

-- ★ إلغاء حجزٍ ذرّيٌّ آمن: يتحقّق من ملكيّة العميل، ويسجّل استردادًا للمدفوع،
--   ثمّ يحذف الراكب (يُفرَّغ المقعد). يعمل بصلاحيّاتٍ مرتفعةٍ مع فحصٍ صريح.
create or replace function public.cancel_booking(p_passenger uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_p public.passengers%rowtype;
  v_price numeric;
  v_refunded boolean := false;
begin
  -- FOR UPDATE: يُسلسِل نداءَي إلغاءٍ متزامنين على الحجز نفسه فيمنع تكرار سجلّ الاسترداد.
  select * into v_p from public.passengers where id = p_passenger for update;
  if not found then raise exception 'NOT_FOUND' using hint = 'الحجز غير موجود.'; end if;
  -- المالك (auth.uid) فقط، أو صاحب الحملة، أو الإدارة
  if not (v_p.profile_id = auth.uid()
          or public.can_manage_sub(v_p.subscriber_id)
          or public.my_role() = 'admin') then
    raise exception 'NOT_AUTHORIZED' using hint = 'غير مصرّحٍ لك بإلغاء هذا الحجز.';
  end if;

  if v_p.status in ('paid','boarded','checked_in') then
    select price into v_price from public.trips where id = v_p.trip_id;
    insert into public.refunds(subscriber_id, trip_id, profile_id, passenger_name, national_id, amount, reason)
    values (v_p.subscriber_id, v_p.trip_id, v_p.profile_id, v_p.full_name, v_p.national_id,
            coalesce(v_p.amount, v_price), nullif(btrim(coalesce(p_reason,'')), ''));
    v_refunded := true;
  end if;

  delete from public.passengers where id = p_passenger;
  return jsonb_build_object('refund_requested', v_refunded);
end $$;
revoke all on function public.cancel_booking(uuid, text) from public;
grant execute on function public.cancel_booking(uuid, text) to authenticated;

-- ★ تريغر إشعارات الاسترداد: طلبٌ جديد → صاحب الحملة · إتمامه → العميل
create or replace function public.notify_refund_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if tg_op = 'INSERT' then
    select owner_id into v_owner from public.subscribers where id = new.subscriber_id;
    if v_owner is not null then
      insert into public.notifications(profile_id, audience, kind, title, body, ref_trip)
      values (v_owner, 'subscriber', 'booking_canceled',
              'طلب استرداد: ' || coalesce(new.passenger_name,'معتمر'),
              'مبلغ ' || coalesce(new.amount::text,'—') || ' ﷼ — عالِجه عبر متجرك ثمّ علّمه «تمّ».',
              new.trip_id);
    end if;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.profile_id is not null then
    insert into public.notifications(profile_id, audience, kind, title, body, ref_trip)
    values (new.profile_id, 'customer', 'booking_canceled',
            case new.status when 'refunded' then 'تمّ ردّ مبلغك ✓' when 'rejected' then 'تحديثٌ على طلب الاسترداد' else 'تحديثٌ على طلب الاسترداد' end,
            case new.status when 'refunded' then 'أُعيد مبلغ ' || coalesce(new.amount::text,'') || ' ﷼ — تحقّق من وسيلة دفعك.' else 'يرجى التواصل مع الحملة لمزيدٍ من التفاصيل.' end,
            new.trip_id);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_notify_refunds on public.refunds;
create trigger trg_notify_refunds after insert or update on public.refunds
  for each row execute function public.notify_refund_change();

-- ★ تذكيرٌ جماعيّ: صاحب الحملة يُرسل إشعارًا لكلّ معتمري رحلته (قبل الانطلاق مثلًا).
--   صلاحيّةٌ مرتفعةٌ (العميل لا يملك insert على notifications) مع فحص ملكيّةٍ صريح.
create or replace function public.remind_trip(p_trip uuid, p_message text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int; v_title text; v_depart timestamptz; v_body text;
begin
  if not (exists (select 1 from public.trips t where t.id = p_trip and public.can_manage_sub(t.subscriber_id))
          or public.my_role() = 'admin') then
    raise exception 'NOT_AUTHORIZED' using hint = 'غير مصرّحٍ لك بهذا الإجراء.';
  end if;
  select title, depart_at into v_title, v_depart from public.trips where id = p_trip;
  v_body := coalesce(nullif(btrim(coalesce(p_message,'')), ''),
            'تذكيرٌ برحلتك «' || coalesce(v_title,'') || '»'
            || case when v_depart is not null then ' — الذهاب ' || to_char(v_depart, 'YYYY-MM-DD') else '' end
            || '. جهّز تذكرتك وكن على الموعد.');
  insert into public.notifications(profile_id, audience, kind, title, body, ref_trip)
  select distinct p.profile_id, 'customer', 'trip_changed', 'تذكيرٌ برحلتك', v_body, p_trip
  from public.passengers p
  where p.trip_id = p_trip and p.profile_id is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.remind_trip(uuid, text) from public;
grant execute on function public.remind_trip(uuid, text) to authenticated;

-- تفعيل البثّ الحيّ (Realtime) لتحديث المقاعد + التغذية الراجعة + الباقات
do $$ begin alter publication supabase_realtime add table public.passengers;  exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.feedback;    exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.subscribers; exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.trips;       exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.trip_buses;  exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.waitlist;      exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.hotels;        exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.hotel_rooms;   exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.refunds;       exception when duplicate_object then null; when others then null; end $$;

-- ============================================================
--  Storage — bucket لأختام المؤسّسات وشعاراتها (قراءةٌ عامّةٌ للعرض على الكشف،
--  كتابةٌ مقصورةٌ على المالك داخل مجلّدٍ باسم subscriber_id الخاصّ به).
-- ============================================================
-- SVG مرفوضٌ عمدًا: يستطيع حمل سكربتاتٍ تُنفَّذ عند فتح الرابط مباشرةً (XSS).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-assets', 'org-assets', true, 2097152,                      -- ٢ ميغابايت
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "org-assets public read" on storage.objects;
create policy "org-assets public read" on storage.objects for select
  using (bucket_id = 'org-assets');

drop policy if exists "org-assets owner write" on storage.objects;
create policy "org-assets owner write" on storage.objects for insert
  with check (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1] in (
      select id::text from public.subscribers where public.can_manage_sub(id)
    )
  );

drop policy if exists "org-assets owner update" on storage.objects;
create policy "org-assets owner update" on storage.objects for update
  using (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1] in (
      select id::text from public.subscribers where public.can_manage_sub(id)
    )
  )
  with check (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1] in (
      select id::text from public.subscribers where public.can_manage_sub(id)
    )
  );

drop policy if exists "org-assets owner delete" on storage.objects;
create policy "org-assets owner delete" on storage.objects for delete
  using (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1] in (
      select id::text from public.subscribers where public.can_manage_sub(id)
    )
  );

-- ============================================================
--  Storage — مرفقات الملاحظات (لقطات الخطأ). bucket خاصٌّ (غير عام):
--  المستخدم يرفع داخل مجلّدٍ باسم profile_id الخاصّ به، يقرأ مرفقاته فقط،
--  والإدارة تقرأ كلّ المرفقات (للمساعدة في حلّ المشكلة).
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-attachments', 'feedback-attachments', false, 5242880,        -- ٥ ميغابايت
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "feedback-attach self read" on storage.objects;
create policy "feedback-attach self read" on storage.objects for select
  using (
    bucket_id = 'feedback-attachments'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.my_role() = 'admin')
  );

drop policy if exists "feedback-attach self write" on storage.objects;
create policy "feedback-attach self write" on storage.objects for insert
  with check (
    bucket_id = 'feedback-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "feedback-attach self delete" on storage.objects;
create policy "feedback-attach self delete" on storage.objects for delete
  using (
    bucket_id = 'feedback-attachments'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.my_role() = 'admin')
  );

-- ============================================================
--  Storage — إثبات الدفع (لقطة إتمام طلب المتجر). bucket خاصٌّ:
--  المسار = {subscriber_id}/{auth.uid}/ملف. المعتمر يرفع/يقرأ مجلّده فقط،
--  وصاحب الحملة يقرأ كلّ إثباتات معتمري حملته، والإدارة الكلّ.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880,                      -- ٥ ميغابايت
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pay-proof read" on storage.objects;
create policy "pay-proof read" on storage.objects for select
  using (
    bucket_id = 'payment-proofs'
    and (
      (storage.foldername(name))[2] = auth.uid()::text                                          -- المعتمر: مجلّده فقط
      or (public.my_role() = 'subscriber' and (storage.foldername(name))[1] = public.my_subscriber_id()::text)  -- صاحب الحملة: حملته
      or public.my_role() = 'admin'
    )
  );

drop policy if exists "pay-proof write" on storage.objects;
create policy "pay-proof write" on storage.objects for insert
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[1] = public.my_subscriber_id()::text
  );

drop policy if exists "pay-proof delete" on storage.objects;
create policy "pay-proof delete" on storage.objects for delete
  using (
    bucket_id = 'payment-proofs'
    and ((storage.foldername(name))[2] = auth.uid()::text or public.my_role() = 'admin')
  );

-- ============================================================
--  دالّةٌ عامّةٌ لصفحة انضمام العميل: تحوّل slug واحدًا إلى اسم الحملة.
--  بديلٌ آمنٌ عن العرض العام السابق الذي كان يكشف كلّ المشتركين لـ anon
--  (تعدادٌ للمستأجرين). الآن تُرجع صفًّا واحدًا فقط مطابقًا للـ slug،
--  ولا تكشف بقيّة المكاتب. SECURITY DEFINER لتجاوز RLS بأمانٍ مضبوط.
-- ============================================================
drop view if exists public.public_subscribers;
create or replace function public.subscriber_by_slug(p_slug text)
returns table (id uuid, org_name text)
language sql
security definer
set search_path = public
stable
as $$
  select s.id, s.org_name
  from public.subscribers s
  where s.slug = p_slug
  limit 1;
$$;
revoke all on function public.subscriber_by_slug(text) from public;
grant execute on function public.subscriber_by_slug(text) to anon, authenticated;

-- ============================================================
--  (اختياري) ترقية مستخدم إلى إدارة بعد إنشائه من لوحة Supabase Auth:
--  update public.profiles set role = 'admin' where id = '<USER_UUID>';
-- ============================================================

-- ============================================================
--  المرحلة ٨ — وصول فريق الحملة (سياساتٌ إضافيّةٌ + دوالّ إدارة الأعضاء)
--  إضافيّةٌ بحتة: تمنح أعضاء الفريق (manager/staff) صلاحيّةً تشغيليّةً كاملة
--  عبر can_manage_sub دون المساس بسياسات المالك (الـ OR لا يكسر شيئًا).
--  إدارة الأعضاء وتحديث صفّ الحملة/الباقة تبقى للمالك وحده.
-- ============================================================

-- المشترك: عضوُ الفريق يقرأ صفّ حملته (التحديث للمالك فقط عبر "subscriber owner all")
drop policy if exists "subscriber member read" on public.subscribers;
create policy "subscriber member read" on public.subscribers for select using (public.can_manage_sub(id));

drop policy if exists "trips team manage" on public.trips;
create policy "trips team manage" on public.trips for all
  using (public.can_manage_sub(subscriber_id)) with check (public.can_manage_sub(subscriber_id));

drop policy if exists "passengers team manage" on public.passengers;
create policy "passengers team manage" on public.passengers for all
  using (public.can_manage_sub(subscriber_id)) with check (public.can_manage_sub(subscriber_id));

drop policy if exists "customers team manage" on public.customers;
create policy "customers team manage" on public.customers for all
  using (public.can_manage_sub(subscriber_id)) with check (public.can_manage_sub(subscriber_id));

drop policy if exists "hotels team manage" on public.hotels;
create policy "hotels team manage" on public.hotels for all
  using (public.can_manage_sub(subscriber_id)) with check (public.can_manage_sub(subscriber_id));

drop policy if exists "rooms team manage" on public.hotel_rooms;
create policy "rooms team manage" on public.hotel_rooms for all
  using (public.can_manage_sub(subscriber_id)) with check (public.can_manage_sub(subscriber_id));

drop policy if exists "trip_buses team manage" on public.trip_buses;
create policy "trip_buses team manage" on public.trip_buses for all
  using (public.can_manage_sub(subscriber_id)) with check (public.can_manage_sub(subscriber_id));

drop policy if exists "waitlist team manage" on public.waitlist;
create policy "waitlist team manage" on public.waitlist for all
  using (public.can_manage_sub(subscriber_id)) with check (public.can_manage_sub(subscriber_id));

drop policy if exists "refunds team read" on public.refunds;
create policy "refunds team read" on public.refunds for select using (public.can_manage_sub(subscriber_id));
drop policy if exists "refunds team update" on public.refunds;
create policy "refunds team update" on public.refunds for update
  using (public.can_manage_sub(subscriber_id)) with check (public.can_manage_sub(subscriber_id));

drop policy if exists "payments team read" on public.payments;
create policy "payments team read" on public.payments for select using (public.can_manage_sub(subscriber_id));

drop policy if exists "audit team read" on public.audit_logs;
create policy "audit team read" on public.audit_logs for select using (public.can_manage_sub(subscriber_id));

-- ملاحظة: أُلغيت add_team_member (التحويل المباشر بلا موافقة) لصالح
-- مسار الدعوة/القبول (invite_member + accept_invite) أدناه — حمايةً للموافقة.
drop function if exists public.add_team_member(uuid, text, text);

-- ★ إزالة عضوٍ (المالك فقط، ولا يُزال المالك)
create or replace function public.remove_team_member(p_sub uuid, p_profile uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.subscribers where id = p_sub and owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using hint = 'إدارة الفريق لمالك الحملة فقط.';
  end if;
  if exists (select 1 from public.subscribers where id = p_sub and owner_id = p_profile) then
    raise exception 'CANNOT_REMOVE_OWNER' using hint = 'لا يمكن إزالة مالك الحملة.'; end if;
  delete from public.subscriber_members where subscriber_id = p_sub and profile_id = p_profile;
  perform set_config('malbeek.trusted', '1', true);
  update public.profiles set subscriber_id = null where id = p_profile and subscriber_id = p_sub;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.remove_team_member(uuid, uuid) from public;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;

-- ★ تغيير دور عضو (المالك فقط)
create or replace function public.set_member_role(p_sub uuid, p_profile uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.subscribers where id = p_sub and owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using hint = 'إدارة الفريق لمالك الحملة فقط.';
  end if;
  if p_role not in ('manager','staff') then raise exception 'BAD_ROLE' using hint = 'دورٌ غير صالح.'; end if;
  if exists (select 1 from public.subscribers where id = p_sub and owner_id = p_profile) then
    raise exception 'CANNOT_CHANGE_OWNER' using hint = 'لا يمكن تغيير دور المالك.'; end if;
  update public.subscriber_members set role = p_role where subscriber_id = p_sub and profile_id = p_profile;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.set_member_role(uuid, uuid, text) from public;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;

-- ★ أعضاء الحملة مع أسمائهم (للوحة الفريق) — المالك/الأعضاء فقط
create or replace function public.list_team_members(p_sub uuid)
returns table (profile_id uuid, full_name text, role text, is_owner boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.profile_id, p.full_name, m.role,
         (s.owner_id = m.profile_id) as is_owner, m.created_at
  from public.subscriber_members m
  join public.subscribers s on s.id = m.subscriber_id
  left join public.profiles p on p.id = m.profile_id
  where m.subscriber_id = p_sub
    and (public.can_manage_sub(p_sub) or public.my_role() = 'admin')
  order by (s.owner_id = m.profile_id) desc, m.created_at asc;
$$;
revoke all on function public.list_team_members(uuid) from public;
grant execute on function public.list_team_members(uuid) to authenticated;

-- ============================================================
--  المرحلة ٨-ب — دعواتُ الفريق بقبولٍ من المدعوّ (احترامُ الموافقة)
--  المالك يُنشئ دعوةً معلّقة؛ لا يُحوَّل أيّ حسابٍ إلّا بقبول صاحبه.
-- ============================================================
create table if not exists public.subscriber_invites (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  email         text not null,
  role          text not null default 'staff' check (role in ('manager','staff')),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz
);
create unique index if not exists uniq_invite_pending
  on public.subscriber_invites(subscriber_id, lower(email)) where accepted_at is null;
create index if not exists idx_invites_email on public.subscriber_invites(lower(email)) where accepted_at is null;

alter table public.subscriber_invites enable row level security;
-- المالك يدير دعوات حملته؛ المدعوّ يطّلع عليها عبر RPC بالبريد (لا قراءةَ عامّة)
drop policy if exists "invites owner manage" on public.subscriber_invites;
create policy "invites owner manage" on public.subscriber_invites for all
  using      (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()) or public.my_role() = 'admin')
  with check (subscriber_id in (select id from public.subscribers where owner_id = auth.uid()) or public.my_role() = 'admin');

-- ★ دعوة عضوٍ بالبريد (المالك فقط) — تُنشئ دعوةً معلّقة، بلا تحويلِ حساب.
create or replace function public.invite_member(p_sub uuid, p_email text, p_role text default 'staff')
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.subscribers where id = p_sub and owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using hint = 'إدارة الفريق لمالك الحملة فقط.'; end if;
  if p_role not in ('manager','staff') then raise exception 'BAD_ROLE' using hint = 'دورٌ غير صالح.'; end if;
  if btrim(coalesce(p_email,'')) = '' then raise exception 'BAD_EMAIL' using hint = 'أدخل بريدًا صحيحًا.'; end if;
  insert into public.subscriber_invites (subscriber_id, email, role, created_by)
  values (p_sub, lower(btrim(p_email)), p_role, auth.uid())
  on conflict (subscriber_id, lower(email)) where accepted_at is null
    do update set role = excluded.role, created_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.invite_member(uuid, text, text) from public;
grant execute on function public.invite_member(uuid, text, text) to authenticated;

-- ★ دعواتي المعلّقة (المدعوّ): تُطابِق بريد المستخدم الحاليّ.
create or replace function public.my_pending_invites()
returns table (invite_id uuid, subscriber_id uuid, org_name text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.subscriber_id, s.org_name, i.role, i.created_at
  from public.subscriber_invites i
  join public.subscribers s on s.id = i.subscriber_id
  join auth.users u on u.id = auth.uid()
  where i.accepted_at is null and lower(i.email) = lower(coalesce(u.email,''))
  order by i.created_at desc;
$$;
revoke all on function public.my_pending_invites() from public;
grant execute on function public.my_pending_invites() to authenticated;

-- ★ دعوات حملةٍ المعلّقة (للمالك/الأعضاء في لوحة الفريق)
create or replace function public.list_pending_invites(p_sub uuid)
returns table (invite_id uuid, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.email, i.role, i.created_at
  from public.subscriber_invites i
  where i.subscriber_id = p_sub and i.accepted_at is null
    and (public.can_manage_sub(p_sub) or public.my_role() = 'admin')
  order by i.created_at desc;
$$;
revoke all on function public.list_pending_invites(uuid) from public;
grant execute on function public.list_pending_invites(uuid) to authenticated;

-- ★ قبول دعوةٍ (المدعوّ نفسه فقط، بمطابقة البريد) — هنا فقط يُحوَّل الحساب بموافقته.
create or replace function public.accept_invite(p_invite uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text; v_inv record; v_role user_role;
begin
  select email into v_email from auth.users where id = auth.uid();
  select * into v_inv from public.subscriber_invites where id = p_invite and accepted_at is null;
  if not found then raise exception 'NOT_FOUND' using hint = 'الدعوة غير موجودةٍ أو استُخدمت.'; end if;
  if lower(v_inv.email) <> lower(coalesce(v_email, '')) then
    raise exception 'NOT_AUTHORIZED' using hint = 'هذه الدعوة ليست لبريدك.'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role = 'admin' then raise exception 'NOT_AUTHORIZED' using hint = 'حساب الإدارة لا ينضمّ كعضو.'; end if;
  if exists (select 1 from public.subscribers where owner_id = auth.uid()) then
    raise exception 'IS_OWNER' using hint = 'تملك حملةً خاصّةً بك — لا يمكنك الانضمام كعضوٍ بحسابٍ آخر.'; end if;

  insert into public.subscriber_members (subscriber_id, profile_id, role)
  values (v_inv.subscriber_id, auth.uid(), v_inv.role)
  on conflict (subscriber_id, profile_id) do update set role = excluded.role;
  perform set_config('malbeek.trusted', '1', true);
  update public.profiles set role = 'subscriber', subscriber_id = v_inv.subscriber_id where id = auth.uid();
  update public.subscriber_invites set accepted_at = now() where id = p_invite;
  return jsonb_build_object('ok', true, 'subscriber_id', v_inv.subscriber_id);
end $$;
revoke all on function public.accept_invite(uuid) from public;
grant execute on function public.accept_invite(uuid) to authenticated;

-- ★ معلومات دعوةٍ عبر رابطها (لصفحة الانضمام قبل الدخول) — متاحٌ لـ anon
--   يُرجع اسم الحملة والدور والبريد المدعوّ لدعوةٍ معلّقةٍ فقط (الرابط هو الإثبات).
create or replace function public.invite_info(p_invite uuid)
returns table (org_name text, role text, email text)
language sql stable security definer set search_path = public as $$
  select s.org_name, i.role, i.email
  from public.subscriber_invites i
  join public.subscribers s on s.id = i.subscriber_id
  where i.id = p_invite and i.accepted_at is null;
$$;
revoke all on function public.invite_info(uuid) from public;
grant execute on function public.invite_info(uuid) to anon, authenticated;

-- ★ تدقيقُ تغييرات الفريق: إضافةُ/إزالة/تغيير دور عضو
create or replace function public.audit_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare a jsonb := public.audit_actor(); v_label text;
begin
  select coalesce(p.full_name, u.email)
    into v_label
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = coalesce(new.profile_id, old.profile_id);

  if tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, actor_email, actor_role, subscriber_id, entity, entity_id, entity_label, action, changes)
    values ((a->>'actor_id')::uuid, a->>'actor_email', a->>'actor_role',
            new.subscriber_id, 'member', new.id, v_label, 'create',
            jsonb_build_object('role', jsonb_build_object('new', new.role)));
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs (actor_id, actor_email, actor_role, subscriber_id, entity, entity_id, entity_label, action, changes)
    values ((a->>'actor_id')::uuid, a->>'actor_email', a->>'actor_role',
            old.subscriber_id, 'member', old.id, v_label, 'delete', null);
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    insert into public.audit_logs (actor_id, actor_email, actor_role, subscriber_id, entity, entity_id, entity_label, action, changes)
    values ((a->>'actor_id')::uuid, a->>'actor_email', a->>'actor_role',
            new.subscriber_id, 'member', new.id, v_label, 'role_change',
            jsonb_build_object('role', jsonb_build_object('old', old.role, 'new', new.role)));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_audit_members on public.subscriber_members;
create trigger trg_audit_members
  after insert or update or delete on public.subscriber_members
  for each row execute function public.audit_member_change();
