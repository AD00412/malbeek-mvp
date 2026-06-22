import { supabase } from './supabaseClient'
import { logEvent } from './debugLog'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

/* ============================================================
 *  منسق الإيقاظ — إحياء التطبيق بعد عودته من الخلفية
 * ============================================================
 *
 *  فلسفة التصميم (بعد دروس مكلفة):
 *    - لا نعترض fetch العام إطلاقا — اعتراضه كان يسبب reload
 *      كاذبا أثناء التنقل الطبيعي بين الصفحات (عدة استعلامات
 *      متزامنة بطيئة تحسب «تعليقا» خطأ).
 *    - لا reload إلا بعد إخفاء طويل حقيقي (> دقيقتين) حيث يكون
 *      iOS قد أتلف الحالة فعلا.
 *    - التنقل داخل التطبيق لا يشغل أي منطق إيقاظ (لا يوجد
 *      visibilitychange عند تبديل التبويبات).
 *    - عند العودة من الخلفية: تحديث ناعم (token لو قارب الانتهاء +
 *      realtime.connect) ثم بث wake ليحدث المشتركون بياناتهم.
 *
 *  واجهة:
 *    - installWakeListeners() — مرة من AuthProvider.
 *    - onWake(cb) — يستدعى عند كل عودة من الخلفية.
 *    - triggerWake(reason) — إيقاظ يدوي.
 * ============================================================ */

const WAKE_EVENT = 'malbeek:wake'
const THROTTLE_MS = 3000
const BRIEF_GAP_MS = 8_000        // < ٨ث: عودة خاطفة — لا تلمس شيئا
const LONG_SUSPEND_MS = 120_000   // > دقيقتين: reload نظيف (الحالة تالفة يقينا)
const REFRESH_TIMEOUT_MS = 5000

let lastWakeAt = 0
let hiddenAt = 0
let installed = false

function withTimeout(promise, ms) {
  let t
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
}

/* ★ قراءة الجلسة من localStorage بدعم أشكال متعددة من supabase-js.
   النسخ القديمة (v1) تستخدم ‎{ currentSession }‎، النسخ الحديثة (v2/auth-js)
   تكتب الـsession مباشرة. نفحص ٤ مواقع محتملة ثم نتأكد من
   ‎access_token‎ — حتى لو expires_at مر، نرجعها (الخادم يعالج 401). */
function readStoredSession() {
  try {
    const stored = localStorage.getItem('malbeek.auth')
    if (!stored) return null
    const parsed = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object') return null
    // نتفقد أشكالا معروفة بترتيب الأكثر احتمالا
    const candidates = [
      parsed,                            // v2/auth-js: parsed IS the session
      parsed.currentSession,             // v1: { currentSession: {...} }
      parsed.session,                    // أحيانا: { session: {...} }
      parsed.data?.session,              // شكل Response: { data: { session } }
    ]
    for (const c of candidates) {
      if (c && typeof c === 'object' && typeof c.access_token === 'string' && c.access_token) {
        return c
      }
    }
    return null
  } catch { return null }
}

/* ★ Monkey-patch لـsupabase.auth.getSession مع مهلة ١.٥ث + fallback من localStorage.
   اكتشفنا من سجل المستخدم أن getSession() يعلق إلى الأبد بعد عودة iOS
   (لأن supabase-js v2 ينتظر promise refresh معلقا داخليا).
   الحل: race مع ٣ث؛ لو هنغت نرجع الجلسة المخزنة محليا — التوكن
   صالح عادة لـ٦٠ دقيقة فلا حاجة لـ refresh. */
function patchAuthGetSession() {
  if (typeof window === 'undefined' || window.__malbeekAuthPatched) return
  window.__malbeekAuthPatched = true
  try {
    const auth = supabase?.auth
    if (!auth?.getSession) return
    const origGetSession = auth.getSession.bind(auth)

    auth.getSession = async function timedGetSession(...args) {
      try {
        return await Promise.race([
          origGetSession(...args),
          new Promise((_, reject) => setTimeout(() => reject(new Error('getSession-timeout')), 1500)),
        ])
      } catch (e) {
        logEvent('AUTH', 'getSession hung 1.5s — using cached', { message: e?.message })
        const session = readStoredSession()
        // ★ مهم: نرجع ‎error: null‎ حتى لو لم نجد session — تجنبا
        //   لإطلاق منطق تسجيل الخروج التلقائي في supabase-js (الذي قد
        //   يحدث لو فسر الخطأ كـ«فشل مصادقة»). الـUI يتعامل مع
        //   ‎session=null‎ بنفس ما يفعل عند مستخدم مجهول.
        return { data: { session }, error: null }
      }
    }
    logEvent('AUTH', 'getSession patched with 1.5s timeout + cached fallback')
  } catch (e) {
    logEvent('AUTH', 'patch failed', { message: e?.message })
  }
}

