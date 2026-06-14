// ترجمةُ رموز أخطاء RPC الموحَّدة إلى رسائل عربيّة.
// قاعدة ملبّيك تستخدم نمط "stable code + Arabic hint" — هذا الملفّ هو الجانب المقابل في الواجهة.

const MAP = {
  TRIAL_TRIP_LIMIT: 'باقتك التجريبية تسمح برحلةٍ واحدة فقط. رقِّ إلى باقة ملبّيك لإضافة المزيد.',
  TRIP_NOT_FOUND: 'الرحلة غير موجودة.',
  NOT_AUTHORIZED: 'غير مصرّحٍ لك بهذه العمليّة.',
  SEAT_OUT_OF_RANGE: 'رقم المقعد خارج تخطيط الباص.',
}

/** يقبل error من supabase أو رسالةً نصّيّة. يُرجع نصًّا عربيًّا. */
export function translateTripError(err, fallback = 'تعذّر إتمام العمليّة.') {
  if (!err) return ''
  const msg = String(err.message || err || '')
  for (const code of Object.keys(MAP)) {
    if (msg.includes(code)) return MAP[code]
  }
  // رسائل عربيّة من تريغرات/استثناءاتٍ أخرى تمرّ كما هي
  return /[؀-ۿ]/.test(msg) ? msg : fallback
}
