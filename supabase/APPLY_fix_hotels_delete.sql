-- ============================================================
--  ملبّيك — ضمانُ سياسات حذف الفنادق والغرف   [إصلاح]
--  العَرَض: زرُّ حذف الفندق لا يُحدِث شيئًا — يَبقى ظاهرًا بعد الرجوع.
--  السبب المُرجَّح: سياسةُ DELETE على hotels/hotel_rooms غير مطبَّقةٍ
--  في القاعدة (RLS default-deny يَرفض الحذف صامتًا بلا خطأ).
--  الإصلاح: إعادةُ إنشاء سياسات الحذف (idempotent) — تَسمح للمالك
--  أو عضو الفريق فقط. شغّله مرّةً في Supabase SQL Editor.
-- ============================================================

alter table public.hotels      enable row level security;
alter table public.hotel_rooms enable row level security;

-- ── hotels: حذفٌ للمالك/الفريق ──────────────────────────────
drop policy if exists "hotels delete" on public.hotels;
create policy "hotels delete" on public.hotels for delete to authenticated using (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or public.can_manage_sub(subscriber_id)
);

-- ── hotel_rooms: حذفٌ للمالك/الفريق ─────────────────────────
drop policy if exists "hotel_rooms delete" on public.hotel_rooms;
create policy "hotel_rooms delete" on public.hotel_rooms for delete to authenticated using (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or public.can_manage_sub(subscriber_id)
);

-- ── تأكيدُ سلامة قيود FK (الحذفُ المتسلسل) ──────────────────
--   حذفُ الفندق يَحذف غرفه (cascade)، وحذفُ الغرفة يُفرّغ room_id
--   عن ساكنيها (set null). نَضمن وجودَهما إن لم تكونا مطبَّقتين.
do $$
begin
  -- hotel_rooms.hotel_id → hotels.id ON DELETE CASCADE
  if not exists (
    select 1 from information_schema.referential_constraints rc
    join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
    where tc.table_name = 'hotel_rooms' and rc.delete_rule = 'CASCADE'
      and tc.constraint_type = 'FOREIGN KEY'
  ) then
    -- نُعيد بناء القيد بحذفٍ متسلسل لو كان موجودًا بقاعدةٍ مختلفة
    if exists (select 1 from information_schema.columns where table_name='hotel_rooms' and column_name='hotel_id') then
      alter table public.hotel_rooms drop constraint if exists hotel_rooms_hotel_id_fkey;
      alter table public.hotel_rooms
        add constraint hotel_rooms_hotel_id_fkey
        foreign key (hotel_id) references public.hotels(id) on delete cascade;
    end if;
  end if;

  -- passengers.room_id → hotel_rooms.id ON DELETE SET NULL
  if exists (select 1 from information_schema.columns where table_name='passengers' and column_name='room_id') then
    if not exists (
      select 1 from information_schema.referential_constraints rc
      join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
      where tc.table_name = 'passengers' and rc.delete_rule = 'SET NULL'
        and tc.constraint_type = 'FOREIGN KEY'
    ) then
      alter table public.passengers drop constraint if exists passengers_room_id_fkey;
      alter table public.passengers
        add constraint passengers_room_id_fkey
        foreign key (room_id) references public.hotel_rooms(id) on delete set null;
    end if;
  end if;
end $$;
