// أدواتُ توليد وتطبيع slugs الروابط المخصّصة للمشتركين.
// الفلسفة: لكلّ حملةٍ رابطٌ قصيرٌ مقروءٌ مشتقٌّ من اسمها، يحلّ محلّ الأرقام العشوائيّة.

const AR_TO_EN = {
  ا:'a',أ:'a',إ:'a',آ:'a',ء:'a',ب:'b',ت:'t',ث:'th',ج:'j',ح:'h',خ:'kh',
  د:'d',ذ:'th',ر:'r',ز:'z',س:'s',ش:'sh',ص:'s',ض:'d',ط:'t',ظ:'z',
  ع:'a',غ:'gh',ف:'f',ق:'q',ك:'k',ل:'l',م:'m',ن:'n',ه:'h',و:'w',ي:'y',
  ى:'a',ة:'h',ؤ:'w',ئ:'y',
}

/**
 * يحوّل نصًّا عربيًّا أو إنجليزيًّا إلى slug آمنٍ للرابط:
 * - يُترجم الحروف العربيّة إلى لاتينيّة (a-z).
 * - يُبقي الأرقام والشُرَط، يحوّل المسافات إلى شُرَط.
 * - يطوي الشُرَط المتتالية، يحذف الشُرَط من الأطراف.
 * - يحدّ الطول الأقصى ٤٠ حرفًا.
 */
export function slugify(input) {
  const s = String(input || '').trim().toLowerCase()
  if (!s) return ''
  let out = ''
  for (const ch of s) {
    if (AR_TO_EN[ch] !== undefined) out += AR_TO_EN[ch]
    else if (/[a-z0-9]/.test(ch)) out += ch
    else if (/[\s_\-]/.test(ch)) out += '-'
    // غير ذلك: يُحذف
  }
  return out.replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

/**
 * يتحقّق من صلاحيّة slug للحفظ — نفس قيود slugify لكن يردّ قيمةً منطقيّة.
 * ٤–٤٠ حرفًا، حروف صغيرة وأرقام وشُرَط فقط، لا يبدأ/ينتهي بشُرطة.
 */
export function isValidSlug(s) {
  return typeof s === 'string' && /^[a-z0-9](?:[a-z0-9-]{2,38})[a-z0-9]$/.test(s)
}

/**
 * يقترح slug من اسم الحملة + لاحقةٍ عشوائيّةٍ قصيرةٍ لضمان التفرّد عادةً.
 * مثال: «حملة محمد» → "hamla-mhmd-x9q"
 */
export function suggestSlug(orgName) {
  const base = slugify(orgName) || 'hamla'
  const tail = Math.random().toString(36).slice(2, 5)
  return (base + '-' + tail).slice(0, 40)
}
