/* ============================================================
   ملبّيك · مخطّط الباص (قابل للضبط) + سياسات التخصيص
   - صفوفٌ بتشكيلة 2 + ممرّ + 2  (٤ مقاعد لكل صف)
   - صفٌّ خلفيٌّ متراصّ (افتراضيًّا ٥ مقاعد)
   - الترقيم من اليمين لليسار، يبدأ من مقدّمة الباص
   - الأبواب دائمًا يمينًا · السائق ومساعده أعلى اليسار (بصريًّا فقط)
   ============================================================ */

export const DEFAULT_ROWS = 11
export const DEFAULT_BACK = 5

const KIND = { WIN: 'window', AISLE: 'aisle', BACK: 'back' }

/** إجمالي المقاعد لتخطيطٍ معيّن */
export function seatCount(rows = DEFAULT_ROWS, back = DEFAULT_BACK) {
  return rows * 4 + back
}

/**
 * توليد كل المقاعد بمواقعها (row, col) لتخطيطٍ قابلٍ للضبط.
 * الأعمدة يمين←يسار: 0(نافذة يمين) 1(ممرّ يمين) [ممرّ] 3(ممرّ يسار) 4(نافذة يسار)
 */
export function buildSeats(rows = DEFAULT_ROWS, back = DEFAULT_BACK) {
  const R = Math.max(1, Math.min(20, rows | 0))
  const B = Math.max(0, Math.min(6, back | 0))
  const seats = []
  for (let row = 0; row < R; row++) {
    const base = row * 4 + 1
    seats.push({ no: base,     row, col: 0, kind: KIND.WIN,   side: 'right', rows: R })
    seats.push({ no: base + 1, row, col: 1, kind: KIND.AISLE, side: 'right', rows: R })
    seats.push({ no: base + 2, row, col: 3, kind: KIND.AISLE, side: 'left',  rows: R })
    seats.push({ no: base + 3, row, col: 4, kind: KIND.WIN,   side: 'left',  rows: R })
  }
  for (let i = 0; i < B; i++) {
    seats.push({ no: R * 4 + 1 + i, row: R, col: i, kind: KIND.BACK,
      side: B <= 1 ? 'mid' : i < B / 2 ? 'right' : 'left', rows: R, backCount: B })
  }
  return seats
}

/* سياسات التخصيص */
export const SEATING_POLICIES = [
  { v: 'all_male',       t: 'ذكور فقط' },
  { v: 'all_female',     t: 'إناث فقط' },
  { v: 'mixed_split_lr', t: 'نص ذكور (يمين) ونص إناث (يسار)' },
  { v: 'mixed_split_fb', t: 'نص شباب (أمام) ونص بنات (خلف)' },
  { v: 'families_back',  t: 'ذكور وعوائل (العوائل خلف)' },
]

/** 'male' | 'female' | 'family' | 'any' حسب السياسة والمقعد (مع مراعاة عدد الصفوف) */
export function allowedFor(seat, policy) {
  const rows = seat?.rows || DEFAULT_ROWS
  const isBack = seat?.kind === KIND.BACK
  const rowIndex = isBack ? rows : seat.row
  switch (policy) {
    case 'all_female': return 'female'
    case 'mixed_split_lr':
      if (isBack) return 'any'
      return seat.side === 'right' ? 'male' : seat.side === 'left' ? 'female' : 'any'
    case 'mixed_split_fb':
      return rowIndex < Math.floor(rows / 2) ? 'male' : 'female'
    case 'families_back':
      return rowIndex < Math.ceil(rows * 0.4) ? 'male' : 'family'
    case 'all_male':
    default: return 'male'
  }
}

/* هل المعتمر مسموحٌ بهذا المقعد؟
   - any:    متاحٌ للجميع
   - family: منطقة العوائل — للعائلات فقط (ذكورًا أو إناثًا ضمن عائلة)
   - male/female: لجنسٍ محدّد، وتقبل العائلةَ من نفس الجنس أيضًا */
export function isAllowed(seat, policy, gender, isFamily) {
  const a = allowedFor(seat, policy)
  if (a === 'any') return true
  if (a === 'family') return !!isFamily      // منطقة العوائل محصورةٌ بالعائلات
  return a === gender                        // منطقة ذكور/إناث حسب الجنس
}

export function policyLabel(v) {
  return (SEATING_POLICIES.find((p) => p.v === v) || SEATING_POLICIES[0]).t
}
export function zoneLabel(a) {
  return { male: 'ذكور', female: 'إناث', family: 'عوائل', any: '—' }[a] || ''
}
