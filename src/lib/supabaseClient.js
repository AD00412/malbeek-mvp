import { createClient } from '@supabase/supabase-js'

const rawUrl = import.meta.env.VITE_SUPABASE_URL
const anon   = import.meta.env.VITE_SUPABASE_ANON_KEY

// تشخيصٌ مبكرٌ لأخطاء التكوين الشائعة — يطبع في الكونسول قبل أي طلبٍ شبكي
if (!rawUrl || !anon) {
  // eslint-disable-next-line no-console
  console.error('⚠️ متغيرات Supabase ناقصة: تأكد من VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env')
}
if (rawUrl && /\/(rest|auth)\/v1\/?$/.test(rawUrl)) {
  // eslint-disable-next-line no-console
  console.error(
    '⚠️ خطأ في VITE_SUPABASE_URL: يجب أن يكون العنوان الأساسي فقط (بلا /rest/v1/ ولا /auth/v1/).\n' +
    '   الصحيح:  https://xxxxx.supabase.co\n' +
    '   الحالي:  ' + rawUrl + '\n' +
    '   صحّح .env ثم أعد تشغيل  npm run dev'
  )
}
if (rawUrl && rawUrl.includes('YOUR-PROJECT-REF')) {
  // eslint-disable-next-line no-console
  console.error('⚠️ VITE_SUPABASE_URL لا يزال على القيمة النموذجية. ضع رابط مشروعك من Supabase ▸ Project Settings ▸ API')
}

// نُزيل أي مسارٍ بعد .co احتياطًا (يحمي حتى لو نسي المستخدم تصحيح .env)
const url = (rawUrl || '').replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, '')

/**
 * قفلٌ بحدٍّ زمني لعمليات المصادقة.
 *
 * مكتبة Supabase تستخدم Web Locks لتزامن تحديث التوكِن بين التبويبات.
 * المشكلة: تطلب القفل بانتظارٍ لا نهائي (acquireTimeout = -1)، فإن احتُجِز
 * القفل (مثلًا StrictMode في التطوير يُشغّل getSession مرّتين، أو تبويبٌ آخر
 * توقّف وهو ممسكٌ بالقفل) تتجمّد عمليات الدخول/الجلسة إلى الأبد.
 *
 * الحل: نلتزم الحدّ الزمني المطلوب، ولو تعذّر الحصول على القفل خلاله ننفّذ
 * العملية بلا قفل بدلًا من التجمّد. آمنٌ تمامًا للاستخدام أحادي التبويب،
 * ويُزيل التجمّد نهائيًّا في كل الحالات.
 */
async function authLock(name, acquireTimeout, fn) {
  const locks = globalThis?.navigator?.locks
  if (!locks?.request) return await fn()           // متصفّحٌ قديمٌ بلا Web Locks

  const capMs = acquireTimeout < 0 ? 8000 : acquireTimeout
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), capMs)
  try {
    return await locks.request(`sb-auth:${name}`, { mode: 'exclusive', signal: ctrl.signal }, fn)
  } catch (e) {
    if (e?.name === 'AbortError') {
      // eslint-disable-next-line no-console
      console.warn('⏱️ تعذّر الحصول على قفل المصادقة خلال المهلة — أُكمل بلا قفل لتفادي التجمّد.')
      return await fn()
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: authLock,
  },
})
