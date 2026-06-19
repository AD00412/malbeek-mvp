import { supabase } from './supabaseClient'

// قراءةٌ مباشرةٌ لـURL وkey للـ ping (لا نَمرّ عبر supabase-js — fetch مباشر)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

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
// مستويات الفجوة:
//   < BRIEF: لا تدخّل — التطبيقُ يَستمرّ كما كان
//   BRIEF–MEDIUM: تحديثٌ ناعم (token + realtime.connect لو لزم) بلا reload
//   > LONG: reload — كانت الفجوة طويلةً جدًّا فالـPromises قطعًا زومبي
const BRIEF_GAP_MS  = 5_000        // ٥ث: «دقيقتُ خروج» — لا شيءَ يَحدث
const LONG_SUSPEND_MS = 300_000    // ٥ دقائق: عتبةُ الـ reload التلقائيّ
const HEARTBEAT_MS = 1000          // دقّةُ كاشف التعليق
const REFRESH_TIMEOUT_MS = 5000    // أقصى مهلةٍ لـ refreshSession
// (ABORT_TIMEOUT_MS = 7s معرَّفٌ بجوار installFetchHangWatcher أدناه)
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

/* ★ ping شبكةٍ فعليٌّ بمهلة ١.٥ث — يَتجاوز supabase-js ويَتجَنّب الـwrapper.
   - HEAD مباشرٌ على /rest/v1/ — أخفُّ ما يُمكن.
   - لو نجح في < ١.٥ث: stack الشبكة سليم — لا شيءَ يَحدث (شفّاف للمستخدم).
   - لو فشل/علِق: WebView في حالةٍ زومبي → reload فوريٌّ بدل تجمّدٍ. */
let pingInFlight = false
async function pingHealthCheck(reason) {
  if (pingInFlight) return
  if (!SUPABASE_URL || !SUPABASE_ANON) return  // لا تكوينٌ — تَجاوز
  pingInFlight = true
  const ctrl = new AbortController()
  const timer = setTimeout(() => { try { ctrl.abort() } catch { /* ignore */ } }, 1500)
  // ★ مهمٌّ: نَستعمل fetch خامًّا (origFetch) لا الـwrapper — فلا تَتلطّخ
  //   إحصاءاتُ AbortController consecutiveAborts من فحصٍ صحّيّ.
  const rawFetch = typeof window !== 'undefined' && window.__malbeekOrigFetch
    ? window.__malbeekOrigFetch
    : (typeof window !== 'undefined' ? window.fetch : null)
  if (!rawFetch) { pingInFlight = false; clearTimeout(timer); return }
  try {
    // ‎/auth/v1/health‎ يَرجع 200 بلا مصادقةٍ — لا ضوضاءَ 401 في الـconsole،
    // ويَختبر stack الشبكة الفعليّ تمامًا كأيِّ مسار.
    const res = await rawFetch.call(window, `${SUPABASE_URL}/auth/v1/health`, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { apikey: SUPABASE_ANON },
      cache: 'no-store',
    })
    // أيُّ ردٍّ (حتّى خطأ HTTP) = الشبكةُ حيّةٌ. لا شيءَ يَلزم.
    void res
  } catch (e) {
    // فشل/علِق → WebView منهار → reload فوريّ
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined') console.warn(`[wake] ping failed (${reason}), reloading:`, e?.message || e)
    try { sessionStorage.setItem('malbeek:reloaded-at', String(Date.now())) } catch { /* ignore */ }
    try { window.location.reload() } catch { /* ignore */ }
  } finally {
    clearTimeout(timer)
    pingInFlight = false
  }
}

async function performWake(reason, gap = 0) {
  const now = Date.now()
  if (now - lastWakeAt < THROTTLE_MS) return
  lastWakeAt = now

  // ★ خروجٌ قصيرٌ (< ٥ث): لا شيءَ مطلقًا — لا حتّى dispatch.
  //    أيُّ بثٍّ يُحرّك useRealtime ليُعيد ضمَّ القنوات على WebSocket قد يكون
  //    معطّلًا بعد iOS، فيَنتج تجمّد. التطبيقُ يَستمرّ كما كان تمامًا.
  if (gap < BRIEF_GAP_MS) {
    // كاشفُ صحّةٍ خفيٌّ: ping سريعٌ ٢.٥ث للتأكّد أنّ HTTP client سليم.
    //   - إن نجح: لا شيءَ يَحدث، التطبيقُ حيٌّ.
    //   - إن فشل/علِق: WebView في حالةٍ زومبي → reload فوريّ بلا تجمّدٍ مطوّل.
    pingHealthCheck(reason)
    return
  }

  // فجوةٌ متوسّطة (٥ث–٥د): تحديثٌ ناعمٌ بلا reload.
  let refreshed = false
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), REFRESH_TIMEOUT_MS)
    const exp = data?.session?.expires_at
    if (exp) {
      const remainingMs = exp * 1000 - Date.now()
      // جدّد التوكِنَ فقط لو قارَب الانتهاء (٥د) — لا نُجدّد بإفراط
      if (remainingMs < 5 * 60 * 1000) {
        await withTimeout(supabase.auth.refreshSession(), REFRESH_TIMEOUT_MS)
        refreshed = true
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined') console.warn('[wake] refreshSession failed:', e?.message || e)
  }

  // Realtime: للفجواتِ المتوسّطة، اكتفِ بـ connect (idempotent). لا نَكسر WS سليمًا.
  //    disconnect+connect نَحتفظُ به فقط للفجوات الكبيرة (>٣٠ث).
  try {
    const rt = supabase?.realtime
    if (gap > 30_000 && rt?.disconnect) {
      try { rt.disconnect() } catch { /* ignore */ }
    }
    if (rt?.connect) rt.connect()
  } catch { /* ignore */ }

  if (refreshed) await new Promise((r) => setTimeout(r, 200))

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(WAKE_EVENT, { detail: { reason, at: now } }))
    } catch { /* ignore */ }
  }

  // eslint-disable-next-line no-console
  if (typeof console !== 'undefined' && console.debug) console.debug(`[wake] ${reason} · gap=${gap}ms · refreshed=${refreshed}`)
}

