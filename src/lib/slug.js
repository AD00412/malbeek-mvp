// تحويل عربي ↔ slug للروابط المخصصة لكل حملة.
// الفلسفة: ينتج نصا مقروءا يستطيع المعتمر تذكره (hamla-mohammed)،
// لا حروفا متقطعة (hmlh-mhmd) كما تنتجه الترجمة الحرفية.

// قاموس ذكي بالكلمات الشائعة في اسم الحملات (مع ومن دون ال‍ التعريف).
const WORD_MAP = {
  حملة: 'hamla', الحملة: 'hamla', حملتي: 'hamlati',
  رحلة: 'rihla', الرحلة: 'rihla', رحلات: 'rihlat',
  عمرة: 'omra', العمرة: 'omra', عمرة: 'omra',
  حج: 'hajj', الحج: 'hajj',
  محمد: 'mohammed', أحمد: 'ahmad', احمد: 'ahmad',
  خالد: 'khaled', خالدية: 'khaledia',
  علي: 'ali', عمر: 'omar', عثمان: 'othman', يوسف: 'youssef',
  عبدالله: 'abdullah', عبدالرحمن: 'abdulrahman', عبدالعزيز: 'abdulaziz',
  سعد: 'saad', سعود: 'saud', سلمان: 'salman', فهد: 'fahad', فيصل: 'faisal',
  صفوة: 'safwa', الصفوة: 'safwa', نور: 'noor', النور: 'noor',
  رحمة: 'rahma', الرحمة: 'rahma', رحمن: 'rahman', الرحمن: 'rahman',
  مسجد: 'masjid', الحرم: 'haram', مكة: 'makkah', المدينة: 'madinah',
  منى: 'mina', عرفة: 'arafa', مزدلفة: 'muzdalifa',
  روضة: 'rawda', الروضة: 'rawda', مدينة: 'madinah',
  زمزم: 'zamzam', كعبة: 'kaaba', الكعبة: 'kaaba',
  درب: 'darb', الدرب: 'darb', طريق: 'tariq', الطريق: 'tariq',
  بيت: 'bait', البيت: 'bait', دار: 'dar', الدار: 'dar',
  رواد: 'rowwad', الرواد: 'rowwad', وفاء: 'wafa', الوفاء: 'wafa',
  أمل: 'amal', الأمل: 'amal', أمان: 'aman', الأمان: 'aman',
  سعادة: 'saada', السعادة: 'saada', خير: 'khair', الخير: 'khair',
  بركة: 'baraka', البركة: 'baraka', نعمة: 'nima',
  مسار: 'masar', المسار: 'masar', قلب: 'qalb', القلب: 'qalb',
  درة: 'durra', الدرة: 'durra', لؤلؤة: 'lulua',
  مشاعر: 'mashaer', المشاعر: 'mashaer', نسائم: 'nasaim', النسائم: 'nasaim',
  جوهر: 'jawhar', الجوهر: 'jawhar', شموع: 'shumoo', الشموع: 'shumoo',
}

// تحويل حرفي ذكي — أبسط من الـ romanization الأكاديمي، لكنه يضيف الصوائت
// الشائعة (a, u, i) بعد الحرف بحيث ينتج نصا قابلا للنطق.
const LETTER_MAP = {
  ا:'a',أ:'a',إ:'i',آ:'aa',ء:'',
  ب:'b',ت:'t',ث:'th',ج:'j',ح:'h',خ:'kh',
  د:'d',ذ:'th',ر:'r',ز:'z',س:'s',ش:'sh',ص:'s',ض:'d',ط:'t',ظ:'z',
  ع:'',غ:'gh',ف:'f',ق:'q',ك:'k',ل:'l',م:'m',ن:'n',ه:'h',و:'w',ي:'y',
  ى:'a',ة:'a',ؤ:'w',ئ:'y',
  // الحركات (diacritics) — مفاتيح مقتبسة لأنها رموز مكونة من نقاط فوق/تحت لا حروف:
  '':'','':'','':'','':'a','':'u','':'i','':'','':'',
}

