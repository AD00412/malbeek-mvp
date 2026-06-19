import { supabase } from './supabaseClient'

/* ============================================================
 *  مُنسِّقُ الإيقاظ — نظامٌ مركزيٌّ لإحياء التطبيق بعد تعليق المتصفّح
 * ============================================================
 *
 *  المشكلةُ التي يحلّها:
 *    - iOS Safari / PWA standalone يجمّد جافاسكربت بعد ثوانٍ من الإخفاء.
 *      عند تعليقٍ طويل (>٣٠ث) تصبح الحالةُ زومبيًّا:
 *        × WebSocket حقّ Supabase Realtime ميّتٌ لكن المكتبة تظنّه حيًّا،
 *          فـ realtime.connect() لا يفعلُ شيئًا (idempotent على state مغشوش).
 *        × Promises التي بُدئت قبل التعليق قد تَعْلَق إلى الأبد (refreshSession مثلًا).
 *        × أحداث visibilitychange قد تأتي قبل أن يكون الـ event loop سليمًا تمامًا.
 *      النتيجة: تجمّدٌ كاملٌ للواجهة وعدم تحديثٍ للبيانات/الإشعارات.
 *
 *  الحلُّ الجذريّ:
 *    أ) كاشفُ تعليقٍ طويل (long-suspend detector):
 *       نبضةٌ كلَّ ثانية تحدّث lastTickAt. عند العودة، إن كانت الفجوة
 *       > LONG_SUSPEND_MS (٩٠ث) فالحالةُ غير قابلةٍ للإصلاح موضعيًّا —
 *       نعملُ window.location.reload(): انطلاقةٌ نظيفةٌ بدون زومبي.
 *    ب) إعادةُ اتّصالٍ صارمةٌ لـ Realtime: disconnect() ثمّ connect().
 *    ج) refreshSession ضمن Promise.race بمهلة ٥ث فلا يَعلق الإيقاظ.
 *    د) pageshow بلا شرط persisted — iOS PWA لا تستخدم bfcache دائمًا.
 *
 *  واجهةٌ بسيطة:
 *    - installWakeListeners() — تُستدعى مرّةً من AuthProvider.
 *    - onWake(cb) — يُسجّل callback لكلِّ إيقاظٍ ناجح.
 *    - triggerWake(reason) — إيقاظٌ يدويّ.
 * ============================================================ */

const WAKE_EVENT = 'malbeek:wake'
const THROTTLE_MS = 2000
// ★ أقلَّ خفّض من ٩٠ث إلى ٣٠ث — iOS يُعلِّق الـWebView بسرعة، وأيُّ HTTP request
//   يُنشأ بعد تعليقٍ أطول من ذلك يَكاد دائمًا يَعْلَق بلا اكتمال.
const LONG_SUSPEND_MS = 30_000
const HEARTBEAT_MS = 1000        // دقّةُ كاشف التعليق
const REFRESH_TIMEOUT_MS = 5000  // أقصى مهلةٍ لـ refreshSession فلا يَعلق
// ★ تجَسُّسٌ على fetch — إن عَلِق طلبٌ لـSupabase > ١٥ث، نُعيد التحميل
const FETCH_HANG_MS = 15_000
let lastWakeAt = 0
let lastTickAt = Date.now()
let installed = false

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

async function performWake(reason) {
  const now = Date.now()
  if (now - lastWakeAt < THROTTLE_MS) return
  lastWakeAt = now

  // ١) رفعُ الجلسة بمهلة — لا تَعلق على وعدٍ زومبيٍّ من قبل التعليق.
  //    نُجدِّدها استباقيًّا إن بقي > ٥ث؛ لا انتظار ٥ دقائق — سبب الـ "empty الزائف".
  let refreshed = false
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), REFRESH_TIMEOUT_MS)
    const exp = data?.session?.expires_at
    // كان: ‎< 5 * 60 * 1000‎ — نَتجنّب توكِنًا قاربَ الانتهاء أثناء العودة من الخلفية.
    if (exp) {
      const remainingMs = exp * 1000 - Date.now()
      if (remainingMs < 15 * 60 * 1000) {  // ١٥ دقيقة بدل ٥ — أأمنُ بعد تعليقٍ طويل
        await withTimeout(supabase.auth.refreshSession(), REFRESH_TIMEOUT_MS)
        refreshed = true
      }
    } else {
      // لا جلسة — حاول refreshSession مباشرةً (قد يَنجح إن وُجد refresh_token محلّيّ)
      await withTimeout(supabase.auth.refreshSession(), REFRESH_TIMEOUT_MS)
      refreshed = true
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined') console.warn('[wake] refreshSession failed:', e?.message || e)
  }

  // ٢) إعادةُ اتّصالٍ صارمةٌ لـ Realtime — كسرُ زومبي الـ WS بعد التعليق.
  try {
    const rt = supabase?.realtime
    if (rt?.disconnect) { try { rt.disconnect() } catch { /* ignore */ } }
    if (rt?.connect) rt.connect()
  } catch { /* ignore */ }

  // ★ مهلةٌ صغيرةٌ لإتاحة الفرصة لـ supabase-js أن يَنشر التوكِنَ المُجدَّد
  //    إلى headers قبل أن يُطلق المشتركون استعلاماتهم — يَمنع «empty الزائف».
  if (refreshed) {
    await new Promise((r) => setTimeout(r, 250))
  }

  // ٣) بثُّ الحدث لكلِّ المشتركين (useRealtime + page-level loaders)
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(WAKE_EVENT, { detail: { reason, at: now } }))
    } catch { /* ignore */ }
  }

  // eslint-disable-next-line no-console
  if (typeof console !== 'undefined' && console.debug) console.debug(`[wake] ${reason} · refreshed=${refreshed}`)
}

