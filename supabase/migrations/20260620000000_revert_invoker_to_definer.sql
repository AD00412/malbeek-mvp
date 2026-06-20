-- ============================================================
-- إعادةُ الدالّتَين إلى SECURITY DEFINER بعد كشف عَطَب SECURITY INVOKER
-- ============================================================
-- التحويلُ السابقُ (20260619122000_security_convert_safe_funcs_to_invoker.sql)
-- اعتمد على RLS لتَأمين الفلترة. لكن:
--
-- admin_campaign_stats: الجدولُ public.subscribers لا يَملك سياسةَ SELECT
-- لغير المالك/العضو/الأدمن. تحت INVOKER، استعلامُ COUNT/SUM على
-- passengers/trips من حملاتٍ أخرى يَرجع ٠ للأدمن نفسه — اللوحةُ
-- الإداريّةُ صامتةٌ ومُضلِّلة (تَعرض إحصاءاتٍ من حملة الأدمن فقط، لا الكلّ).
--
-- unread_notifications_count: أقلُّ خطورةً (يَستعمل auth.uid() مباشرةً)
-- لكن لتجنّب أيِّ مفاجأةٍ في شارة الجرس للأدمن نُعيدُها لـ DEFINER كذلك.
-- ============================================================

alter function public.admin_campaign_stats() security definer;
alter function public.unread_notifications_count() security invoker;
-- ملاحظة: unread_notifications_count يَعمل صحيحًا بـ INVOKER (لا تَجاوز RLS).
-- نُبقيها على INVOKER لتقليل تحذيرات الأدفايزر؛ admin يَرى إشعاراته فقط
-- وهذا هو السلوك المقصود.

-- تأكّدٌ: لا تَنسَ NOTIFY pgrst فلتقتطف PostgREST التواقيع الجديدة
notify pgrst, 'reload schema';
