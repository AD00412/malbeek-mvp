-- إصلاح أنواع (kind) إشعارات المعتمر عند تغيّر الحالة + إثراء المحتوى بعنوان الرحلة.
-- كانت: paid→payment_pending، boarded/checked_in→new_booking ⇒ روابط عميقة خاطئة
-- (تفتح صفحة المشترك). الصحيح: booking_paid/boarded/checked_in ⇒ /customer?go=tickets.
-- لا إرسال فعليّ — صفوف إشعاراتٍ داخل التطبيق فقط (وبنية الـpush جاهزة).
create or replace function public.notify_passengers_change()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_owner_id uuid; v_trip record;
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
      if new.profile_id is not null and new.status is distinct from old.status
         and new.status in ('paid','boarded','checked_in') then
        select title into v_trip from public.trips where id = new.trip_id;
        insert into public.notifications(profile_id, audience, kind, title, body, ref_trip, ref_passenger)
        values (new.profile_id, 'customer',
                case new.status when 'paid' then 'booking_paid' when 'boarded' then 'boarded' when 'checked_in' then 'checked_in' end,
                case new.status when 'paid' then 'تمّ تأكيد دفعك ✓' when 'boarded' then 'تمّ تسجيل صعودك ✓' when 'checked_in' then 'تمّ تسكينك ✓' end,
                case new.status
                  when 'paid'       then 'رحلة «' || coalesce(v_trip.title,'') || '» — تذكرتك جاهزة، اعرض الباركود عند الصعود.'
                  when 'boarded'    then 'رحلة «' || coalesce(v_trip.title,'') || '» — رحلةٌ موفّقةٌ ومقبولة.'
                  when 'checked_in' then 'رحلة «' || coalesce(v_trip.title,'') || '» — استلمت غرفتك في الفندق.'
                end,
                new.trip_id, new.id);
      end if;
    elsif tg_op = 'DELETE' then
      select owner_id into v_owner_id from public.subscribers where id = old.subscriber_id;
      if v_owner_id is not null then
        insert into public.notifications(profile_id, audience, kind, title, body, ref_trip)
        values (v_owner_id, 'subscriber', 'booking_canceled',
                'أُلغي حجز: ' || coalesce(old.full_name,'معتمر'),
                'تفرّغ المقعد ' || coalesce(old.seat_no,'—'), old.trip_id);
      end if;
    end if;
  exception when others then
    raise warning 'notify_passengers_change failed: % (%)', sqlerrm, sqlstate;
  end;
  return coalesce(new, old);
end $function$;
