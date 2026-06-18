// ترجمةُ رموز أخطاء RPC الموحَّدة إلى رسائل عربيّة.
// قاعدة ملبّيك تستخدم نمط "stable code + Arabic hint" — هذا الملفّ هو الجانب المقابل في الواجهة.

// رموزٌ محدَّدةٌ من قاعدتنا (مطابقات نصّيّة دقيقة).
const MAP = {
  TRIAL_TRIP_LIMIT: 'باقتك التجريبية تسمح برحلةٍ واحدة فقط. رقِّ إلى باقة ملبّيك (٩٩ ﷼/شهر) لإضافة رحلاتٍ غير محدودة.',
  TRIP_NOT_FOUND: 'الرحلة غير موجودة.',
  NOT_AUTHORIZED: 'غير مصرّحٍ لك بهذه العمليّة.',
  SEAT_OUT_OF_RANGE: 'رقم المقعد خارج تخطيط الباص.',
  ROOM_FULL: 'الغرفة مكتملة. اختر غرفةً أخرى.',
  ROOM_GENDER_MISMATCH: 'الغرفة لا تتوافق مع جنس المعتمر.',
  ROOM_TRIP_MISMATCH: 'الغرفة لا تنتمي لهذه الرحلة.',
  TRIP_NOT_BOOKABLE: 'الحجز مغلقٌ على هذه الرحلة حاليًّا.',
  TRIP_DEPARTED: 'انطلقت هذه الرحلة — تعذّر الحجز.',
}

// أنماطٌ عامّةٌ من Supabase/Postgres/Auth — تنقذنا من الرسائل الإنجليزيّة.
// مأخوذةٌ من MUTAMIR_MASTER_PROMPT.md (الجزء هـ-٢) وموسَّعةٌ بحالاتٍ شائعةٍ في تجربتنا.
const PATTERNS = [
  // Auth
  [/invalid login credentials/i,                    'بيانات الدخول غير صحيحة.'],
  [/email not confirmed/i,                          'البريد لم يُؤكَّد بعد — تحقّق من صندوقك.'],
  [/user already registered|already exists/i,       'هذا البريد مسجّلٌ مسبقًا.'],
  [/email rate limit exceeded|over_email_send_rate/i, 'تم تجاوز الحدّ المسموح به. حاول بعد دقيقة.'],
  [/password should be at least|weak password/i,    'كلمة المرور قصيرةٌ جدًّا.'],
  [/signup .* disabled|signups not allowed/i,       'التسجيل مغلقٌ مؤقّتًا.'],

  // RLS / Session
  [/permission denied|row-level/i,                  'غير مصرّحٍ لك بهذه العمليّة.'],
  [/jwt expired|invalid jwt|token has expired/i,    'انتهت الجلسة. سجّل دخولك من جديد.'],

  // Schema drift (مهمّ — يكشف اختلالًا بين الواجهة والقاعدة)
  [/could not find the .* column/i,                 'حقلٌ مطلوبٌ غير موجودٍ في القاعدة. تواصل مع الدعم.'],
  [/column .* does not exist/i,                     'حقلٌ مطلوبٌ غير موجودٍ في القاعدة. تواصل مع الدعم.'],
  [/could not find the table .* in the schema/i,    'بنيةُ القاعدة غير محدَّثة. تواصل مع الدعم.'],
  [/schema .* does not exist/i,                     'بنيةُ القاعدة غير محدَّثة. تواصل مع الدعم.'],

  // Data integrity
  [/duplicate key value/i,                          'هذا السجلّ موجودٌ مسبقًا.'],
  [/violates foreign key/i,                         'لا يمكن إتمام العمليّة — السجلّ مرتبطٌ بسجلٍّ آخر.'],
  [/violates check constraint/i,                    'قيمةٌ غير مقبولة.'],
  [/violates not-null constraint/i,                 'حقلٌ مطلوبٌ لم يُعبَّأ.'],
  [/invalid input syntax for type date/i,           'تاريخٌ غير صالح.'],
  [/invalid input syntax for type uuid/i,           'معرّفٌ غير صالح.'],
  [/invalid input syntax/i,                         'صيغةٌ غير صالحة لأحد الحقول.'],

  // Network
  [/failed to fetch|network ?error|net::err/i,      'تعذّر الاتصال. تحقّق من شبكتك ثمّ حاول.'],
  [/timeout|timed out/i,                            'انتهت مهلة الاتصال. أعد المحاولة.'],
  [/abort/i,                                        'تمّ إلغاء الطلب.'],

  // Storage
  [/file size .* exceeds|payload too large/i,       'حجم الملفّ كبير. خفّضه ثمّ أعد المحاولة.'],
  [/mime type .* not allowed|unsupported file type/i, 'نوع الملفّ غير مدعوم.'],
  [/object not found|the resource was not found/i,  'الملفّ غير موجود.'],
]

const isArabic = (s) => /[؀-ۿ]/.test(s)

/**
 * يقبل error من supabase أو رسالةً نصّيّة. يُرجع نصًّا عربيًّا للعرض.
 *
 * مصدر الحقيقة بالترتيب:
 *  1. رمزٌ ثابتٌ معروف في MAP (سواء عبر match تامٍّ أو substring).
 *  2. `err.hint` العربيّ من القاعدة (من `using hint = '...'`) — قاعدة البيانات هي المصدر.
 *  3. رسالةٌ عربيّةٌ من القاعدة (من `raise exception 'نصٌّ عربيّ'`).
 *  4. مطابقةُ نمطٍ عامٍّ من PATTERNS (Supabase/Postgres/Auth/Network/Storage).
 *  5. fallback مع تفاصيل تقنيّةٍ بين قوسين عند توفّر رسالةٍ تشخيصيّة.
 */
export function translateRpcError(err, fallback = 'تعذّر إتمام العمليّة.') {
  if (!err) return ''
  const msg = String(err.message || err || '')

  for (const code of Object.keys(MAP)) {
    if (msg === code || msg.includes(code)) return MAP[code]
  }

  if (err.hint && isArabic(err.hint)) return err.hint
  if (isArabic(msg)) return msg

  for (const [re, ar] of PATTERNS) {
    if (re.test(msg)) return ar
  }

  return msg ? `${fallback} (${msg})` : fallback
}
