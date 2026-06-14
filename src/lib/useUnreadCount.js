import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from '../app/useAuth'
import { useRealtime } from './useRealtime'

/**
 * عدّاد الإشعارات غير المقروءة — يُستخدم في شارة الجرس داخل الرأس.
 * مفصولٌ عن مكوّن مركز الإشعارات كي لا يكسر Fast Refresh.
 * @returns {[number, () => Promise<void>]} [العدد, إعادة التحميل]
 */
export function useUnreadCount() {
  const { user } = useAuth()
  const [count, setCount] = useState(0)

  const load = useCallback(async () => {
    if (!user?.id) return
    const { data } = await supabase.rpc('unread_notifications_count')
    if (typeof data === 'number') setCount(data)
    else if (Array.isArray(data) && typeof data[0] === 'number') setCount(data[0])
  }, [user])

  useEffect(() => { load() }, [load])
  useRealtime('notif-count', user?.id ? [{ table: 'notifications' }] : [], load, 250, [user?.id, load])

  return [count, load]
}
