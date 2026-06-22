-- ============================================================
--  ملبّيك — دفعُ العائلة الجماعيّ + تحقّقُ صاحب الحملة   [دفع · تشغيل]
--  السياق: رأسُ العائلة (محرم/ربّ أسرة) يحجز أقاربَه تحت family_group_id
--  مشترك، ويدفع عنهم جماعيًّا (متجر زد/سلة أو بنك) ويُرفق:
--    • payment_ref       = رقمُ طلب المتجر (زد/سلة)
--    • payment_proof_url  = الإيصالُ الجماعيّ
--  ثمّ يتحقّق صاحبُ الحملة فيُؤكَّد دفعُ كلِّ أفراد المجموعة دفعةً واحدة.
--
--  لا تنفيذَ دفعٍ فعليّ هنا — مجرّدُ ربطٍ وتأكيدٍ يدويٍّ (نمطُ الدفع المرن).
--  • إضافيٌّ غير متلف · forward-only · idempotent · شغّله في SQL Editor.
-- ============================================================

-- ١) قائمةُ دفعات العائلات لحملةٍ (لواجهة تحقّق صاحب الحملة).
--    صفٌّ لكلِّ (مجموعة × رحلة): الرأس، رقمُ الطلب، الإيصال، عددُ الأفراد،
--    وكم منهم مدفوعٌ فعلاً (لتمييز المعلّق عن المؤكَّد).
create or replace function public.list_family_payments(p_sub uuid, p_trip uuid default null)
returns table(
  family_group_id uuid, trip_id uuid, trip_title text,
  head_id uuid, head_name text, order_no text, receipt_url text,
  member_count bigint, paid_count bigint, head_created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with grp as (
    select distinct p.family_group_id, p.trip_id
    from public.passengers p
    where p.subscriber_id = p_sub
      and p.family_group_id is not null
      and (p_trip is null or p.trip_id = p_trip)
  )
  select
    g.family_group_id, g.trip_id, t.title,
    h.id, h.full_name, h.payment_ref, h.payment_proof_url,
    (select count(*) from public.passengers m
       where m.family_group_id = g.family_group_id and m.trip_id = g.trip_id),
    (select count(*) from public.passengers m
       where m.family_group_id = g.family_group_id and m.trip_id = g.trip_id
         and m.status in ('paid','boarded','checked_in')),
    h.created_at
  from grp g
  join public.trips t on t.id = g.trip_id
  -- الرأس: صاحبُ family_relation='self' وإلّا أوّلُ صفٍّ له حسابٌ (profile_id)
  join lateral (
    select p.* from public.passengers p
    where p.family_group_id = g.family_group_id and p.trip_id = g.trip_id
    order by (p.family_relation = 'self') desc, (p.profile_id is not null) desc, p.created_at asc
    limit 1
  ) h on true
  where public.my_role() = 'admin' or public.can_manage_sub(p_sub)
  order by h.created_at desc;
$$;
revoke all on function public.list_family_payments(uuid, uuid) from public, anon;
grant  execute on function public.list_family_payments(uuid, uuid) to authenticated;

-- ٢) تحقّقُ صاحب الحملة: يؤكّد دفعَ كلِّ أفراد المجموعة المعلّقين دفعةً واحدة.
--    (تأكيدٌ يدويٌّ لإيصالٍ مستلَم — لا حركةَ أموالٍ هنا.)
create or replace function public.verify_family_payment(p_group uuid, p_trip uuid)
returns integer
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_sub uuid; v_n integer; v_org text;
begin
  select subscriber_id into v_sub from public.passengers
    where family_group_id = p_group and trip_id = p_trip limit 1;
  if v_sub is null then raise exception 'not-found' using errcode = '02000'; end if;
  if not (public.my_role() = 'admin' or public.can_manage_sub(v_sub)) then
    raise exception 'unauthorized' using errcode = '42501', hint = 'لا تملك صلاحيّةَ هذه الحملة.';
  end if;

  update public.passengers
     set status = 'paid', paid_at = coalesce(paid_at, now())
   where family_group_id = p_group and trip_id = p_trip and status = 'registered';
  get diagnostics v_n = row_count;
  return v_n;   -- عددُ من أُكِّد دفعُهم
end $$;
revoke all on function public.verify_family_payment(uuid, uuid) from public, anon;
grant  execute on function public.verify_family_payment(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
