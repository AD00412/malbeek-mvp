// دورة حياة الرحلة — تشتق من الحالة + التواريخ.
// مصدر واحد للواجهة (شارات + قفل الحجز) يطابق حارس قاعدة البيانات
// (guard_passenger_columns): العميل لا يحجز إلا رحلة status='open' لم يفت موعدها.

export function tripLifecycle(trip) {
  const now = Date.now()
  const depart = trip?.depart_at ? new Date(trip.depart_at).getTime() : null
  const ret = trip?.return_at ? new Date(trip.return_at).getTime() : null
  const status = trip?.status || 'open'

  const departed = depart != null && depart < now
  const returned = ret != null ? ret < now : (depart != null && depart < now - 7 * 86400000)
  // قابلة لحجز العميل: مفتوحة ولم ينطلق موعدها (يطابق التريغر تماما)
  const bookable = status === 'open' && !departed

  let phase, label, cls
  if (status === 'done' || returned) { phase = 'returned'; label = 'منتهية'; cls = 'info' }
  else if (departed)                 { phase = 'departed'; label = 'انطلقت'; cls = 'muted' }
  else if (status === 'closed')      { phase = 'closed';   label = 'مغلقة';  cls = 'warn' }
  else if (status === 'draft')       { phase = 'draft';    label = 'مسودة';  cls = 'muted' }
  else                               { phase = 'upcoming'; label = 'متاحة';  cls = 'ok' }

  const soon = bookable && depart != null && depart - now < 48 * 3600000 && depart - now > 0

  const reason = bookable ? '' :
    (status === 'done' || returned) ? 'انتهت هذه الرحلة.' :
    departed ? 'انطلقت هذه الرحلة — لم يعد الحجز متاحا.' :
    status === 'closed' ? 'أغلق الحجز على هذه الرحلة.' :
    status === 'draft' ? 'الرحلة لم تفتح للحجز بعد.' :
    'الحجز غير متاح حاليا.'

  return { phase, label, cls, bookable, departed, returned, soon, reason }
}
