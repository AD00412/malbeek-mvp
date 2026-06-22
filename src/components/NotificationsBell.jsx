import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../app/useAuth'
import { useUI } from '../lib/useUI'
import { useRealtime } from '../lib/useRealtime'
import { useUnreadCount } from '../lib/useUnreadCount'
import { buildNotificationContent } from '../lib/pushContent'
import { showLocalNotification, enablePush } from '../lib/push'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'

const KIND_ICON = {
  new_booking: 'customers', payment_pending: 'payments', booking_canceled: 'trash',
  feedback_reply: 'message', trial_ending: 'sparkle', upgrade_request: 'sparkle',
  low_occupancy: 'chart', trial_limit_hit: 'sparkle',
  new_subscriber: 'building', new_feedback: 'message', trip_changed: 'trips',
}
// إشعاراتٌ عاجلةٌ تُبرز بأولويّةٍ بصريّة (لون/شارة).
const URGENT_KINDS = new Set(['payment_pending', 'booking_canceled', 'trial_ending', 'trial_limit_hit'])

const MUTE_KEY = 'mlk:notif-muted'

// نغمةٌ لطيفةٌ قصيرةٌ عبر Web Audio — بلا ملفّ صوتٍ خارجيّ. تُحترم حالةُ الكتم
// وقيودُ المتصفّح (تتطلّب تفاعلًا مسبقًا؛ نلتقط الخطأ بصمت).
function playChime() {
  try {
    if (localStorage.getItem(MUTE_KEY) === '1') return
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    const notes = [880, 1174.7] // لا ثمّ ري — نغمتان صاعدتان هادئتان
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.value = freq
      const t = now + i * 0.12
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.18, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(t); osc.stop(t + 0.3)
    })
    setTimeout(() => { try { ctx.close() } catch { /* */ } }, 800)
  } catch { /* الصوت أمرٌ تجميليّ — لا يُعطّل شيئًا */ }
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

// تجميعٌ زمنيٌّ ذكيّ: اليوم / أمس / أقدم.
function dayBucket(v) {
  try {
    const d = new Date(v).getTime()
    const n = new Date()
    const startToday = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()
    if (d >= startToday) return 'اليوم'
    if (d >= startToday - 86400000) return 'أمس'
    return 'أقدم'
  } catch { return 'أقدم' }
}

/**
 * جرس الإشعارات — زر في الرأس + قائمة منسدلة. مطوّر:
 *  • صوتٌ لطيفٌ عند وصول إشعارٍ جديد (يحترم الكتم وأذونات المتصفّح).
 *  • تنبيهُ متصفّحٍ اختياريٌّ عند الإذن. • تجميعٌ زمنيّ. • إبرازُ العاجل.
 */