function transliterateLetters(word) {
  if (!word) return ''
  let out = ''
  // فلتر بادئة «ال» الشائعة إن وجدت ليست جزءا من الاسم
  let w = word
  if (w.length > 3 && (w.startsWith('ال') || w.startsWith('الـ'))) w = w.replace(/^الـ?/, '')
  for (let i = 0; i < w.length; i++) {
    const ch = w[i]
    out += LETTER_MAP[ch] ?? ''
  }
  // أضف صائتة ضمنية بين كل ساكنين (تجعلها قابلة للنطق)
  out = out.replace(/([bcdfghjklmnpqrstvwxyz])([bcdfghjklmnpqrstvwxyz])/gi, '$1a$2')
  return out
}

/**
 * يحول كلمة عربية واحدة إلى slug-friendly Latin: قاموس أولا، ثم حرفيا.
 */
function transliterateWord(word) {
  const safe = word.trim()
  if (!safe) return ''
  if (WORD_MAP[safe]) return WORD_MAP[safe]
  // جرب بدون ال‍ التعريف
  const noAlif = safe.replace(/^الـ?/, '')
  if (WORD_MAP[noAlif]) return WORD_MAP[noAlif]
  return transliterateLetters(safe)
}

/**
 * يحول نصا كاملا (عربي/إنجليزي) إلى slug آمن للرابط.
 * - يقسم على المسافات والشرط
 * - يحول كل كلمة بقاموس أو حرفيا
 * - يبقي الأرقام كما هي
 * - يطوي الشرط، يحد الطول الأقصى ٤٠ حرفا.
 */
export function slugify(input) {
  const s = String(input || '').trim()
  if (!s) return ''
  // قسم على المسافات والشرط والفواصل
  const tokens = s.split(/[\s\-_,،.\/]+/).filter(Boolean)
  const out = []
  for (const t of tokens) {
    // إن كانت لاتينية/رقما، أبقها لكن صغرها
    if (/^[a-zA-Z0-9]+$/.test(t)) { out.push(t.toLowerCase()); continue }
    const tr = transliterateWord(t)
    if (tr) out.push(tr)
  }
  return out.join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * يتحقق من صلاحية slug للحفظ — حروف صغيرة وأرقام وشرط فقط،
 * ٤–٤٠ حرفا، لا يبدأ/ينتهي بشرطة، وغير محجوز لمسار النظام.
 */
const RESERVED_SLUGS = new Set([
  // مسارات النظام
  'login', 'signup', 'logout', 'dashboard', 'admin', 'customer', 'settings',
  'profile', 'account', 'auth', 'join', 'join-team', 'jt', 'j', 'h', 'm', 'p',
  'api', 'assets', 'public', 'static', 'icons', 'fonts', 'images', 'img',
  // مسارات شائعة نحتفظ بها للمستقبل
  'help', 'support', 'about', 'contact', 'terms', 'privacy', 'pricing',
  'home', 'index', 'new', 'edit', 'create', 'update', 'delete',
  'mulabeek', 'malbeek', 'ملبّيك', 'ملبّيك',
])
export function isReservedSlug(s) { return RESERVED_SLUGS.has(String(s || '').toLowerCase()) }

export function isValidSlug(s) {
  if (typeof s !== 'string') return false
  if (!/^[a-z0-9](?:[a-z0-9-]{2,38})[a-z0-9]$/.test(s)) return false
  return !isReservedSlug(s)
}

/**
 * يقترح slug من اسم الحملة (يستخدم القاموس إن أمكن).
 * إن نتج عن الترجمة شيء محجوز أو فارغ، يستخدم بديلا آمنا.
 */
export function suggestSlug(orgName) {
  let base = slugify(orgName)
  if (!base || base.length < 4 || isReservedSlug(base)) base = 'hamla'
  return base.slice(0, 40)
}
