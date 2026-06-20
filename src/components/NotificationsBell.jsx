import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../app/useAuth'
import { useRealtime } from '../lib/useRealtime'
import { useUnreadCount } from '../lib/useUnreadCount'
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

/**
 * جرس الإشعارات — زرٌّ في الرأس + قائمةٌ منسدلةٌ (Popover) أسفله.
 * يحلّ محلّ NotificationsCenter (BottomSheet) ليطابق نمط AccountMenu —
 * تجربةٌ موحّدةٌ سلسةٌ على iPhone/Android/سطح المكتب.
 */
export default function NotificationsBell({ onNavigate }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  // ★ لا cache هنا — الإشعارات حالةٌ ديناميكيّة (read_at يَتغيّر بالضغطة).
  //   كلُّ فتحٍ للقائمة = تحميلٌ طازجٌ من DB. التحميلُ خاطفٌ (٢٠٠ms).
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [unread, reloadUnread] = useUnreadCount()
  const wrapRef = useRef(null)

  const load = useCallback(async () => {
    if (!user?.id || !open) return
    setLoading(true); setErr('')
    const { data, error } = await supabase
      .from('notifications')
      .select('id, kind, title, body, ref_trip, ref_passenger, ref_feedback, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      setErr('تعذّر التحميل — تحقّق من اتصالك ثمّ حدّث.')
      setLoading(false)
      return
    }
    setItems(data ?? [])
    setLoading(false)
  }, [user, open])

  useEffect(() => { load() }, [load])
  useRealtime('notif-list', open && user?.id ? [{ table: 'notifications' }] : [], load, 200, [open, user?.id, load])

  // أغلق بنقرةٍ خارجها أو Escape
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function markRead(id) {
    const now = new Date().toISOString()
    // ★ تحديثٌ تفاؤليّ فوريّ — الـUI يَنعكس قبل ردِّ الشبكة
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, read_at: now } : n))
    const { error } = await supabase.from('notifications').update({ read_at: now }).eq('id', id)
    if (error) {
      // فشل → استرجع الحالة + أعد تحميل
      setItems((prev) => prev.map((n) => n.id === id ? { ...n, read_at: null } : n))
      load()
    } else {
      reloadUnread()  // حدّث شارة الجرس فورًا
    }
  }
  async function markAllRead() {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id)
    if (!ids.length) return
    const now = new Date().toISOString()
    // ★ تحديثٌ تفاؤليّ
    setItems((prev) => prev.map((n) => ids.includes(n.id) ? { ...n, read_at: now } : n))
    const { error } = await supabase.from('notifications').update({ read_at: now }).in('id', ids)
    if (error) {
      load()  // استرجع
    } else {
      reloadUnread()
    }
  }

  return (
    <div className="acct-wrap" ref={wrapRef}>
      <button type="button" className="icon-bubble" aria-label="الإشعارات"
        onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
        style={{ position: 'relative' }}>
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="acct-pop notif-pop" role="menu">
          <div className="notif-pop-head">
            <strong>الإشعارات</strong>
            {unread > 0 && <span className="notif-pop-count">{unread} جديد</span>}
            <span style={{ flex: 1 }} />
            {items.some((n) => !n.read_at) && (
              <button className="notif-pop-action" onClick={markAllRead}>تعليم الكلّ كمقروء</button>
            )}
          </div>

          <div className="notif-pop-body">
            {loading ? (
              <SkeletonList count={4} />
            ) : err ? (
              <div className="alert err" style={{ marginTop: 4 }}>
                {err}
                <button className="icon-btn" style={{ marginInlineStart: 10 }} onClick={load}>
                  <Icon name="refresh" size={14} /> إعادة المحاولة
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="notif-pop-empty">
                <Icon name="bell" size={26} />
                <div style={{ fontWeight: 700, marginTop: 8 }}>لا إشعارات بعد</div>
                <div style={{ fontSize: 12, marginTop: 4, color: 'var(--cr-300)' }}>ستصلك التنبيهات هنا فور حدوثها.</div>
              </div>
            ) : (
              <div className="notif-list" style={{ gap: 4 }}>
                {items.map((n) => (
                  <button
                    type="button"
                    className={`notif-row ${n.read_at ? '' : 'unread'}`}
                    key={n.id}
                    onClick={() => {
                      if (!n.read_at) markRead(n.id)
                      if (n.ref_trip && onNavigate) { onNavigate(n); setOpen(false) }
                    }}
                  >
                    <span className="notif-ic"><Icon name={KIND_ICON[n.kind] || 'bell'} size={15} /></span>
                    <div className="notif-main">
                      <div className="notif-title">{n.title}{!n.read_at && <span className="notif-dot" />}</div>
                      {n.body && <div className="notif-body">{n.body}</div>}
                      <div className="notif-time">{fmt(n.created_at)}</div>
                    </div>
                    {n.ref_trip && onNavigate && <Icon name="chevron" size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
