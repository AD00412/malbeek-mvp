import { supabase } from './supabaseClient'

/* ============================================================
 *  مُنسِّقُ الإيقاظ — إحياءُ التطبيق بعد عودته من الخلفيّة
 * ============================================================
 *
 *  فلسفةُ التصميم (بعد دروسٍ مكلفة):
 *    - لا نَعترض fetch العامّ إطلاقًا — اعتراضُه كان يُسبّب reload
 *      كاذبًا أثناء التنقّل الطبيعيّ بين الصفحات (عدّةُ استعلاماتٍ
 *      متزامنةٍ بطيئةٍ تُحسَب «تعليقًا» خطأً).
 *    - لا reload إلّا بعد إخفاءٍ طويلٍ حقيقيٍّ (> دقيقتَين) حيث يَكون
 *      iOS قد أتلفَ الحالةَ فعلًا.
 *    - التنقّلُ داخل التطبيق لا يُشغّل أيَّ منطقِ إيقاظٍ (لا يوجد
 *      visibilitychange عند تبديل التبويبات).
 *    - عند العودة من الخلفيّة: تحديثٌ ناعمٌ (token لو قارَب الانتهاء +
 *      realtime.connect) ثمّ بثُّ wake ليُحدّث المشتركون بياناتهم.
 *
 *  واجهةٌ:
 *    - installWakeListeners() — مرّةً من AuthProvider.
 *    - onWake(cb) — يُستدعى عند كلِّ عودةٍ من الخلفيّة.
 *    - triggerWake(reason) — إيقاظٌ يدويّ.
 * ============================================================ */

const WAKE_EVENT = 'malbeek:wake'
const THROTTLE_MS = 3000
const BRIEF_GAP_MS = 8_000        // < ٨ث: عودةٌ خاطفةٌ — لا تَلمس شيئًا
const LONG_SUSPEND_MS = 120_000   // > دقيقتَين: reload نظيفٌ (الحالة تالفةٌ يقينًا)
const REFRESH_TIMEOUT_MS = 5000

let lastWakeAt = 0
let hiddenAt = 0
let installed = false

function withTimeout(promise, ms) {
  let t
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
}

async function performWake(reason, gap = 0) {
  const now = Date.now()
  if (now - lastWakeAt < THROTTLE_MS) return
  lastWakeAt = now

  // عودةٌ خاطفةٌ (< ٨ث): التطبيقُ لم يُعلَّق فعلًا — لا تحديثَ توكِنٍ ولا
  // إعادةَ اتّصالٍ (قد تَكسر WS سليمًا). فقط بثٌّ خفيفٌ ليُنعش المشتركون
  // بياناتهم إن أرادوا — بلا أيِّ تدخّلٍ في الشبكة.
  if (gap > 0 && gap < BRIEF_GAP_MS) {
    dispatchWake(reason, true)
    return
  }

  // عودةٌ بعد إخفاءٍ متوسّط: جدّد التوكِنَ لو قارَب الانتهاء + أعِد ربط Realtime.
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), REFRESH_TIMEOUT_MS)
    const exp = data?.session?.expires_at
    if (exp) {
      const remainingMs = exp * 1000 - Date.now()
      if (remainingMs < 5 * 60 * 1000) {
        await withTimeout(supabase.auth.refreshSession(), REFRESH_TIMEOUT_MS)
      }
    }
  } catch { /* مهلةٌ أو خطأٌ مؤقّت — الاستعلامُ التالي سيُعالجه */ }

  try {
    const rt = supabase?.realtime
    if (rt?.connect) rt.connect()   // idempotent — لا نَكسر اتّصالًا سليمًا
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
 * تثبيتُ مستمعي النظام (يُستدعى مرّةً من AuthProvider).
 * يرجع دالّةَ تنظيفٍ.
 */
export function installWakeListeners() {
  if (typeof window === 'undefined' || installed) return () => {}
  installed = true

  const onReturn = (reason) => {
    const gap = hiddenAt ? Date.now() - hiddenAt : 0
    hiddenAt = 0
    // إخفاءٌ طويلٌ حقيقيٌّ (> دقيقتَين): الحالةُ تالفةٌ يقينًا → reload نظيف.
    if (gap > LONG_SUSPEND_MS) {
      try { sessionStorage.setItem('malbeek:reloaded-at', String(Date.now())) } catch { /* ignore */ }
      try { window.location.reload() } catch { /* ignore */ }
      return
    }
    performWake(reason, gap)
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now()
    else if (document.visibilityState === 'visible') onReturn('visible')
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

/** يُسجّل callback يُستدعى عند كلِّ عودةٍ من الخلفيّة. يرجع دالّةَ unsubscribe. */
export function onWake(callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') return () => {}
  function handler(e) { callback(e?.detail || { reason: 'unknown', at: Date.now() }) }
  window.addEventListener(WAKE_EVENT, handler)
  return () => window.removeEventListener(WAKE_EVENT, handler)
}

/** إطلاقُ إيقاظٍ يدويّ. */
export function triggerWake(reason = 'manual') {
  performWake(reason, BRIEF_GAP_MS + 1)
}
