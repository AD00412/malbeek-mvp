-- ============================================================
-- إصلاحاتُ الأمان — تقييدُ EXECUTE وضبطُ search_path
-- ============================================================
-- المبدأ:
--  - SECURITY DEFINER يَركضُ بصلاحيّاتِ مُنشئها (postgres) → كلُّ
--    دوالها يجب ألّا تكون مكشوفةً للعموم إلّا بقصدٍ صريح.
--  - الترايجراتُ تُشغّل دوالها داخليًّا، لا حاجة لإذن client للوصول.
--  - دوالُ INVOKER بلا search_path معرَّضةٌ لـ schema hijacking.
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- (١) ضبطُ search_path للدوال الـ INVOKER (٣ تحذيرات)
-- ───────────────────────────────────────────────────────────
alter function public.norm_digits(text)      set search_path = public, pg_catalog;
alter function public.norm_national_id(text) set search_path = public, pg_catalog;
alter function public.norm_sa_phone(text)    set search_path = public, pg_catalog;

-- ───────────────────────────────────────────────────────────
-- (٢) دوالُ الترايجر — لا تُستدعى من عميل (revoke ALL)
-- ───────────────────────────────────────────────────────────
revoke execute on function public.audit_actor()                  from public, anon, authenticated;
revoke execute on function public.audit_member_change()          from public, anon, authenticated;
revoke execute on function public.audit_passenger_change()       from public, anon, authenticated;
revoke execute on function public.audit_trip_change()            from public, anon, authenticated;
revoke execute on function public.guard_customer_columns()       from public, anon, authenticated;
revoke execute on function public.guard_feedback_columns()       from public, anon, authenticated;
revoke execute on function public.guard_notification_columns()   from public, anon, authenticated;
revoke execute on function public.guard_passenger_columns()      from public, anon, authenticated;
revoke execute on function public.guard_profile_columns()        from public, anon, authenticated;
revoke execute on function public.guard_refund_columns()         from public, anon, authenticated;
revoke execute on function public.guard_subscriber_columns()     from public, anon, authenticated;
revoke execute on function public.handle_new_user()              from public, anon, authenticated;
revoke execute on function public.enforce_trial_trip_limit()     from public, anon, authenticated;
revoke execute on function public.ensure_primary_bus()           from public, anon, authenticated;
revoke execute on function public.sync_primary_bus()             from public, anon, authenticated;
revoke execute on function public.normalize_customer()           from public, anon, authenticated;
revoke execute on function public.notify_feedback_reply()        from public, anon, authenticated;
revoke execute on function public.notify_new_feedback()          from public, anon, authenticated;
revoke execute on function public.notify_new_subscriber()        from public, anon, authenticated;
revoke execute on function public.notify_passengers_change()     from public, anon, authenticated;
revoke execute on function public.notify_refund_change()         from public, anon, authenticated;
revoke execute on function public.notify_trip_lifecycle()        from public, anon, authenticated;
revoke execute on function public.notify_waitlist_on_seat_free() from public, anon, authenticated;
revoke execute on function public.add_owner_member()             from public, anon, authenticated;
revoke execute on function public.validate_trip()                from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────
-- (٣) دالةُ الكرون — service_role فقط
-- ───────────────────────────────────────────────────────────
revoke execute on function public.auto_remind_departures()       from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────
-- (٤) دوال auth-only — منع anon، احتفظ بـ authenticated فقط
-- ───────────────────────────────────────────────────────────
revoke execute on function public.my_role()                      from public, anon;
grant  execute on function public.my_role()                      to authenticated;

revoke execute on function public.my_subscriber_id()             from public, anon;
grant  execute on function public.my_subscriber_id()             to authenticated;

revoke execute on function public.my_managed_subscriber_id()     from public, anon;
grant  execute on function public.my_managed_subscriber_id()     to authenticated;

revoke execute on function public.subscriber_my_role(uuid)       from public, anon;
grant  execute on function public.subscriber_my_role(uuid)       to authenticated;

revoke execute on function public.unread_notifications_count()   from public, anon;
grant  execute on function public.unread_notifications_count()   to authenticated;

revoke execute on function public.can_manage_sub(uuid)           from public, anon;
grant  execute on function public.can_manage_sub(uuid)           to authenticated;

revoke execute on function public.admin_campaign_stats()         from public, anon;
grant  execute on function public.admin_campaign_stats()         to authenticated;

revoke execute on function public.trip_seat_occupancy(uuid, uuid) from public, anon;
grant  execute on function public.trip_seat_occupancy(uuid, uuid) to authenticated;

revoke execute on function public.cancel_booking(uuid, text)     from public, anon;
grant  execute on function public.cancel_booking(uuid, text)     to authenticated;

revoke execute on function public.duplicate_trip(uuid, text, integer) from public, anon;
grant  execute on function public.duplicate_trip(uuid, text, integer) to authenticated;

revoke execute on function public.remind_trip(uuid, text)        from public, anon;
grant  execute on function public.remind_trip(uuid, text)        to authenticated;

revoke execute on function public.invite_info(uuid)              from public, anon;
grant  execute on function public.invite_info(uuid)              to authenticated;

revoke execute on function public.accept_invite(uuid)            from public, anon;
grant  execute on function public.accept_invite(uuid)            to authenticated;

revoke execute on function public.invite_member(uuid, text, text) from public, anon;
grant  execute on function public.invite_member(uuid, text, text) to authenticated;

revoke execute on function public.list_pending_invites(uuid)     from public, anon;
grant  execute on function public.list_pending_invites(uuid)     to authenticated;

revoke execute on function public.list_team_members(uuid)        from public, anon;
grant  execute on function public.list_team_members(uuid)        to authenticated;

revoke execute on function public.my_pending_invites()           from public, anon;
grant  execute on function public.my_pending_invites()           to authenticated;

revoke execute on function public.remove_team_member(uuid, uuid) from public, anon;
grant  execute on function public.remove_team_member(uuid, uuid) to authenticated;

revoke execute on function public.set_member_role(uuid, uuid, text) from public, anon;
grant  execute on function public.set_member_role(uuid, uuid, text) to authenticated;

-- ───────────────────────────────────────────────────────────
-- (٥) دوال عمومية — anon + authenticated معًا
-- ───────────────────────────────────────────────────────────
revoke execute on function public.subscriber_by_slug(text) from public;
grant  execute on function public.subscriber_by_slug(text) to anon, authenticated;

revoke execute on function public.submit_public_message(text, text, text, text, text, text, text[]) from public;
grant  execute on function public.submit_public_message(text, text, text, text, text, text, text[]) to anon, authenticated;
