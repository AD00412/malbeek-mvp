// مقياس قوّة كلمة المرور — بلا تبعيّات. يقيّم الطول وتنوّع المحارف ويكشف
// الأنماط الشائعة الضعيفة. يُكمّله فحصُ التسريب (HaveIBeenPwned) في الخادم
// عبر Supabase Leaked Password Protection.

// قائمةٌ مختصرةٌ بأكثر كلمات المرور شيوعًا/ضعفًا (فحصٌ محلّيٌّ سريع).
const COMMON = new Set([
  'password', 'password1', '123456', '12345678', '123456789', '111111', '000000',
  'qwerty', 'abc123', 'iloveyou', 'admin', 'welcome', 'monkey', 'dragon', '1234567890',
  'qwerty123', 'password123', 'letmein', 'football', 'sunshine', 'princess', 'azerty',
  '123123', 'admin123', 'passw0rd', 'p@ssw0rd', 'malbeek', 'mulabeek', 'umrah', 'عمرة',
])

/**
 * @returns {{ score:0|1|2|3|4, label:string, suggestions:string[], ok:boolean }}
 *  ok = مقبولة للاستعمال (score >= 2 وطول >= 8).
 */
export function scorePassword(pw) {
  const p = String(pw || '')
  const suggestions = []
  if (!p) return { score: 0, label: 'فارغة', suggestions: ['أدخل كلمة مرور'], ok: false }

  const lower = p.toLowerCase()
  if (COMMON.has(lower)) {
    return { score: 0, label: 'ضعيفة جدًّا — شائعة', suggestions: ['هذه كلمة مرورٍ شائعةٌ جدًّا — اختر غيرها تمامًا'], ok: false }
  }

  let score = 0
  const len = p.length
  if (len >= 8) score++; else suggestions.push('استخدم ٨ أحرف على الأقل')
  if (len >= 12) score++
  const classes = [/[a-z]/.test(p), /[A-Z]/.test(p), /[0-9]/.test(p), /[^A-Za-z0-9]/.test(p)].filter(Boolean).length
  if (classes >= 2) score++; else suggestions.push('اخلط أحرفًا وأرقامًا')
  if (classes >= 3) score++
  if (classes >= 4) suggestions.length === 0 && suggestions.push('ممتازة')
  // أنماطٌ متكرّرة/متسلسلة تخفض القوّة
  if (/^(.)\1+$/.test(p) || /0123|1234|2345|abcd|qwer/i.test(p)) {
    score = Math.max(0, score - 2)
    suggestions.push('تجنّب التسلسل أو التكرار (مثل 1234 أو aaaa)')
  }
  score = Math.max(0, Math.min(4, score))

  const labels = ['ضعيفة جدًّا', 'ضعيفة', 'متوسّطة', 'قويّة', 'قويّة جدًّا']
  const ok = score >= 2 && len >= 8
  if (!ok && len >= 8 && suggestions.length === 0) suggestions.push('قوِّها بأحرفٍ كبيرةٍ وأرقامٍ ورموز')
  return { score, label: labels[score], suggestions: suggestions.slice(0, 2), ok }
}
