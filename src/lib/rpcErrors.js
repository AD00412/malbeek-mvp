// ترجمةُ رموز أخطاء RPC الموحَّدة إلى رسائل عربيّة.
// قاعدة ملبّيك تستخدم نمط "stable code + Arabic hint" — هذا الملفّ هو الجانب المقابل في الواجهة.

const MAP = {
  TRIAL_TRIP_LIMIT: 'باقتك التجريبية تسمح برحلةٍ واحدة فقط. رقِّ إلى باقة ملبّيك (٢٤٩ ﷼) لإضافة رحلاتٍ غير محدودة.',
  TRIP_NOT_FOUND: 'الرحلة غير موجودة.',
  NOT_AUTHORIZED: 'غير مصرّحٍ لك بهذه العمليّة.',
  SEAT_OUT_OF_RANGE: 'رقم المقعد خارج تخطيط الباص.',
  ROOM_FULL: 'الغرفة مكتملة. اختر غرفةً أخرى.',
  ROOM_GENDER_MISMATCH: 'الغرفة لا تتوافق مع جنس المعتمر.',
  ROOM_TRIP_MISMATCH: 'الغرفة لا تنتمي لهذه الرحلة.',
  TRIP_NOT_BOOKABLE: 'الحجز مغلقٌ على هذه الرحلة حاليًّا.',
  TRIP_DEPARTED: 'انطلقت هذه الرحلة — تعذّر الحجز.',
}

const isArabic = (s) => /[؀-ۿ]/.test(s)

/**
 * يقبل error من supabase أو رسالةً نصّيّة. يُرجع نصًّا عربيًّا للعرض.
 *
 * مصدر الحقيقة بالترتيب:
 *  1. رمزٌ ثابتٌ معروف في MAP (سواء عبر match تامٍّ أو substring).
 *  2. `err.hint` العربيّ من القاعدة (من `using hint = '...'`) — قاعدة البيانات هي المصدر.
 *  3. رسالةٌ عربيّةٌ من القاعدة (من `raise exception 'نصٌّ عربيّ'`).
 *  4. fallback مع تفاصيل تقنيّةٍ بين قوسين عند توفّر رسالةٍ تشخيصيّة.
 */
export function translateRpcError(err, fallback = 'تعذّر إتمام العمليّة.') {
  if (!err) return ''
  const msg = String(err.message || err || '')

  for (const code of Object.keys(MAP)) {
    if (msg === code || msg.includes(code)) return MAP[code]
  }

  if (err.hint && isArabic(err.hint)) return err.hint
  if (isArabic(msg)) return msg

  return msg ? `${fallback} (${msg})` : fallback
}
