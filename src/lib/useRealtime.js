import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { onWake } from './wake'

/**
 * خطّافٌ موحّدٌ لاشتراكات Supabase Realtime — مدمجٌ مع منسِّق الإيقاظ
 * المركزيِّ (lib/wake.js). عند رجوع التطبيق من الخلفيّة، يَعِدُ ضمَّ القناة
 * ويستدعي onChange فتُحدَّث البياناتُ تلقائيًّا.
 *
 *  @param {string}    key         اسمُ القناة
 *  @param {Array}     filters     [{ table, filter? }]
 *  @param {Function}  onChange    تُستدعى عند تغييرٍ أو إيقاظ
 *  @param {number}    debounceMs  افتراضيًّا 200ms
 *  @param {Array}     deps        تبعيّاتُ إعادة الاشتراك
 */
export function useRealtime(key, filters, onChange, debounceMs = 200, deps = []) {
  const cbRef = useRef(onChange)
  cbRef.current = onChange

  useEffect(() => {
    if (!key || !filters?.length) return
    let cancelled = false
    let timer = null

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

    // عند الإيقاظ المركزيّ: إعادةُ ضمِّ القناة (الـ WS قد يكون مات) + تحديثُ البيانات
    const unsubscribeWake = onWake(() => {
      if (cancelled) return
      subscribe()
      fire()
    })

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      unsubscribeWake()
      if (ch) { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
