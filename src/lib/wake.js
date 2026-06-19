import { supabase } from './supabaseClient'

/* ============================================================
 *  مُنسِّقُ الإيقاظ — نظامٌ مركزيٌّ لإحياء التطبيق بعد تعليق المتصفّح
 * ============================================================
 *
 *  المشكلةُ التي يحلّها:
 *    - iOS Safari (وكلّ المتصفّحات) يجمّد جافاسكربت بعد ثوانٍ من
 *      إخفاء التطبيق. النتائج:
 *        × WebSocket حقّ Supabase Realtime يموت
 *        × ping/pong يتوقّف، التوكِنُ لا يُجدَّد
 *        × على iOS Safari قد يحصل context loss كاملٌ للصفحة
 *    - عند العودة: جافاسكربت يستيقظ لكن لا أحد يتأكّد أنّ الحالةَ سليمة،
 *      فالبيانات تبقى متجمّدةً أو تظهر فارغةً.
 *
 *  الحلّ — مُنسِّقٌ واحدٌ يفعل كلَّ شيءٍ بترتيبٍ صحيح عند الإيقاظ:
 *    ١) رفعُ الجلسة (refreshSession إن قاربت الانتهاء) فلا تفشل الاستعلامات.
 *    ٢) إعادةُ تشغيل Realtime (connect مجدّدًا للـ WebSocket).
 *    ٣) بثُّ حدث ‎malbeek:wake‎ ليلتقطه كلُّ المشتركين فيُعيدوا الجلب
 *       وإعادة ضمِّ القنوات بأنفسهم.
 *
 *  ميزاتٌ دفاعيّةٌ:
 *    - throttle ٢ثانية: لا يتكرّر الإيقاظ بإفراطٍ.
 *    - تسجيلُ المستمعين مرّةً واحدةً على مستوى التطبيق (في AuthProvider).
 *    - api ‎onWake‎ بسيطٌ لأيِّ مكوّنٍ يحتاج التحديثَ على الإيقاظ.
 * ============================================================ */

const WAKE_EVENT = 'malbeek:wake'
const THROTTLE_MS = 2000
let lastWakeAt = 0
let installed = false

async function performWake(reason) {
  const now = Date.now()
  if (now - lastWakeAt < THROTTLE_MS) return
  lastWakeAt = now

  // ١) رفعُ الجلسة — احترازيٌّ ضدّ توكِنٍ منتهٍ في الخلفيّة.
  //    إن بقي للتوكِن أقلّ من ٥ دقائق، نطلبُ refreshSession صراحةً.
  try {
    const { data } = await supabase.auth.getSession()
    const exp = data?.session?.expires_at
    if (exp) {
      const remainingMs = exp * 1000 - Date.now()
      if (remainingMs < 5 * 60 * 1000) {
        await supabase.auth.refreshSession()
      }
    }
  } catch { /* لا توكِن أو خطأٌ مؤقّتٌ — يُعالجُ في الاستعلام التالي */ }

  // ٢) إعادةُ تشغيل Realtime — idempotent: إن كان حيًّا لا أثرَ، وإن مات يُعاد.
  try {
    const rt = supabase?.realtime
    if (rt?.connect) rt.connect()
  } catch { /* ignore */ }

  // ٣) بثُّ الحدث لكلِّ المشتركين (useRealtime + page-level loaders + channels يدويّة)
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(WAKE_EVENT, { detail: { reason, at: now } }))
    } catch { /* CustomEvent غير مدعومٍ في بيئاتٍ نادرةٍ — تجاهل */ }
  }

  // تشخيصٌ خفيفٌ — مفيدٌ أثناء التطوير، غير مزعجٍ في الإنتاج.
  // eslint-disable-next-line no-console
  if (typeof console !== 'undefined' && console.debug) console.debug(`[wake] ${reason}`)
}

/**
 * تثبيتُ مستمعي النظام على نافذة التطبيق (يُستدعى مرّةً من AuthProvider).
 * يرجع دالّةَ تنظيفٍ لإزالة المستمعين عند تفكيك التطبيق.
 */
export function installWakeListeners() {
  if (typeof window === 'undefined' || installed) return () => {}
  installed = true

  const onVisible = () => { if (document.visibilityState === 'visible') performWake('visible') }
  const onOnline  = () => performWake('online')
  const onFocus   = () => performWake('focus')
  // pageshow يفيد على iOS Safari عند العودة من cache (back-forward)
  const onPageShow = (e) => { if (e.persisted) performWake('pageshow') }

  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  window.addEventListener('focus', onFocus)
  window.addEventListener('pageshow', onPageShow)

  return () => {
    installed = false
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('pageshow', onPageShow)
  }
}

/**
 * يُسجّل callback يُستدعى عند كلِّ إيقاظٍ. يرجع دالّةَ unsubscribe.
 *
 * مثال:
 *   useEffect(() => onWake(() => loadData()), [loadData])
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