/* ★ تدفئة الاتصال (warmup): فور عودة التطبيق من الخلفية، نطلق
   طلبا قصيرا (HEAD) عبر window.fetch الخام — لا عبر supabase-js.
   لو الـTCP socket كان زومبيا (iOS أوقفه أثناء الإخفاء)، AbortController
   بعد ١.٥ث يجبر المتصفح على إغلاقه. الطلب التالي يفتح socket جديدا.
   لو كان سليما: ينجح في < ٣٠٠ms، لا أثر للمستخدم. */
let warmupInFlight = false
async function warmupConnection() {
  if (!SUPABASE_URL || warmupInFlight) return
  if (typeof window === 'undefined') return
  warmupInFlight = true
  const start = performance.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => { try { ctrl.abort() } catch { /* ignore */ } }, 1500)
  try {
    // window.fetch مباشر — لا يمر عبر supabaseClient (ولا مهلته ١٠ث).
    await window.fetch(`${SUPABASE_URL}/auth/v1/health`, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { apikey: SUPABASE_ANON },
      cache: 'no-store',
      keepalive: false,
    })
    const ms = Math.round(performance.now() - start)
    logEvent('WARMUP', `ok (${ms}ms)`)
  } catch (e) {
    const ms = Math.round(performance.now() - start)
    // الإلغاء مقصود — socket المعطوب أغلق الآن قسرا.
    logEvent('WARMUP', `aborted/failed (${ms}ms)`, { message: e?.message })
  } finally {
    clearTimeout(timer)
    warmupInFlight = false
  }
}

async function performWake(reason, gap = 0) {
  const now = Date.now()
  if (now - lastWakeAt < THROTTLE_MS) return
  lastWakeAt = now

  // عودة خاطفة (< ٨ث): التطبيق لم يعلق فعلا — لا تحديث توكن ولا
  // إعادة اتصال (قد تكسر WS سليما). فقط بث خفيف لينعش المشتركون
  // بياناتهم إن أرادوا — بلا أي تدخل في الشبكة.
  if (gap > 0 && gap < BRIEF_GAP_MS) {
    dispatchWake(reason, true)
    return
  }

  // عودة بعد إخفاء متوسط: جدد التوكن لو قارب الانتهاء + أعد ربط Realtime.
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), REFRESH_TIMEOUT_MS)
    const exp = data?.session?.expires_at
    if (exp) {
      const remainingMs = exp * 1000 - Date.now()
      if (remainingMs < 5 * 60 * 1000) {
        await withTimeout(supabase.auth.refreshSession(), REFRESH_TIMEOUT_MS)
      }
    }
  } catch { /* مهلة أو خطأ مؤقت — الاستعلام التالي سيعالجه */ }

  try {
    const rt = supabase?.realtime
    if (rt?.connect) rt.connect()   // idempotent — لا نكسر اتصالا سليما
  } catch { /* ignore */ }

  dispatchWake(reason, false)
}

function dispatchWake(reason, brief) {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(WAKE_EVENT, { detail: { reason, brief, at: Date.now() } }))
  } catch { /* ignore */ }
}

/**
 * تثبيت مستمعي النظام (يستدعى مرة من AuthProvider).
 * يرجع دالة تنظيف.
 */
export function installWakeListeners() {
  if (typeof window === 'undefined' || installed) return () => {}
  installed = true

  // ثبت patch المصادقة فورا — يحمي كل استعلام مستقبلي
  patchAuthGetSession()

  const onReturn = (reason) => {
    const gap = hiddenAt ? Date.now() - hiddenAt : 0
    hiddenAt = 0
    // إخفاء طويل حقيقي (> دقيقتين): الحالة تالفة يقينا → reload نظيف.
    if (gap > LONG_SUSPEND_MS) {
      try { sessionStorage.setItem('malbeek:reloaded-at', String(Date.now())) } catch { /* ignore */ }
      try { window.location.reload() } catch { /* ignore */ }
      return
    }
    performWake(reason, gap)
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now()
    else if (document.visibilityState === 'visible') {
      // ★ تدفئة TCP socket — تجهض الزومبي قبل أن يمس.
      //   patchAuthGetSession سبق تثبيته ويحمي getSession من الهنغ تلقائيا.
      if (hiddenAt > 0) warmupConnection()
      onReturn('visible')
    }
  }
  const onOnline   = () => onReturn('online')
  const onPageShow = (e) => { if (e?.persisted) onReturn('pageshow') }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('online', onOnline)
  window.addEventListener('pageshow', onPageShow)

  return () => {
    installed = false
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('pageshow', onPageShow)
  }
}

/** يسجل callback يستدعى عند كل عودة من الخلفية. يرجع دالة unsubscribe. */
export function onWake(callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') return () => {}
  function handler(e) { callback(e?.detail || { reason: 'unknown', at: Date.now() }) }
  window.addEventListener(WAKE_EVENT, handler)
  return () => window.removeEventListener(WAKE_EVENT, handler)
}

/** إطلاق إيقاظ يدوي. */
export function triggerWake(reason = 'manual') {
  performWake(reason, BRIEF_GAP_MS + 1)
}