/* يَحسب الفجوةَ ويُقرّر: reload (طويلة جدًّا) أم wake ناعم. */
function computeGapAndReset() {
  const now = Date.now()
  const tickGap = now - lastTickAt
  const hideGap = hiddenAt ? now - hiddenAt : 0
  const gap = Math.max(tickGap, hideGap)
  lastTickAt = now
  hiddenAt = 0
  return gap
}

function maybeReloadAfterLongSuspend(gap) {
  if (gap > LONG_SUSPEND_MS) {
    try { sessionStorage.setItem('malbeek:reloaded-at', String(Date.now())) } catch { /* ignore */ }
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

/* ★ AbortController على كلِّ fetch لـREST/RPC — يَكسر التجمّد الفوريّ.
   - أيُّ supabase request يَتجاوز ٧ث = إلغاءٌ تلقائيّ.
   - supabase-js يَستلم AbortError → الـcatch يَفتح → الـUI لا يَتجمّد.
   - بعد ٣ إلغاءاتٍ متتاليةٍ، نُجبر reload (WebView منهار).
   - يَستثني storage (رفعُ صورٍ مشروعٌ أن يطول).
   هذا يَحلّ تجمّدَ iOS WebView بعد عودةٍ فوريّة بلا انتظار طويل. */
const ABORT_TIMEOUT_MS = 7_000
let consecutiveAborts = 0
function installFetchHangWatcher() {
  if (typeof window === 'undefined' || window.__malbeekFetchWatched) return
  window.__malbeekFetchWatched = true
  const origFetch = window.fetch
  if (!origFetch) return
  // احفظ المرجعَ الأصليَّ في window — ليَستعمله pingHealthCheck متجاوزًا الـwrapper
  window.__malbeekOrigFetch = origFetch
  window.fetch = function malbeekTracedFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : (input?.url || '')
    const isSb = url.includes('supabase.co') || url.includes('supabase.io')
    const isRestOrRpc = isSb && (url.includes('/rest/v1/') || url.includes('/auth/v1/'))
    if (!isRestOrRpc) return origFetch.call(this, input, init)

    // اربط AbortController جديدًا — لو المستخدمُ مرّر signal، نَدمج
    const userSignal = init.signal
    const ctrl = new AbortController()
    const onUserAbort = () => ctrl.abort()
    if (userSignal) {
      if (userSignal.aborted) ctrl.abort()
      else userSignal.addEventListener('abort', onUserAbort, { once: true })
    }
    const timer = setTimeout(() => {
      try { ctrl.abort() } catch { /* ignore */ }
    }, ABORT_TIMEOUT_MS)

    return origFetch.call(this, input, { ...init, signal: ctrl.signal })
      .then((res) => { consecutiveAborts = 0; return res })
      .catch((err) => {
        if (err?.name === 'AbortError' || ctrl.signal.aborted) {
          consecutiveAborts += 1
          // eslint-disable-next-line no-console
          if (typeof console !== 'undefined') console.warn(`[wake] fetch aborted (${consecutiveAborts}/3):`, url)
          // ٣ إلغاءاتٍ متتاليةٍ = WebView منهار → reload فوريّ
          if (consecutiveAborts >= 3) {
            try { sessionStorage.setItem('malbeek:reloaded-at', String(Date.now())) } catch { /* ignore */ }
            try { window.location.reload() } catch { /* ignore */ }
          }
        }
        throw err
      })
      .finally(() => {
        clearTimeout(timer)
        if (userSignal) try { userSignal.removeEventListener('abort', onUserAbort) } catch { /* ignore */ }
      })
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
    const gap = computeGapAndReset()
    // ★ ping صحّةٍ على كلِّ عودةٍ من الإخفاء (visibilitychange:visible فقط)
    //   — لو الـsocket زومبي، نُلتقطها في ١.٥ث ونُعيد التحميل قبل أيِّ تجمّد.
    if (reason === 'visible' && gap > 0) pingHealthCheck(reason)
    if (maybeReloadAfterLongSuspend(gap)) return
    performWake(reason, gap)
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
