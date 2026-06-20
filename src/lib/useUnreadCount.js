import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from '../app/useAuth'
import { useRealtime } from './useRealtime'

/**
 * عدّاد الإشعارات غير المقروءة — للشارة في الرأس.
 * ★ لا cache هنا — البياناتُ تَتغيّر بفعل المستخدم (markRead) ولا يَجوز
 *   أن يَرى رقمًا قديمًا بعد قراءته للإشعارات. realtime يَكفل التحديثَ السريع.
 * @returns {[number, () => Promise<void>]} [العدد, إعادة التحميل]
 */
export function useUnreadCount() {
  const { user } = useAuth()
  const [count, setCount] = useState(0)

  const load = useCallback(async () => {
    if (!user?.id) return
    const { data, error } = await supabase.rpc('unread_notifications_count')
    if (error) return // أبقِ القيمة الحاليّة
    let next = null
    if (typeof data === 'number') next = data
    else if (Array.isArray(data) && typeof data[0] === 'number') next = data[0]
    if (next != null) setCount(next)
  }, [user])

  useEffect(() => { load() }, [load])
  useRealtime('notif-count', user?.id ? [{ table: 'notifications' }] : [], load, 250, [user?.id, load])

  return [count, load]
}
