import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from '../app/useAuth'
import { useRealtime } from './useRealtime'
import { getCached, setCached } from './dataCache'

/**
 * عدّاد الإشعارات غير المقروءة — يُستخدم في شارة الجرس داخل الرأس.
 * يَستخدم SWR cache فلا يَعرض ٠ كاذبًا بعد الإيقاظ/التنقّل.
 * @returns {[number, () => Promise<void>]} [العدد, إعادة التحميل]
 */
export function useUnreadCount() {
  const { user } = useAuth()
  const cacheKey = user?.id ? `notif-count:${user.id}` : null
  const [count, setCount] = useState(() => {
    if (!cacheKey) return 0
    const v = getCached(cacheKey)
    return typeof v === 'number' ? v : 0
  })
  const retryRef = useRef(0)

  const load = useCallback(async () => {
    if (!user?.id) return
    const { data, error } = await supabase.rpc('unread_notifications_count')
    if (error) return // أبقِ القيمة الحاليّة — لا تَصفير على خطأ
    let next = null
    if (typeof data === 'number') next = data
    else if (Array.isArray(data) && typeof data[0] === 'number') next = data[0]
    if (next == null) return
    // حارسُ «صفر زائف»: لو عندنا عدد > 0 ثمّ رجع 0، نَتحقّق مرّةً قبل التصديق
    const prev = cacheKey ? (typeof getCached(cacheKey) === 'number' ? getCached(cacheKey) : 0) : 0
    if (next === 0 && prev > 0 && retryRef.current < 2) {
      retryRef.current += 1
      setTimeout(() => load(), 800)
      return
    }
    retryRef.current = 0
    setCount(next)
    if (cacheKey) setCached(cacheKey, next)
  }, [user, cacheKey])

  useEffect(() => { load() }, [load])
  useRealtime('notif-count', user?.id ? [{ table: 'notifications' }] : [], load, 250, [user?.id, load])

  return [count, load]
}
