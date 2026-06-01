import { createClient } from '@supabase/supabase-js'

/* ============================================================
   عميل Supabase — مهيّأٌ لمصادقةٍ فوريةٍ لا تعلق
   ============================================================ */

const rawUrl = import.meta.env.VITE_SUPABASE_URL
const anon   = import.meta.env.VITE_SUPABASE_ANON_KEY

/* ---------- تشخيصٌ مبكرٌ لأخطاء التكوين الشائعة ---------- */
if (!rawUrl || !anon) {
  // eslint-disable-next-line no-console
  console.error('⚠️ متغيرات Supabase ناقصة: تأكد من VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env')
}
if (rawUrl && /\/(rest|auth)\/v1\/?$/.test(rawUrl)) {
  // eslint-disable-next-line no-console
  console.error(
    '⚠️ خطأ في VITE_SUPABASE_URL: يجب أن يكون العنوان الأساسي فقط (بلا /rest/v1/ ولا /auth/v1/).\n' +
    '   الصحيح:  https://xxxxx.supabase.co\n   الحالي:  ' + rawUrl
  )
}
if (rawUrl && rawUrl.includes('YOUR-PROJECT-REF')) {
  // eslint-disable-next-line no-console
  console.error('⚠️ VITE_SUPABASE_URL لا يزال على القيمة النموذجية. ضع رابط مشروعك من Supabase ▸ Project Settings ▸ API')
}

// نُزيل أي مسارٍ بعد .co احتياطًا
const url = (rawUrl || '').replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, '')

/**
 * قفلٌ صوريّ (no-op) لعمليات المصادقة.
 *
 * تستخدم Supabase قفل Web Locks لتزامن تجديد التوكِن بين تبويبات المتصفّح،
 * وتطلبه بانتظارٍ لا نهائي. المشكلة: لو احتُجِز القفل (تبويبٌ قديم لم يُغلق،
 * أو StrictMode/HMR في التطوير يترك ماسكًا معلّقًا) تتجمّد كل عمليات المصادقة
 * — وتبقى الشاشة على "جارٍ التحميل…" أو يعلق زرّ الدخول.
 *
 * منصّةٌ أحادية التبويب لا تحتاج هذا التزامن، فننفّذ العملية مباشرةً بلا قفل
 * ⇒ مصادقةٌ فوريةٌ لا تعلق أبدًا.
 */
const noopLock = async (_name, _acquireTimeout, fn) => fn()

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'malbeek.auth',
    lock: noopLock,
  },
  global: {
    headers: { 'x-client-info': 'malbeek-mvp' },
  },
})
