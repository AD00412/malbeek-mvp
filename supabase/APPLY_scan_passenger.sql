-- ============================================================
--  ملبّيك — RPC موثوقٌ للصعود/التسكين (scan_passenger)   [أمن · تشغيل]
--  المشكلة: الماسحُ كان يُحدّث passengers مباشرةً (يتّكئ على RLS + الحارس).
--  الحلّ: دالّةٌ واحدةٌ تَفرض الصلاحيّةَ (أدمن/فريق الحملة) وانتقالَ الحالة
--  الصحيحَ وختمَ الوقت — طبقةُ دفاعٍ صريحةٌ + منطقٌ مركزيّ.
--
--  • إضافيٌّ غير متلف · forward-only · idempotent · شغّله في SQL Editor.
--  • الماسحُ يستدعيها مع احتياطٍ للتحديث المباشر إن لم تُطبَّق بعد.
-- ============================================================

create or replace function public.scan_passenger(p_id uuid, p_mode text)
returns table(id uuid, full_name text, seat_no text, status text,
              boarded_at timestamptz, checked_in_at timestamptz)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_sub uuid; v_status text;
begin
  if p_mode not in ('board','checkin') then
    raise exception 'bad-mode' using errcode = '22023';
  end if;

  select pp.subscriber_id, pp.status into v_sub, v_status
    from public.passengers pp where pp.id = p_id;
  if v_sub is null then
    raise exception 'not-found' using errcode = '02000';
  end if;

  -- الصلاحيّة: أدمن المنصّة أو فريقُ الحملة (نفسُ شرط v_owner في الحارس).
  if not (public.my_role() = 'admin' or public.can_manage_sub(v_sub)) then
    raise exception 'unauthorized' using errcode = '42501', hint = 'لا تملك صلاحيّةَ هذه الحملة.';
  end if;

  if p_mode = 'board' then
    -- صعود: مَن سُكّن يبقى مُسكَّنًا (لا رجوع للخلف)؛ غيرُه → صعد + ختمُ الوقت.
    update public.passengers
       set status     = case when status = 'checked_in' then 'checked_in' else 'boarded' end,
           boarded_at = coalesce(boarded_at, now())
     where passengers.id = p_id;
  else
    -- تسكين: يتطلّب صعودًا سابقًا.
    if v_status not in ('boarded','checked_in') then
      raise exception 'not-boarded' using errcode = '22023', hint = 'سجّل الصعودَ أوّلًا.';
    end if;
    update public.passengers
       set status        = 'checked_in',
           checked_in_at = coalesce(checked_in_at, now())
     where passengers.id = p_id;
  end if;

  return query
    select p.id, p.full_name, p.seat_no, p.status::text, p.boarded_at, p.checked_in_at
      from public.passengers p where p.id = p_id;
end $$;

revoke all on function public.scan_passenger(uuid, text) from public, anon;
grant  execute on function public.scan_passenger(uuid, text) to authenticated;

notify pgrst, 'reload schema';
