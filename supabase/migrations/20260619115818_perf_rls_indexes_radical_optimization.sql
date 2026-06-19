-- ============================================================
-- ميغريشن: إصلاحٌ جذريٌّ لأداءِ RLS + فهارسُ FK المفقودة
-- ============================================================
-- ١) لفُّ ‎auth.uid()‎ بـ ‎(select auth.uid())‎ — تقييمٌ مرّةٌ لكلِّ
--    استعلامٍ بدل صفٍّ صفّ (تسرُّعٌ هائلٌ مع النموّ).
-- ٢) دمجُ السياساتِ المكرَّرة على نفس (table, cmd) في سياسةٍ واحدة
--    مُجمَّعةٍ بـ OR (يحذف ١٨٥ تحذيرَ duplicate permissive).
-- ٣) تقييدُ كلّ السياسات بـ ‎to authenticated‎ — لا تَقيِّم anon.
-- ٤) إضافةُ ١٣ فهرسًا لمفاتيحَ خارجيّةٍ بلا فهرس.
-- ============================================================

-- ============= (١) فهارسُ المفاتيح الخارجيّة =============
create index if not exists idx_audit_logs_actor_id            on public.audit_logs(actor_id);
create index if not exists idx_hotel_rooms_subscriber_id      on public.hotel_rooms(subscriber_id);
create index if not exists idx_hotel_rooms_trip_id            on public.hotel_rooms(trip_id);
create index if not exists idx_hotels_subscriber_id           on public.hotels(subscriber_id);
create index if not exists idx_notifications_ref_feedback     on public.notifications(ref_feedback);
create index if not exists idx_notifications_ref_passenger    on public.notifications(ref_passenger);
create index if not exists idx_notifications_ref_trip         on public.notifications(ref_trip);
create index if not exists idx_payments_trip_id               on public.payments(trip_id);
create index if not exists idx_refunds_trip_id                on public.refunds(trip_id);
create index if not exists idx_subscriber_invites_created_by  on public.subscriber_invites(created_by);
create index if not exists idx_trip_buses_subscriber_id       on public.trip_buses(subscriber_id);
create index if not exists idx_waitlist_profile_id            on public.waitlist(profile_id);
create index if not exists idx_waitlist_subscriber_id         on public.waitlist(subscriber_id);

-- ============= (٢) إعادةُ بناءِ RLS مدموجًا ومُحسَّنًا =============

-- ─── profiles ───
drop policy if exists "profile self insert" on public.profiles;
drop policy if exists "profile self read"   on public.profiles;
drop policy if exists "profile self update" on public.profiles;
create policy "profiles select" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or my_role() = 'admin'::user_role);
create policy "profiles insert" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "profiles update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ─── audit_logs ───
drop policy if exists "audit admin read" on public.audit_logs;
drop policy if exists "audit owner read" on public.audit_logs;
drop policy if exists "audit team read"  on public.audit_logs;
create policy "audit_logs select" on public.audit_logs for select to authenticated using (
  my_role() = 'admin'::user_role
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);

