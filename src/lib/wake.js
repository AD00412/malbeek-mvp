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
const SHOW_RELOAD_EVENT = 'malbeek:show-reload'
const THROTTLE_MS = 2000
// ★ أيُّ غيابٍ > ٥ث = إعادةُ تحميلٍ تلقائيّة. iOS يَترك Promises معلَّقةً
//    حتّى بعد توقّفٍ قصير → الواجهة تَتجمّد بلا حلٍّ موضعيّ.
const LONG_SUSPEND_MS = 5_000
const HEARTBEAT_MS = 1000        // دقّةُ كاشف التعليق
const REFRESH_TIMEOUT_MS = 5000  // أقصى مهلةٍ لـ refreshSession فلا يَعلق
// ★ تجَسُّسٌ على fetch — إن عَلِق طلبٌ لـSupabase > ١٠ث، نُعيد التحميل
const FETCH_HANG_MS = 10_000
let lastWakeAt = 0
let lastTickAt = Date.now()
let hiddenAt = 0
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

/* كاشفُ التعليق الطويل: إن قفز الفارقُ (نبضات JS أو مدّةُ الإخفاء) >
   LONG_SUSPEND_MS، يَكون iOS قد علّق الـWebView وتركَ Promises معلَّقة.
   الحلُّ الوحيد الفعّال: إعادةُ تحميلٍ نظيفة. */
function maybeReloadAfterLongSuspend() {
  const now = Date.now()
  const tickGap = now - lastTickAt
  const hideGap = hiddenAt ? now - hiddenAt : 0
  const gap = Math.max(tickGap, hideGap)
  lastTickAt = now
  hiddenAt = 0
  if (gap > LONG_SUSPEND_MS) {
    try { sessionStorage.setItem('malbeek:reloaded-at', String(now)) } catch { /* ignore */ }
    try { window.location.reload() } catch { /* ignore */ }
    return true
  }
  return false
}

/** يَطلب من الواجهة عرضَ ReloadOverlay (زرُّ إعادة تحميلٍ يدويٌّ في الوسط). */
export function showReloadPrompt(reason = 'manual') {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(SHOW_RELOAD_EVENT, { detail: { reason, at: Date.now() } }))
  } catch { /* ignore */ }
}

/** يَستمع لطلب إظهار ReloadOverlay — يَستعملُه AppShell. */
export function onShowReload(callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') return () => {}
  function handler(e) { callback(e?.detail || { reason: 'unknown', at: Date.now() }) }
  window.addEventListener(SHOW_RELOAD_EVENT, handler)
  return () => window.removeEventListener(SHOW_RELOAD_EVENT, handler)
}

/* ★ تجَسُّسُ fetch: يَعمل دائمًا — لو طلبٌ لـREST عَلِق > FETCH_HANG_MS،
   فالـHTTP client زومبي بسبب تعليق iOS → عرضُ ReloadOverlay فورًا، ثمّ
   reload تلقائيٌّ بعد ٣ث. يَستثني storage (رفعُ صورٍ قد يَطول).
   لا يَفترض إيقاظًا — أيُّ تعليقٍ على REST = WebView مكسور. */
function installFetchHangWatcher() {
  if (typeof window === 'undefined' || window.__malbeekFetchWatched) return
  window.__malbeekFetchWatched = true
  const origFetch = window.fetch
  if (!origFetch) return
  window.fetch = function malbeekTracedFetch(input, init) {
    const url = typeof input === 'string' ? input : (input?.url || '')
    const isSb = url.includes('supabase.co') || url.includes('supabase.io')
    const isRestOrRpc = isSb && (url.includes('/rest/v1/') || url.includes('/auth/v1/token'))
    if (!isRestOrRpc) return origFetch.call(this, input, init)
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      // eslint-disable-next-line no-console
      if (typeof console !== 'undefined') console.warn('[wake] fetch hang detected:', url)
      // عرضُ overlay يدويٍّ للمستخدم — يَستطيع الضغط أو ننتظر auto-reload
      showReloadPrompt('fetch_hang')
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

  // ★ تتبّعُ لحظةِ الإخفاء بدقّة — لا نَعتمد على heartbeat فقط (قد لا يَركض على iOS)
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
    } else if (document.visibilityState === 'visible') {
      wakeIfFresh('visible')
    }
  }
  const onOnline  = () => wakeIfFresh('online')
  const onFocus   = () => wakeIfFresh('focus')
  // pageshow على iOS PWA standalone يأتي بلا persisted أحيانًا — نلتقطُه دائمًا
  const onPageShow = () => wakeIfFresh('pageshow')

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('online', onOnline)
  window.addEventListener('focus', onFocus)
  window.addEventListener('pageshow', onPageShow)

  return () => {
    installed = false
    clearInterval(heartbeat)
    document.removeEventListener('visibilitychange', onVisibilityChange)
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
