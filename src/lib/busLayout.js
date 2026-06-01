/* ============================================================
   ملبّيك · مخطّط الباص (٤٩ مقعدًا) + سياسات التخصيص
   - ١١ صفًّا بتشكيلة 2+ممرّ+2 = ٤٤ مقعدًا
   - صفٌّ خلفيٌّ من ٥ مقاعد = ٤٥–٤٩
   - الترقيم من اليمين لليسار، يبدأ من مقدّمة الباص
   - مقعد السائق ومساعده في الأعلى يسارًا (تظهر بصريًا فقط)
   ============================================================ */

export const TOTAL_SEATS = 49

/** أنواع المقاعد البصرية */
const KIND = { WIN: 'window', AISLE: 'aisle', BACK: 'back' }

/**
 * توليد كل المقاعد بمواقعها على شبكة (row, col).
 * الأعمدة من اليمين لليسار: 0(نافذة يمين) · 1(ممرّ يمين) · 2(ممرّ) · 3(ممرّ يسار) · 4(نافذة يسار)
 * الترقيم: 1,2 يمين · 3,4 يسار · ثم 5,6 يمين · 7,8 يسار · …
 */
export function buildSeats() {
  const seats = []
  for (let row = 0; row < 11; row++) {
    const base = row * 4 + 1
    seats.push({ no: base,     row, col: 0, kind: KIND.WIN,   side: 'right' })
    seats.push({ no: base + 1, row, col: 1, kind: KIND.AISLE, side: 'right' })
    seats.push({ no: base + 2, row, col: 3, kind: KIND.AISLE, side: 'left'  })
    seats.push({ no: base + 3, row, col: 4, kind: KIND.WIN,   side: 'left'  })
  }
  // الصفّ الخلفي (٤٥–٤٩) — ٥ مقاعد متراصّةٌ من اليمين لليسار
  for (let i = 0; i < 5; i++) {
    seats.push({ no: 45 + i, row: 11, col: i, kind: KIND.BACK, side: i < 2 ? 'right' : i > 2 ? 'left' : 'mid' })
  }
  return seats
}

/* سياسات التخصيص — الجنس المسموح لكل مقعدٍ تبعًا للسياسة */
export const SEATING_POLICIES = [
  { v: 'all_male',       t: 'ذكور فقط' },
  { v: 'all_female',     t: 'إناث فقط' },
  { v: 'mixed_split_lr', t: 'نص ذكور (يمين) ونص إناث (يسار)' },
  { v: 'mixed_split_fb', t: 'نص شباب (أمام) ونص بنات (خلف)' },
  { v: 'families_back',  t: 'ذكور وعوائل (العوائل خلف، الذكور أمام)' },
]

/**
 * يُرجع 'male' | 'female' | 'family' | 'any' حسب السياسة والمقعد.
 * - any: السياسة لا تقيّد (مثل مقعدٍ في الصفّ المخلوط)
 * - family: مخصّصٌ للعائلات (يقبل ذكورًا وإناثًا)
 */
export function allowedFor(seat, policy) {
  switch (policy) {
    case 'all_female': return 'female'
    case 'mixed_split_lr':
      return seat.side === 'right' ? 'male' : seat.side === 'left' ? 'female' : 'any'
    case 'mixed_split_fb':
      // أوّل ٦ صفوف ذكور، الباقي إناث
      return seat.row < 6 ? 'male' : 'female'
    case 'families_back':
      // ٤ صفوف أمامية ذكور، الباقي عوائل
      return seat.row < 4 ? 'male' : 'family'
    case 'all_male':
    default: return 'male'
  }
}

/* هل المعتمر مسموحٌ بهذا المقعد وفق السياسة؟ */
export function isAllowed(seat, policy, gender, isFamily) {
  const a = allowedFor(seat, policy)
  if (a === 'any') return true
  if (a === 'family') return true   // العائلة تقبل أي جنس
  return a === gender
}

/* تسمية مختصرة للسياسة */
export function policyLabel(v) {
  return (SEATING_POLICIES.find((p) => p.v === v) || SEATING_POLICIES[0]).t
}

/* تسمية مختصرة للمنطقة (للظهور تحت كل مقعدٍ في الفلترة) */
export function zoneLabel(a) {
  return { male: 'ذكور', female: 'إناث', family: 'عوائل', any: '—' }[a] || ''
}
