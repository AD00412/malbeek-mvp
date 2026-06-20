-- ============================================================
-- ملبّيك · ٢٠٢٦-٠٦-٢٠ · تَحصينُ trigger functions للإشعارات
-- ============================================================
-- المشكلة (M5 من التدقيق):
-- ٧ دوالِ trigger للإشعارات يُمكن أن تَفشل (مثلًا لو أُضيف عمودٌ
-- NOT NULL لاحقًا أو قيدُ check جديد) → الفشلُ يَنقُض parent transaction
-- (مثلًا cancel_booking → notify_waitlist_on_seat_free يَفشل → الحجزُ
-- لا يُلغى صامتًا).
--
-- الإصلاح: تَغليفُ منطقِ كلّ دالّةٍ بـ BEGIN ... EXCEPTION WHEN OTHERS
-- THEN RAISE WARNING — الإشعار يُسجَّل فاشلًا في server log لكن
-- العمليّةُ الأصلُ تَنجح.
--
-- لا تَغيير في المنطق الفعليّ — فقط طبقةُ حماية. idempotent.
-- ============================================================

-- ─── ١) notify_waitlist_on_seat_free ───
create or replace function public.notify_waitlist_on_seat_free()
returns trigger language plpgsql security definer set search_path = public as $$
declare w record; v_trip_alive boolean;
begin
  begin
    if tg_op = 'DELETE' and old.seat_no is not null then
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
  exception when others then
    raise warning 'notify_waitlist_on_seat_free failed: % (%)', sqlerrm, sqlstate;
  end;
  return coalesce(new, old);
end $$;

-- ─── ٢) notify_passengers_change ───
create or replace function public.notify_passengers_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner_id uuid;
  v_trip     record;
begin
  begin
    if tg_op = 'INSERT' then
      select owner_id into v_owner_id from public.subscribers where id = new.subscriber_id;
      select title, route_from, route_to into v_trip from public.trips where id = new.trip_id;
      if v_owner_id is not null then
        insert into public.notifications(profile_id, audience, kind, title, body, ref_trip, ref_passenger)
        values (v_owner_id, 'subscriber', 'new_booking',
                'حجزٌ جديد: ' || coalesce(new.full_name,'معتمر'),
                'في رحلة «' || coalesce(v_trip.title,'') || '» — مقعد ' || coalesce(new.seat_no,'—'),
                new.trip_id, new.id);
      end if;
      if new.payment_ref is not null and new.status = 'registered' and v_owner_id is not null then
        insert into public.notifications(profile_id, audience, kind, title, body, ref_trip, ref_passenger)
        values (v_owner_id, 'subscriber', 'payment_pending',
                'دفعٌ بانتظار التأكيد',
                coalesce(new.full_name,'معتمر') || ' — مرجع: ' || new.payment_ref,
                new.trip_id, new.id);
      end if;
    elsif tg_op = 'UPDATE' then
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
  exception when others then
    raise warning 'notify_passengers_change failed: % (%)', sqlerrm, sqlstate;
  end;
  return coalesce(new, old);
end $$;

-- ─── ٣) notify_trip_lifecycle ───
create or replace function public.notify_trip_lifecycle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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
  exception when others then
    raise warning 'notify_trip_lifecycle failed: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end $$;

-- ─── ٤) notify_feedback_reply ───
create or replace function public.notify_feedback_reply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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
  exception when others then
    raise warning 'notify_feedback_reply failed: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end $$;

-- ─── ٥) notify_new_feedback ───
create or replace function public.notify_new_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  begin
    for a in select id from public.profiles where role = 'admin' loop
      insert into public.notifications(profile_id, audience, kind, title, body, ref_feedback)
      values (a.id, 'admin', 'new_feedback',
              'ملاحظةٌ جديدة (' || new.audience || ')',
              coalesce(new.subject,'') || ' — ' || left(coalesce(new.body,''), 140),
              new.id);
    end loop;
  exception when others then
    raise warning 'notify_new_feedback failed: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end $$;

-- ─── ٦) notify_new_subscriber ───
create or replace function public.notify_new_subscriber()
returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  begin
    for a in select id from public.profiles where role = 'admin' loop
      insert into public.notifications(profile_id, audience, kind, title, body)
      values (a.id, 'admin', 'new_subscriber',
              'مشترك جديد: ' || coalesce(new.org_name,''),
              'انضمت حملةٌ جديدةٌ بالباقة ' || new.plan::text);
    end loop;
  exception when others then
    raise warning 'notify_new_subscriber failed: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end $$;

-- ─── ٧) notify_refund_change ───
create or replace function public.notify_refund_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
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
  exception when others then
    raise warning 'notify_refund_change failed: % (%)', sqlerrm, sqlstate;
  end;
  return coalesce(new, old);
end $$;

notify pgrst, 'reload schema';
