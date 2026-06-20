import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'
import { fmtDateTime } from '../lib/format'

const ACTION_LABEL = {
  plan_change:     { label: 'تَغيير باقة',      cls: 'gold',   icon: 'sparkle'  },
  extend_trial:    { label: 'تَمديد تَجربة',     cls: 'info',   icon: 'calendar' },
  suspend:         { label: 'تَعليق حساب',       cls: 'danger', icon: 'bell'     },
  restore:         { label: 'إعادة تَفعيل',      cls: 'ok',     icon: 'check'    },
  set_note:        { label: 'تَحديث ملاحظة',     cls: 'muted',  icon: 'edit'     },
  staff_role_set:  { label: 'تَعيين/ترقية فريق', cls: 'gold',   icon: 'sparkle'  },
  staff_removed:   { label: 'إزالة عضو فريق',   cls: 'danger', icon: 'trash'    },
}

/**
 * سجلّ الإجراءات الإداريّة الكامل (admin + support يَقرآن).
 * يَعرض كلَّ ما فُعل على المنصّة — مرشَّحٌ بالنوع والمستهدَف.
 */
export default function AdminAuditLog() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('all')   // all | plan_change | extend_trial | suspend | restore | staff

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    let q = supabase.from('platform_audit_log')
      .select('id, admin_id, admin_name, admin_role, action, target_type, target_id, target_label, details, created_at')
      .order('created_at', { ascending: false }).limit(300)
    if (filter === 'staff') q = q.in('action', ['staff_role_set', 'staff_removed'])
    else if (filter !== 'all') q = q.eq('action', filter)
    const { data, error } = await q
    if (error) setErr('تعذّر التحميل: ' + error.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [filter])
  useEffect(() => { load() }, [load])

  const filters = [
    { k: 'all',          t: 'الكل' },
    { k: 'plan_change',  t: 'الباقات' },
    { k: 'extend_trial', t: 'تَمديدات' },
    { k: 'suspend',      t: 'تَعليقات' },
    { k: 'restore',      t: 'تَفعيلات' },
    { k: 'staff',        t: 'الفريق' },
  ]

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>سجلّ النَّشاط الإداريّ</h3>
        <span className="sub">({rows.length})</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
          تحديث
        </button>
      </div>

      <div className="chips" style={{ marginTop: 0, marginBottom: 8 }}>
        {filters.map((c) => (
          <button key={c.k} className={`chip ${filter === c.k ? 'active' : ''}`} onClick={() => setFilter(c.k)}>{c.t}</button>
        ))}
      </div>

      {err && <div className="alert err" style={{ marginBottom: 10 }}>{err}</div>}

      {loading ? (
        <SkeletonList count={5} />
      ) : rows.length === 0 ? (
        <div className="empty"><div className="em-ttl">لا نَشاطَ في هذه التصفية</div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => {
            const meta = ACTION_LABEL[r.action] || { label: r.action, cls: 'muted', icon: 'bell' }
            return (
              <div key={r.id} className="trip-card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8,
                    background: `var(--${meta.cls === 'gold' ? 'em' : meta.cls === 'danger' ? 'danger' : 'info'}-ink)`,
                    opacity: .15, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <span className={`tag ${meta.cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon name={meta.icon} size={11} /> {meta.label}
                      </span>
                      <span className="muted" style={{ fontSize: 11 }}>{fmtDateTime(r.created_at)}</span>
                    </div>
                    {r.target_label && (
                      <div style={{ marginTop: 6, fontWeight: 600, fontSize: 13.5, color: 'var(--cr-50)' }}>
                        {r.target_label}
                      </div>
                    )}
                    <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                      {r.admin_name || '—'}
                      <span className="tag muted" style={{ fontSize: 9, marginInlineStart: 6 }}>{r.admin_role || '?'}</span>
                    </div>
                    {r.details && Object.keys(r.details).length > 0 && (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--cr-200)' }}>
                        {formatDetails(r.action, r.details)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function formatDetails(action, d) {
  if (action === 'plan_change' && d.from && d.to) return `الباقة: ${d.from} → ${d.to}` + (d.reason ? ` · ${d.reason}` : '')
  if (action === 'extend_trial' && d.days) return `+${d.days} يومًا حتّى ${d.until ? new Date(d.until).toLocaleDateString('ar-SA') : '—'}` + (d.reason ? ` · ${d.reason}` : '')
  if (action === 'suspend' && d.reason) return `السبب: ${d.reason}`
  if (action === 'restore' && d.prev_reason) return `السبب السابق: ${d.prev_reason}`
  if (action === 'set_note' && d.length) return `طول الملاحظة: ${d.length} حرف`
  if (action === 'staff_role_set') return `${d.from || '—'} → ${d.to || '—'}`
  if (action === 'staff_removed') return `الدور السابق: ${d.from || '—'}`
  return null
}
