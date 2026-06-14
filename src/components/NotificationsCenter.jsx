import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../app/useAuth'
import { useRealtime } from '../lib/useRealtime'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'

const KIND_ICON = {
  new_booking: 'customers', payment_pending: 'payments', booking_canceled: 'trash',
  feedback_reply: 'message', trial_ending: 'sparkle', upgrade_request: 'sparkle',
  low_occupancy: 'chart', trial_limit_hit: 'sparkle',
  new_subscriber: 'building', new_feedback: 'message', trip_changed: 'trips',
}

function fmt(v) {
  if (!v) return ''
  try {
    const d = new Date(v)
    const diff = (Date.now() - d.getTime()) / 60000
    if (diff < 1) return 'الآن'
    if (diff < 60) return `قبل ${Math.floor(diff)} دقيقة`
    if (diff < 1440) return `قبل ${Math.floor(diff / 60)} ساعة`
    return d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: '2-digit' })
  } catch { return '' }
}

/** ورقةُ مركز الإشعارات */
export default function NotificationsCenter({ open, onClose, onChanged }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!user?.id || !open) return
    setLoading(true); setErr('')
    const { data, error } = await supabase
      .from('notifications')
      .select('id, kind, title, body, ref_trip, ref_passenger, ref_feedback, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    // فرّق بين «لا إشعارات» و«تعذّر الجلب» — لا تُظهر فراغًا مضلّلًا عند الخطأ.
    if (error) setErr('تعذّر تحميل الإشعارات — تحقّق من اتصالك ثمّ حدّث.')
    else setItems(data ?? [])
    setLoading(false)
  }, [user, open])

  useEffect(() => { load() }, [load])
  useRealtime('notif-list', open && user?.id ? [{ table: 'notifications' }] : [], load, 200, [open, user?.id, load])

  async function markRead(id) {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    onChanged?.()
  }
  async function markAllRead() {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id)
    if (!ids.length) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
    onChanged?.()
  }

  const unreadCount = items.filter((n) => !n.read_at).length

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={`الإشعارات${unreadCount ? ` · ${unreadCount} جديد` : ''}`}
      actions={
        <>
          <button className="btn btn-ghost" onClick={markAllRead} disabled={unreadCount === 0}>
            <Icon name="check" size={15} /> تعليم الكل كمقروء
          </button>
          <button className="btn btn-gold" onClick={onClose}>تم</button>
        </>
      }
    >
      {loading ? (
        <SkeletonList count={5} />
      ) : err ? (
        <div className="alert err" style={{ marginTop: 4 }}>
          {err}
          <button className="icon-btn" style={{ marginInlineStart: 10 }} onClick={load}>
            <Icon name="refresh" size={14} /> إعادة المحاولة
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <div className="em-ttl">لا إشعارات بعد</div>
          <div>ستصلك التنبيهات هنا فور حدوثها — حجوزاتٌ جديدة، تأكيد دفع، ردود الإدارة…</div>
        </div>
      ) : (
        <div className="notif-list">
          {items.map((n) => (
            <button
              type="button"
              className={`notif-row ${n.read_at ? '' : 'unread'}`}
              key={n.id}
              onClick={() => !n.read_at && markRead(n.id)}
            >
              <span className="notif-ic"><Icon name={KIND_ICON[n.kind] || 'bell'} size={16} /></span>
              <div className="notif-main">
                <div className="notif-title">{n.title}{!n.read_at && <span className="notif-dot" />}</div>
                {n.body && <div className="notif-body">{n.body}</div>}
                <div className="notif-time">{fmt(n.created_at)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  )
}
