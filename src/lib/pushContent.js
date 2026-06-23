// محتوى الإشعارات الهادف + الروابط العميقة (deep-links) لكل نوع حدث.
// يُستعمَل أماميًّا (showNotification عبر الـSW) عند وصول حدثٍ والتطبيق مفتوح.
//
// نموذج العرض (مطابقٌ لتطبيقات مثل Zid):
//   • العنوان = «ملبّيك» دائمًا (العلامة فقط — لا عنوانٌ حدثيٌّ في الترويسة).
//   • الجسم  = سطرٌ هادفٌ حقيقيٌّ **غير فارغٍ أبدًا**.
// ★ مهمّ: جسمٌ فارغٌ يجعل iOS يُلحق «from <الموقع>» تلقائيًّا في الإشعار —
//   لذا نضمن جسمًا غير فارغٍ دائمًا، فتختفي كلمة «from» نهائيًّا.

const BRAND = 'ملبّيك'
const DEFAULT_BODY = 'لديك تحديثٌ جديد في ملبّيك. افتحه للتفاصيل.'

const KIND = {
  // المشترك
  new_booking:      { title: 'طلب حجز جديد',           url: '/dashboard?go=ops' },
  payment_pending:  { title: 'دفعة بانتظار التأكيد',   url: '/dashboard?go=ops' },
  booking_canceled: { title: 'إلغاء حجز',              url: '/dashboard?go=ops' },
  low_occupancy:    { title: 'إشغالٌ منخفض في رحلة',   url: '/dashboard?go=analytics' },
  trial_ending:     { title: 'تجربتك تقترب من الانتهاء', url: '/dashboard' },
  trial_limit_hit:  { title: 'بلغت حدّ الباقة التجريبية', url: '/dashboard' },
  // الأدمن
  new_feedback:     { title: 'رسالة دعم جديدة',        url: '/admin?go=feedback' },
  new_subscriber:   { title: 'مشترك جديد في المنصّة',  url: '/admin?go=subs' },
  upgrade_request:  { title: 'طلب ترقية باقة',         url: '/admin?go=upgrades' },
  // المعتمر
  feedback_reply:   { title: 'ردّ الإدارة على رسالتك', url: '/customer?go=feedback' },
  trip_changed:     { title: 'تحديثٌ على رحلتك',       url: '/customer?go=tickets' },
  trip_reminder:    { title: 'تذكيرٌ بموعد رحلتك',     url: '/customer?go=tickets' },
  booking_paid:     { title: 'تأكّد دفع حجزك',         url: '/customer?go=tickets' },
  boarded:          { title: 'تمّ تسجيل صعودك',        url: '/customer?go=tickets' },
  checked_in:       { title: 'تمّ تسكينك',             url: '/customer?go=tickets' },
}

// يبني جسمًا هادفًا واحدًا من عنوان/جسم الصفّ دون تكرار (بعض الأنواع يكرّر
// العنوان داخل الجسم). يُرجِع نصًّا غير فارغٍ دائمًا.
function meaningfulBody(headline, detail) {
  if (headline && detail) {
    if (detail.includes(headline)) return detail        // الجسم يحوي العنوان أصلًا
    if (headline.includes(detail)) return headline
    return `${headline} — ${detail}`
  }
  return headline || detail || DEFAULT_BODY
}

/**
 * يبني محتوى الإشعار من صفّ notifications: عنوانٌ (العلامة) + جسمٌ هادفٌ + رابطٌ عميق.
 * @returns {{ title:string, body:string, url:string, tag:string }}
 */
export function buildNotificationContent(row = {}) {
  const meta = KIND[row.kind] || {}
  const headline = (row.title && row.title.trim()) || meta.title || ''
  const detail = (row.body && row.body.trim()) || ''
  const body = meaningfulBody(headline, detail)

  let url = meta.url || (row.link && String(row.link)) || '/'
  if (row.ref_trip && url.includes('?')) url += `&trip=${row.ref_trip}`
  else if (row.ref_trip) url += `?trip=${row.ref_trip}`

  return { title: BRAND, body, url, tag: row.kind ? `mlk-${row.kind}` : 'mlk' }
}