/* كاشفُ التعليق الطويل: إن قفز الفارقُ كثيرًا = WebView كان معلَّقًا.
   إعادةُ التحميل أكثر أمانًا من محاولة إصلاح حالةٍ منهارة. */
function maybeReloadAfterLongSuspend() {
  const now = Date.now()
  const gap = now - lastTickAt
  lastTickAt = now
  if (gap > LONG_SUSPEND_MS) {
    // أرفع علامةً مؤقّتةً فلا نَدخل في حلقةِ تحميلٍ لو حدث خطأٌ آخرُ بعد التحميل
    try { sessionStorage.setItem('malbeek:reloaded-at', String(now)) } catch { /* ignore */ }
    // إعادةُ تحميلٍ نظيفةٌ — تنهي كلَّ زومبي JS/WS/Promises
    try { window.location.reload() } catch { /* ignore */ }
    return true
  }
  return false
}

/* ★ تجَسُّسُ fetch: يَعمل فقط في نافذة ٦٠ث بعد آخرِ wake — لو فيها طلبٌ لـREST
   عَلِق > ١٥ث، فالـHTTP client زومبي بسبب تعليق iOS → إعادةُ تحميل.
   يَستثني storage (رفعُ صورٍ مشروعٌ أن يطول). يَستثني realtime/auth (لها مسارها). */
const WAKE_FETCH_WINDOW_MS = 60_000
function installFetchHangWatcher() {
  if (typeof window === 'undefined' || window.__malbeekFetchWatched) return
  window.__malbeekFetchWatched = true
  const origFetch = window.fetch
  if (!origFetch) return
  window.fetch = function malbeekTracedFetch(input, init) {
    const url = typeof input === 'string' ? input : (input?.url || '')
    const isSb = url.includes('supabase.co') || url.includes('supabase.io')
    const isRestOrRpc = isSb && (url.includes('/rest/v1/') || url.includes('/auth/v1/token'))
    const withinWakeWindow = (Date.now() - lastWakeAt) < WAKE_FETCH_WINDOW_MS
    if (!isRestOrRpc || !withinWakeWindow) return origFetch.call(this, input, init)
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      // الطلبُ عَلِق > ١٥ث بعد إيقاظٍ مباشر — تعليقٌ زومبي
      // eslint-disable-next-line no-console
      if (typeof console !== 'undefined') console.warn('[wake] fetch hang detected, forcing reload:', url)
      try { sessionStorage.setItem('malbeek:reloaded-at', String(Date.now())) } catch { /* ignore */ }
      try { window.location.reload() } catch { /* ignore */ }
    }, FETCH_HANG_MS)
    return origFetch.call(this, input, init).finally(() => { done = true; clearTimeout(timer) })
  }
}

/**
 * تثبيتُ مستمعي النظام على نافذة التطبيق (يُستدعى مرّةً من AuthProvider).
 * يرجع دالّةَ تنظيفٍ لإزالة المستمعين عند تفكيك التطبيق.
 */
export function installWakeListeners() {
  if (typeof window === 'undefined' || installed) return () => {}
  installed = true
  lastTickAt = Date.now()
  installFetchHangWatcher()

  // نبضةٌ خفيفةٌ تحدّث ساعةَ "آخر تنفيذ JS". إن توقّفت أكثر من LONG_SUSPEND_MS
  // فقد كان الـ WebView معلَّقًا — نُعِيدُ التحميلَ عند العودة.
  const heartbeat = setInterval(() => { lastTickAt = Date.now() }, HEARTBEAT_MS)

  const wakeIfFresh = (reason) => {
    if (maybeReloadAfterLongSuspend()) return
    performWake(reason)
  }

  const onVisible = () => { if (document.visibilityState === 'visible') wakeIfFresh('visible') }
  const onOnline  = () => wakeIfFresh('online')
  const onFocus   = () => wakeIfFresh('focus')
  // pageshow على iOS PWA standalone يأتي بلا persisted أحيانًا — نلتقطُه دائمًا
  const onPageShow = () => wakeIfFresh('pageshow')

  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  window.addEventListener('focus', onFocus)
  window.addEventListener('pageshow', onPageShow)

  return () => {
    installed = false
    clearInterval(heartbeat)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('pageshow', onPageShow)
  }
}

/**
 * يُسجّل callback يُستدعى عند كلِّ إيقاظٍ. يرجع دالّةَ unsubscribe.
 */
export function onWake(callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') return () => {}
  function handler(e) { callback(e?.detail || { reason: 'unknown', at: Date.now() }) }
  window.addEventListener(WAKE_EVENT, handler)
  return () => window.removeEventListener(WAKE_EVENT, handler)
}

/** إطلاقُ إيقاظٍ يدويٍّ (مفيدٌ بعد عملياتٍ كبيرةٍ تقتضي تحديثًا شاملًا). */
export function triggerWake(reason = 'manual') {
  performWake(reason)
}
