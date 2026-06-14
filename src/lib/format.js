// أدوات تطبيع/تحقّق مشتركة — تطابق تريغرات القاعدة (دفاعٌ متعدّد الطبقات).
// تُستخدم في CustomerJoin و PassengerFormModal و CustomerBooking.

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'

/** تحويل الأرقام العربية-الهنديّة إلى لاتينيّة */
export function toLatinDigits(s = '') {
  return String(s ?? '').replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
}

/** تطبيع الجوال السعودي إلى 05XXXXXXXX (يقبل +9665../9665../5../05..) */
export function normalizePhone(raw = '') {
  let p = toLatinDigits(raw).replace(/[^0-9]/g, '')
  if (/^9665[0-9]{8}$/.test(p)) p = '0' + p.slice(3)
  else if (/^5[0-9]{8}$/.test(p)) p = '0' + p
  return p
}

/** قصّ الاسم وتوحيد المسافات */
export function cleanName(v = '') {
  return v.trim().replace(/\s+/g, ' ')
}

export function isValidNationalId(v = '') {
  return /^[12][0-9]{9}$/.test(toLatinDigits(v).trim())
}
export function isValidSaPhone(v = '') {
  return /^05[0-9]{8}$/.test(normalizePhone(v))
}
export function isValidEmail(v = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

/** صيغة wa.me: 9665XXXXXXXX (السعوديّة) — يُرجع '' إن الرقم غير صالح. */
export function toWaPhone(raw = '') {
  const p = normalizePhone(raw)            // 05XXXXXXXX
  return /^05[0-9]{8}$/.test(p) ? '966' + p.slice(1) : ''
}

/** يبني رابط wa.me آمنًا. إن غاب الرقم يفتح WhatsApp بخيار اختيار جهة الاتصال. */
export function waMeLink(phone, text = '') {
  const p = toWaPhone(phone)
  const q = text ? `?text=${encodeURIComponent(text)}` : ''
  return `https://wa.me/${p}${q}`
}

/** قوّة كلمة المرور: 0..3 */
export function pwStrength(v = '') {
  let s = 0
  if (v.length >= 6) s++
  if (v.length >= 10) s++
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++
  if (/[0-9]/.test(v) && /[^A-Za-z0-9]/.test(v)) s++
  return Math.min(s, 3)
}
export const PW_LABEL = ['', 'ضعيفة', 'متوسّطة', 'قويّة']
