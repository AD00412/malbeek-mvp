import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'

/**
 * خطّافٌ موحّدٌ لاشتراكات Supabase Realtime — مع نظامِ إيقاظٍ يحلُّ مشكلةَ
 * «التجمّد بعد ترك التطبيق ثوانٍ» على iOS Safari وكلِّ المتصفّحات الحديثة.
 *
 * الإيقاظ يطلق refresh تلقائيًّا عند:
 *  - رجوع التبويب للمقدّمة (visibilitychange)
 *  - رجوع الاتّصال بالإنترنت (online)
 *  - عودةُ التركيز للنافذة (focus)
 *
 * وعندها أيضًا:
 *  - يُعاد ضمُّ الـ Realtime channel (الـ WebSocket كان قد يموت بعد دقائق
 *    من تعليق JS في الخلفيّة)
 *  - يُستدعى onChange مرّةً (debounced) فتُحدَّث البياناتُ فورًا للمستخدم
 *
 * Throttle ٢ ثانيةً للإيقاظ المتكرّر يمنع تحديثًا زائدًا.
 *
 * @param {string}    key         اسمُ القناة
 * @param {Array}     filters     [{ table, filter? }]
 * @param {Function}  onChange    تُستدعى عند أيِّ تغييرٍ — أو إيقاظ
 * @param {number}    debounceMs  افتراضيًّا 200ms
 * @param {Array}     deps        تبعيّاتُ إعادة الاشتراك
 */
export function useRealtime(key, filters, onChange, debounceMs = 200, deps = []) {
  const cbRef = useRef(onChange)
  cbRef.current = onChange

  useEffect(() => {
    if (!key || !filters?.length) return
    let cancelled = false
    let timer = null
    let lastWakeAt = 0   // throttle للإيقاظ

    const fire = () => {
      if (cancelled) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { if (!cancelled) cbRef.current?.() }, debounceMs)
    }

    let ch = null
    function subscribe() {
      if (ch) { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
      ch = supabase.channel(`rt:${key}`)
      for (const f of filters) {
        const opts = { event: '*', schema: 'public', table: f.table }
        if (f.filter) opts.filter = f.filter
        ch.on('postgres_changes', opts, fire)
      }
      ch.subscribe()
    }
    subscribe()

    // ====== الإيقاظُ: تحديثٌ + إعادةُ ضمِّ القناة عند العودة ======
    function wake(reason) {
      if (cancelled) return
      const now = Date.now()
      if (now - lastWakeAt < 2000) return   // throttle: مرّةً كلَّ ثانيتين كحدٍّ أقصى
      lastWakeAt = now
      // إعادةُ ضمِّ القناة — WS قد يكون ماتَ أثناء التعليق
      subscribe()
      // تحديثُ البياناتِ فورًا للمستخدم
      fire()
      // ملاحظةُ تشخيصٍ خفيفةٌ — تُحذف في الإنتاج إن أزعجت
      // eslint-disable-next-line no-console
      if (typeof console !== 'undefined' && console.debug) console.debug(`[realtime] wake (${reason}) → ${key}`)
    }

    const onVisible = () => { if (document.visibilityState === 'visible') wake('visible') }
    const onOnline  = () => wake('online')
    const onFocus   = () => wake('focus')

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', onFocus)
      if (ch) { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
