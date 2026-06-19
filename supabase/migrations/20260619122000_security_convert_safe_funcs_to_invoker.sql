-- ============================================================
-- تحويلُ دوالٍّ إلى SECURITY INVOKER حيثُ RLS كافيةٌ للتحقّق
-- ============================================================
-- المبدأ: SECURITY DEFINER يَتجاوز RLS — لا حاجة له إن كانت RLS
-- تَفرض الفلترة بنفسها. INVOKER أأمنُ (دفاعٌ متعدّد الطبقات).
-- ============================================================

-- ١) unread_notifications_count
alter function public.unread_notifications_count() security invoker;

-- ٢) admin_campaign_stats
alter function public.admin_campaign_stats() security invoker;
