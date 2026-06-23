-- تجميعٌ خادميٌّ للتحصيل/الاستردادات بدل جلب كل صفوف amount في CampaignAnalytics.
-- يحافظ على صحّة المجموع ويمنع الجلب المفتوح. وصول: مدير الحملة أو الأدمن.
create or replace function public.subscriber_finance_totals(p_sub uuid)
returns table(collected numeric, refunded numeric, refund_pending numeric, refund_pending_count int)
language sql stable security definer set search_path to 'public'
as $function$
  select
    coalesce((select sum(amount) from public.passengers
              where subscriber_id = p_sub and status in ('paid','boarded','checked_in')), 0)::numeric,
    coalesce((select sum(amount) from public.refunds
              where subscriber_id = p_sub and status = 'refunded'), 0)::numeric,
    coalesce((select sum(amount) from public.refunds
              where subscriber_id = p_sub and status = 'requested'), 0)::numeric,
    coalesce((select count(*) from public.refunds
              where subscriber_id = p_sub and status = 'requested'), 0)::int
  where public.can_manage_sub(p_sub) or public.my_role() = 'admin';
$function$;

grant execute on function public.subscriber_finance_totals(uuid) to authenticated;
