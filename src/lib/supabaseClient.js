import { createClient } from '@supabase/supabase-js'
import { logEvent, instrumentSupabaseAuth, instrumentRealtime } from './debugLog'

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

/**
 * fetch مخصَّصٌ لـSupabase حصرًا — يَضمن مهلةً قصوى لكلّ طلب.
 *
 * المشكلةُ التي يَحلّها (مكشوفةٌ بـ debugLog):
 *   iOS WebView يُجمِّد fetch promises قيدَ الانتظار حتّى لخروجٍ < ١ث،
 *   فتَبقى معلَّقةً إلى الأبد — لا تَنجح ولا تَفشل. النتيجة: زرٌّ يَدور
 *   بلا نهاية، شاشةٌ متجمّدةٌ، console نظيف.
 *
 * يُغطّي فقط طلبات Supabase (مرَّ عبر العميل) — لا يَلمس window.fetch
 * العامّ ولا يَعترض رفعَ الصور أو أيَّ شبكةٍ خارجيّةٍ.
 *
 * عند انتهاء المهلة: AbortError يُرمى → catch المكوّن يَفتح →
 * يُعرَض خطأٌ قابلٌ لإعادة المحاولة. لا reload، لا حالةٌ عالميّة.
 */
const REQUEST_TIMEOUT_MS = 10_000   // ١٠ث — تَجمّدٌ مَحدودٌ خيرٌ من أبديّ

/** يَستخرج وصفًا مختصرًا لـURL يُمكن قراءته في السجلّ. */
function shortenUrl(input) {
  const raw = typeof input === 'string' ? input : (input?.url || '')
  try {
    const u = new URL(raw)
    // /rest/v1/passengers?select=... → rest:passengers
    const m = u.pathname.match(/^\/(rest|auth|storage|realtime|functions)\/v\d+\/(.+)$/)
    if (m) {
      const kind = m[1].slice(0, 3)
      const path = m[2].split('?')[0].split('/')[0]
      return `${kind}:${path}`
    }
    return u.pathname.slice(0, 40)
  } catch { return String(raw).slice(0, 40) }
}

function makeFetchWithTimeout() {
  return function supabaseFetch(input, init = {}) {
    const method = (init.method || 'GET').toUpperCase()
    const label  = `${method} ${shortenUrl(input)}`
    const start  = performance.now()
    logEvent('SB', `→ ${label}`)

    const ctrl = new AbortController()
    const userSignal = init.signal
    const onUserAbort = () => ctrl.abort()
    if (userSignal) {
      if (userSignal.aborted) ctrl.abort()
      else userSignal.addEventListener('abort', onUserAbort, { once: true })
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { ctrl.abort(new DOMException('Request timeout', 'AbortError')) }
      catch { try { ctrl.abort() } catch { /* ignore */ } }
    }, REQUEST_TIMEOUT_MS)

    return fetch(input, { ...init, signal: ctrl.signal })
      .then((res) => {
        const ms = Math.round(performance.now() - start)
        const status = res?.status ?? '?'
        if (!res?.ok && status !== 204 && status !== 304) {
          logEvent('SB-ERR', `${label} → ${status} (${ms}ms)`)
        } else {
          logEvent('SB', `← ${label} ${status} (${ms}ms)`)
        }
        return res
      })
      .catch((err) => {
        const ms = Math.round(performance.now() - start)
        if (timedOut || err?.name === 'AbortError') {
          logEvent('TIMEOUT', `${label} (${ms}ms)`, { reason: timedOut ? 'client-timeout' : 'abort' })
        } else {
          logEvent('NETERR', `${label} (${ms}ms)`, { message: err?.message })
        }
        throw err
      })
      .finally(() => {
        clearTimeout(timer)
        if (userSignal) try { userSignal.removeEventListener('abort', onUserAbort) } catch { /* ignore */ }
      })
  }
}

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
    fetch: makeFetchWithTimeout(),
  },
})

// تتبّعٌ تلقائيٌّ لأحداث المصادقة والـrealtime (يَظهر في DebugPanel)
instrumentSupabaseAuth(supabase)
instrumentRealtime(supabase)