-- ─── customers ───
drop policy if exists "customers owner manage" on public.customers;
drop policy if exists "customers team manage"  on public.customers;
drop policy if exists "customers admin read"   on public.customers;
drop policy if exists "customers self read"    on public.customers;
drop policy if exists "customers self insert"  on public.customers;
drop policy if exists "customers self update"  on public.customers;
create policy "customers select" on public.customers for select to authenticated using (
  my_role() = 'admin'::user_role
  or profile_id = (select auth.uid())
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "customers insert" on public.customers for insert to authenticated with check (
  (profile_id = (select auth.uid()) and subscriber_id = my_subscriber_id())
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "customers update" on public.customers for update to authenticated
  using (
    profile_id = (select auth.uid())
    or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  ) with check (
    profile_id = (select auth.uid())
    or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  );
create policy "customers delete" on public.customers for delete to authenticated using (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);

-- ─── feedback ───
drop policy if exists "feedback self insert" on public.feedback;
drop policy if exists "feedback self read"   on public.feedback;
create policy "feedback select" on public.feedback for select to authenticated using (
  profile_id = (select auth.uid()) or my_role() = 'admin'::user_role
);
create policy "feedback insert" on public.feedback for insert to authenticated
  with check (profile_id = (select auth.uid()));

-- ─── hotel_rooms ───
drop policy if exists "rooms owner manage" on public.hotel_rooms;
drop policy if exists "rooms team manage"  on public.hotel_rooms;
drop policy if exists "rooms admin read"   on public.hotel_rooms;
drop policy if exists "rooms customer read" on public.hotel_rooms;
create policy "hotel_rooms select" on public.hotel_rooms for select to authenticated using (
  my_role() = 'admin'::user_role
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
  or (subscriber_id = my_subscriber_id() and exists (
        select 1 from public.trips t
        where t.id = hotel_rooms.trip_id and t.status <> 'draft'::trip_status))
);
create policy "hotel_rooms insert" on public.hotel_rooms for insert to authenticated with check (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "hotel_rooms update" on public.hotel_rooms for update to authenticated
  using (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  ) with check (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  );
create policy "hotel_rooms delete" on public.hotel_rooms for delete to authenticated using (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);

-- ─── hotels ───
drop policy if exists "hotels owner manage" on public.hotels;
drop policy if exists "hotels team manage"  on public.hotels;
drop policy if exists "hotels admin read"   on public.hotels;
drop policy if exists "hotels customer read" on public.hotels;
create policy "hotels select" on public.hotels for select to authenticated using (
  my_role() = 'admin'::user_role
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
  or (subscriber_id = my_subscriber_id() and exists (
        select 1 from public.trips t
        where t.id = hotels.trip_id and t.status <> 'draft'::trip_status))
);
create policy "hotels insert" on public.hotels for insert to authenticated with check (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "hotels update" on public.hotels for update to authenticated
  using (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  ) with check (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  );
create policy "hotels delete" on public.hotels for delete to authenticated using (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);

-- ─── notifications ───
drop policy if exists "notif self read"    on public.notifications;
drop policy if exists "notif self update"  on public.notifications;
drop policy if exists "notif admin read"   on public.notifications;
drop policy if exists "notif admin update" on public.notifications;
create policy "notifications select" on public.notifications for select to authenticated using (
  profile_id = (select auth.uid())
  or (my_role() = 'admin'::user_role and audience = 'admin'::text)
);
create policy "notifications update" on public.notifications for update to authenticated
  using (
    profile_id = (select auth.uid())
    or (my_role() = 'admin'::user_role and audience = 'admin'::text)
  ) with check (
    profile_id = (select auth.uid())
    or (my_role() = 'admin'::user_role and audience = 'admin'::text)
  );

-- ─── passengers ───
drop policy if exists "passengers owner manage"   on public.passengers;
drop policy if exists "passengers team manage"   on public.passengers;
drop policy if exists "passengers admin read"     on public.passengers;
drop policy if exists "passengers customer read"  on public.passengers;
drop policy if exists "passengers customer insert" on public.passengers;
drop policy if exists "passengers customer update" on public.passengers;
drop policy if exists "passengers customer delete" on public.passengers;
create policy "passengers select" on public.passengers for select to authenticated using (
  my_role() = 'admin'::user_role
  or profile_id = (select auth.uid())
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "passengers insert" on public.passengers for insert to authenticated with check (
  (profile_id = (select auth.uid()) and subscriber_id = my_subscriber_id())
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "passengers update" on public.passengers for update to authenticated
  using (
    profile_id = (select auth.uid())
    or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  ) with check (
    (profile_id = (select auth.uid()) and subscriber_id = my_subscriber_id())
    or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  );
create policy "passengers delete" on public.passengers for delete to authenticated using (
  (profile_id = (select auth.uid()) and status = 'registered'::text)
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);

-- ─── payments ───
drop policy if exists "payments admin read" on public.payments;
drop policy if exists "payments owner read" on public.payments;
drop policy if exists "payments team read"  on public.payments;
create policy "payments select" on public.payments for select to authenticated using (
  my_role() = 'admin'::user_role
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);

-- ─── refunds ───
drop policy if exists "refunds admin read"    on public.refunds;
drop policy if exists "refunds customer read" on public.refunds;
drop policy if exists "refunds owner read"    on public.refunds;
drop policy if exists "refunds team read"     on public.refunds;
drop policy if exists "refunds owner update"  on public.refunds;
drop policy if exists "refunds team update"   on public.refunds;
create policy "refunds select" on public.refunds for select to authenticated using (
  my_role() = 'admin'::user_role
  or profile_id = (select auth.uid())
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "refunds update" on public.refunds for update to authenticated
  using (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  ) with check (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  );

-- ─── subscribers ───
drop policy if exists "subscriber owner all"      on public.subscribers;
drop policy if exists "subscriber admin read"     on public.subscribers;
drop policy if exists "subscriber customer read"  on public.subscribers;
drop policy if exists "subscriber member read"    on public.subscribers;
drop policy if exists "subscriber admin update"   on public.subscribers;
create policy "subscribers select" on public.subscribers for select to authenticated using (
  my_role() = 'admin'::user_role
  or owner_id = (select auth.uid())
  or id = my_subscriber_id()
  or can_manage_sub(id)
);
create policy "subscribers insert" on public.subscribers for insert to authenticated with check (
  owner_id = (select auth.uid())
  and coalesce(my_role(), 'customer'::user_role) <> 'customer'::user_role
);
create policy "subscribers update" on public.subscribers for update to authenticated
  using (
    my_role() = 'admin'::user_role or owner_id = (select auth.uid())
  ) with check (
    my_role() = 'admin'::user_role
    or (owner_id = (select auth.uid()) and coalesce(my_role(), 'customer'::user_role) <> 'customer'::user_role)
  );
create policy "subscribers delete" on public.subscribers for delete to authenticated using (
  owner_id = (select auth.uid())
);

-- ─── subscriber_invites ───
drop policy if exists "invites owner manage" on public.subscriber_invites;
create policy "subscriber_invites all" on public.subscriber_invites for all to authenticated
  using (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or my_role() = 'admin'::user_role
  ) with check (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or my_role() = 'admin'::user_role
  );

-- ─── subscriber_members ───
drop policy if exists "members owner manage" on public.subscriber_members;
create policy "subscriber_members all" on public.subscriber_members for all to authenticated
  using (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or my_role() = 'admin'::user_role
  ) with check (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or my_role() = 'admin'::user_role
  );

-- ─── trip_buses ───
drop policy if exists "trip_buses owner manage"   on public.trip_buses;
drop policy if exists "trip_buses team manage"    on public.trip_buses;
drop policy if exists "trip_buses admin read"     on public.trip_buses;
drop policy if exists "trip_buses customer read"  on public.trip_buses;
create policy "trip_buses select" on public.trip_buses for select to authenticated using (
  my_role() = 'admin'::user_role
  or subscriber_id = my_subscriber_id()
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "trip_buses insert" on public.trip_buses for insert to authenticated with check (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "trip_buses update" on public.trip_buses for update to authenticated
  using (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  ) with check (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  );
create policy "trip_buses delete" on public.trip_buses for delete to authenticated using (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);

-- ─── trips ───
drop policy if exists "trips owner manage"        on public.trips;
drop policy if exists "trips team manage"         on public.trips;
drop policy if exists "trips admin read"          on public.trips;
drop policy if exists "trips customer read scoped" on public.trips;
create policy "trips select" on public.trips for select to authenticated using (
  my_role() = 'admin'::user_role
  or (subscriber_id = my_subscriber_id() and status <> 'draft'::trip_status)
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "trips insert" on public.trips for insert to authenticated with check (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "trips update" on public.trips for update to authenticated
  using (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  ) with check (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  );
create policy "trips delete" on public.trips for delete to authenticated using (
  subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);

-- ─── waitlist ───
drop policy if exists "wait owner manage"   on public.waitlist;
drop policy if exists "waitlist team manage" on public.waitlist;
drop policy if exists "wait admin read"     on public.waitlist;
drop policy if exists "wait self read"      on public.waitlist;
drop policy if exists "wait self insert"    on public.waitlist;
drop policy if exists "wait self delete"    on public.waitlist;
create policy "waitlist select" on public.waitlist for select to authenticated using (
  my_role() = 'admin'::user_role
  or profile_id = (select auth.uid())
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "waitlist insert" on public.waitlist for insert to authenticated with check (
  (profile_id = (select auth.uid()) and subscriber_id = my_subscriber_id())
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
create policy "waitlist update" on public.waitlist for update to authenticated
  using (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  ) with check (
    subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
    or can_manage_sub(subscriber_id)
  );
create policy "waitlist delete" on public.waitlist for delete to authenticated using (
  profile_id = (select auth.uid())
  or subscriber_id in (select id from public.subscribers where owner_id = (select auth.uid()))
  or can_manage_sub(subscriber_id)
);
