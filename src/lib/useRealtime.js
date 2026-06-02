import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'

/**
 * خطّافٌ موحّدٌ لاشتراكات Supabase Realtime مع تخفيفٍ (debounce) لاستدعاء onChange
 * عند تتالي عدّة أحداث، وتنظيفٍ نظيف عند تفكيك المكوّن.
 *
 * @param {string} key       اسم القناة (يُستخدم للفصل بين الاشتراكات)
 * @param {Array}  filters   [{ table, filter? }]   مثل [{ table:'passengers', filter:'trip_id=eq.X' }]
 * @param {Function} onChange   تُستدعى عند أي حدث (insert/update/delete)
 * @param {number} debounceMs    تخفيفٌ افتراضيٌّ 200ms
 * @param {Array}  deps         تبعيّاتٌ لإعادة الاشتراك عند تغيّرها
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
    const ch = supabase.channel(`rt:${key}`)
    for (const f of filters) {
      const opts = { event: '*', schema: 'public', table: f.table }
      if (f.filter) opts.filter = f.filter
      ch.on('postgres_changes', opts, fire)
    }
    ch.subscribe()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      try { supabase.removeChannel(ch) } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