export default function NotificationsBell({ onNavigate }) {
  const { user } = useAuth()
  const { toast } = useUI()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [unread, reloadUnread] = useUnreadCount()
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false } })
  const wrapRef = useRef(null)
  const prevUnreadRef = useRef(null)

  const load = useCallback(async () => {
    if (!user?.id || !open) return
    setLoading(true); setErr('')
    const { data, error } = await supabase
      .from('notifications')
      .select('id, kind, title, body, ref_trip, ref_passenger, ref_feedback, read_at, created_at')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) { setErr('تعذر التحميل — تحقق من اتصالك ثم حدث.'); setLoading(false); return }
    setItems(data ?? [])
    setLoading(false)
  }, [user, open])

  useEffect(() => { load() }, [load])
  useRealtime('notif-list', open && user?.id ? [{ table: 'notifications' }] : [], load, 200, [open, user?.id, load])

  // ★ تنبيهٌ عند الوصول: حين يزيد العدّاد (إشعارٌ جديد) نشغّل النغمة + إشعارًا
  //   نظيفًا سياقيًّا عبر الـSW (عنوان+جسم+رابطٌ عميق، بلا «from»). نجلب أحدثَ
  //   إشعارٍ غير مقروءٍ لنعرض محتواه الفعليّ حتى لو كانت القائمة مغلقة.
  useEffect(() => {
    const prev = prevUnreadRef.current
    if (prev != null && unread > prev) {
      playChime()
      ;(async () => {
        const { data } = await supabase.from('notifications')
          .select('kind, title, body, ref_trip, ref_feedback')
          .is('read_at', null).order('created_at', { ascending: false }).limit(1)
        const row = (data && data[0]) || {}
        const c = buildNotificationContent(row)
        showLocalNotification({ title: c.title, body: c.body, url: c.url, tag: c.tag })
      })()
    }
    prevUnreadRef.current = unread
  }, [unread])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  function toggleMute() {
    setMuted((m) => {
      const next = !m
      try { localStorage.setItem(MUTE_KEY, next ? '1' : '0') } catch { /* */ }
      return next
    })
  }

  // تفعيلُ الإشعارات الفوريّة مع تغذيةٍ راجعةٍ واضحةٍ لكل حالة (لا فشلٌ صامت).
  const [pushBusy, setPushBusy] = useState(false)
  async function activatePush() {
    setPushBusy(true)
    let r
    try { r = await enablePush() } catch (e) { r = { ok: false, reason: 'subscribe-failed' } }
    setPushBusy(false)
    const MSG = {
      subscribed: ['فُعّلت الإشعارات على هذا الجهاز ✓', 'success'],
      'ios-needs-install': ['على iPhone: ثبّت «ملبّيك» على الشاشة الرئيسية أولًا (مشاركة ← إضافة إلى الشاشة الرئيسية)، ثم افتحه وفعّل الإشعارات من داخله.', 'info'],
      denied: ['إذن الإشعارات مرفوض — فعّله من إعدادات المتصفّح/الجهاز ثم أعد المحاولة.', 'warn'],
      dismissed: ['أُغلق طلب الإذن — اضغط مرّةً أخرى وامنح الإذن.', 'info'],
      unsupported: ['متصفّحك لا يدعم الإشعارات الفوريّة.', 'warn'],
      'sw-failed': ['تعذّر تجهيز الإشعارات — أعد تحميل الصفحة وحاول.', 'error'],
      'subscribe-failed': ['تعذّر الاشتراك — حاول مجدّدًا.', 'error'],
      'save-failed': ['تعذّر حفظ الاشتراك — تحقّق من اتصالك.', 'error'],
    }
    const [msg, type] = MSG[r.reason] || ['تعذّر التفعيل.', 'error']
    toast(msg, { type })
    if (r.ok) { setMuted(false); try { localStorage.setItem(MUTE_KEY, '0') } catch { /* */ } }
  }

  async function dismiss(id) {
    const now = new Date().toISOString()
    setItems((prev) => prev.filter((n) => n.id !== id))
    const { error } = await supabase.from('notifications').update({ read_at: now }).eq('id', id)
    if (error) load(); else reloadUnread()
  }
  async function dismissAll() {
    if (!items.length) return
    const now = new Date().toISOString()
    const ids = items.map((n) => n.id)
    setItems([])
    const { error } = await supabase.from('notifications').update({ read_at: now }).in('id', ids)
    if (error) load(); else reloadUnread()
  }

  // بناء قائمةٍ مجمّعةٍ زمنيًّا للعرض (العاجل يُبرز داخل مجموعته).
  const groups = []
  let lastBucket = null
  for (const n of items) {
    const b = dayBucket(n.created_at)
    if (b !== lastBucket) { groups.push({ label: b, rows: [] }); lastBucket = b }
    groups[groups.length - 1].rows.push(n)
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
            <button className="notif-pop-action" onClick={toggleMute}
                    title={muted ? 'تشغيل صوت التنبيه' : 'كتم صوت التنبيه'} aria-label="كتم/تشغيل الصوت">
              <Icon name={muted ? 'bell' : 'bell'} size={14} /> {muted ? 'الصوت مكتوم' : 'الصوت مفعّل'}
            </button>
            {items.length > 0 && (
              <button className="notif-pop-action" onClick={dismissAll}>مسح الكل</button>
            )}
          </div>

          {typeof Notification !== 'undefined' && Notification.permission !== 'granted' && (
            <div className="alert info" style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Icon name="bell" size={15} />
              <span style={{ flex: 1, fontSize: 12.5 }}>فعّل الإشعارات الفوريّة لتصلك التنبيهات على جهازك حتى والتطبيق مغلق.</span>
              <button className="btn btn-em btn-sm" onClick={activatePush} disabled={pushBusy}>
                {pushBusy ? <span className="spinner" /> : 'تفعيل الإشعارات'}
              </button>
            </div>
          )}

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
                {groups.map((g) => (
                  <div key={g.label} className="notif-group">
                    <div className="notif-group-label">{g.label}</div>
                    {g.rows.map((n) => {
                      const urgent = URGENT_KINDS.has(n.kind)
                      return (
                        <button
                          type="button"
                          className={`notif-row ${n.read_at ? '' : 'unread'} ${urgent ? 'urgent' : ''}`}
                          key={n.id}
                          onClick={() => {
                            if (n.ref_trip && onNavigate) { onNavigate(n); setOpen(false) }
                            dismiss(n.id)
                          }}
                        >
                          <span className="notif-ic"><Icon name={KIND_ICON[n.kind] || 'bell'} size={15} /></span>
                          <div className="notif-main">
                            <div className="notif-title">
                              {urgent && <span className="notif-urgent-tag">عاجل</span>}
                              {n.title}{!n.read_at && <span className="notif-dot" />}
                            </div>
                            {n.body && <div className="notif-body">{n.body}</div>}
                            <div className="notif-time">{fmt(n.created_at)}</div>
                          </div>
                          {n.ref_trip && onNavigate && <Icon name="chevron" size={14} />}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
