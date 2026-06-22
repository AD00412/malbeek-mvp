import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useRealtime } from '../lib/useRealtime'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'

const STATUS_AR = { registered: 'مسجل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة' }
const TRIP_STATUS_AR = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', done: 'منتهية' }

const ACTION_AR = {
  create: { t: 'إنشاء', icon: 'plus', cls: 'ok' },
  delete: { t: 'حذف', icon: 'trash', cls: 'danger' },
  update: { t: 'تحديث', icon: 'edit', cls: 'info' },
  status_change: { t: 'تغيير الحالة', icon: 'refresh', cls: 'warn' },
  payment_confirmed: { t: 'تأكيد دفع', icon: 'payments', cls: 'ok' },
  seat_assign: { t: 'إسناد مقعد', icon: 'seat', cls: 'info' },
  bus_assign: { t: 'تغيير الحافلة', icon: 'bus', cls: 'info' },
  room_assign: { t: 'إسناد غرفة', icon: 'bed', cls: 'info' },
  amount_change: { t: 'تعديل المبلغ', icon: 'payments', cls: 'warn' },
  proof_attached: { t: 'إرفاق إيصال دفع', icon: 'download', cls: 'info' },
  proof_removed: { t: 'إزالة إيصال دفع', icon: 'trash', cls: 'muted' },
  role_change: { t: 'تغيير دور عضو', icon: 'customers', cls: 'info' },
}

const MEMBER_ROLE_AR = { owner: 'المالك', manager: 'مشرف', staff: 'موظف' }

const ROLE_AR = { admin: 'إدارة المنصة', subscriber: 'المالك', customer: 'العميل', system: 'بوابة الدفع', unknown: '—' }

function relTime(v) {
  if (!v) return ''
  const diff = (Date.now() - new Date(v).getTime()) / 60000
  if (diff < 1) return 'الآن'
  if (diff < 60) return `قبل ${Math.floor(diff)} دقيقة`
  if (diff < 1440) return `قبل ${Math.floor(diff / 60)} ساعة`
  const d = new Date(v)
  return d.toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
}

/** يصف تغيير حقل واحد في رسالة عربية */
function describeField(field, change) {
  const { old: ov, new: nv } = change || {}
  switch (field) {
    case 'status': return `الحالة: ${STATUS_AR[ov] || ov || '—'} → ${STATUS_AR[nv] || nv || '—'}`
    case 'seat_no': return `المقعد: ${ov || '—'} → ${nv || '—'}`
    case 'bus_id': return `تغيير الحافلة`
    case 'room_id': return ov ? (nv ? 'تغيير الغرفة' : 'إخراج من الغرفة') : 'تسكين في غرفة'
    case 'amount':  return `المبلغ: ${ov ?? '—'} → ${nv ?? '—'}`
    case 'paid_at': return nv ? 'ختم وقت الدفع' : 'إلغاء ختم الدفع'
    case 'price':   return `سعر المقعد: ${ov ?? '—'} → ${nv ?? '—'}`
    case 'capacity':return `السعة: ${ov ?? '—'} → ${nv ?? '—'}`
    case 'role':    return `الدور: ${MEMBER_ROLE_AR[ov] || ov || '—'} → ${MEMBER_ROLE_AR[nv] || nv || '—'}`
    case 'payment_proof_url': return nv ? 'أرفق إيصال الدفع' : 'أزيل إيصال الدفع'
    default: return field
  }
}

function describeAction(log) {
  const a = ACTION_AR[log.action] || { t: log.action, icon: 'edit', cls: 'muted' }
  const ent = log.entity === 'trip'
    ? (log.action === 'status_change' && log.changes?.status
        ? `الرحلة: ${TRIP_STATUS_AR[log.changes.status.old] || log.changes.status.old} → ${TRIP_STATUS_AR[log.changes.status.new] || log.changes.status.new}`
        : `الرحلة «${log.entity_label || '—'}»`)
    : `«${log.entity_label || '—'}»`
  return { ...a, ent }
}

/**
 * سجل نشاط الرحلة — يقرأ audit_logs مفلترة بـ trip_id (RLS تحرس الملكية).
 */
export default function AuditLogSheet({ open, tripId, subscriberId, onClose }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')   // all | passenger | trip | member

  const load = useCallback(async () => {
    if (!open || !tripId) return
    setLoading(true)
    // أحداث الرحلة + أحداث الفريق (subscriber-scope بلا trip_id) معا
    const tripQ = supabase
      .from('audit_logs')
      .select('id, actor_email, actor_role, entity, entity_id, entity_label, action, changes, created_at')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: false })
      .limit(200)
    const memberQ = subscriberId
      ? supabase.from('audit_logs')
          .select('id, actor_email, actor_role, entity, entity_id, entity_label, action, changes, created_at')
          .eq('subscriber_id', subscriberId).eq('entity', 'member')
          .is('trip_id', null)
          .order('created_at', { ascending: false }).limit(50)
      : Promise.resolve({ data: [] })
    const [t, m] = await Promise.all([tripQ, memberQ])
    const merged = [...(t.data ?? []), ...(m.data ?? [])]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    setLogs(merged)
    setLoading(false)
  }, [open, tripId, subscriberId])

  useEffect(() => { load() }, [load])

  // تحديث حي — أحداث جديدة تظهر فورا
  useRealtime('audit-log', open && tripId ? [{ table: 'audit_logs', filter: `trip_id=eq.${tripId}` }] : [],
    load, 300, [open, tripId, load])

  const filtered = filter === 'all' ? logs : logs.filter((l) => l.entity === filter)

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="سجل نشاط الرحلة"
      actions={<button className="btn btn-gold btn-block" onClick={onClose}>تم</button>}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[
          { v: 'all', t: 'الكل' },
          { v: 'passenger', t: 'المعتمرون' },
          { v: 'trip', t: 'الرحلة' },
          { v: 'member', t: 'الفريق' },
        ].map((f) => (
          <button key={f.v} type="button"
            className={`bus-tab ${filter === f.v ? 'active' : ''}`}
            onClick={() => setFilter(f.v)}>{f.t}</button>
        ))}
      </div>

      {loading ? (
        <SkeletonList count={4} />
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="em-ttl">لا نشاط بعد</div>
          <div>سيسجل هنا كل تغيير على المعتمرين والرحلة تلقائيا.</div>
        </div>
      ) : (
        <div className="audit-list">
          {filtered.map((l) => {
            const a = describeAction(l)
            const fields = l.changes && typeof l.changes === 'object'
              ? Object.entries(l.changes).filter(([k, v]) => v && typeof v === 'object' && ('old' in v || 'new' in v))
              : []
            return (
              <div key={l.id} className="audit-row">
                <span className={`audit-ic ${a.cls}`}><Icon name={a.icon} size={15} /></span>
                <div className="audit-main">
                  <div className="audit-title">
                    <strong>{a.t}</strong> · {a.ent}
                  </div>
                  {fields.length > 0 && (
                    <div className="audit-changes">
                      {fields.map(([f, c]) => <div key={f}>· {describeField(f, c)}</div>)}
                    </div>
                  )}
                  <div className="audit-meta">
                    {l.actor_email || ROLE_AR[l.actor_role] || ROLE_AR.unknown} · {relTime(l.created_at)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </BottomSheet>
  )
}
