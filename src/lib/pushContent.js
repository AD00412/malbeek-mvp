// محتوى الإشعارات الهادف + الروابط العميقة (deep-links) لكل نوع حدث.
// يُستعمَل أماميًّا (showNotification) وكبنيةٍ للحمولة التي يرسلها الخادم
// (edge function) عند وصول الحدث للمستخدم وهو خارج التطبيق.
// لا تُستعمَل كلمةُ «from» إطلاقًا — عنوانٌ واضحٌ + جسمٌ هادف.

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

/**
 * يبني محتوى الإشعار من صفّ notifications: عنوانٌ + جسمٌ + رابطٌ عميق.
 * يُفضّل عنوان/جسم القاعدة (هادفان بالفعل) ويُكمّل بالخريطة + يُلحق ref_trip.
 * @returns {{ title:string, body:string, url:string, tag:string }}
 */
export function buildNotificationContent(row = {}) {
  const meta = KIND[row.kind] || {}
  const title = (row.title && row.title.trim()) || meta.title || 'ملبّيك'
  const body = (row.body && row.body.trim()) || ''
  let url = meta.url || '/'
  if (row.ref_trip && url.includes('?')) url += `&trip=${row.ref_trip}`
  else if (row.ref_trip) url += `?trip=${row.ref_trip}`
  return { title, body, url, tag: row.kind ? `mlk-${row.kind}` : 'mlk' }
}
