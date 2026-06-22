import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'
import { fmtDateTime } from '../lib/format'

const ACTION_LABEL = {
  plan_change:        { label: 'تغيير باقة',         tone: 'warn'   },
  extend_trial:       { label: 'تمديد تجربة',        tone: 'info'   },
  suspend:            { label: 'تعليق حساب',          tone: 'danger' },
  restore:            { label: 'إعادة تفعيل',         tone: 'ok'     },
  set_note:           { label: 'تحديث ملاحظة',        tone: 'muted'  },
  staff_role_set:     { label: 'تعيين/ترقية فريق',    tone: 'em'     },
  staff_removed:      { label: 'إزالة عضو فريق',      tone: 'danger' },
  invite_sent:        { label: 'إرسال دعوة',          tone: 'info'   },
  invite_prelim_ok:   { label: 'موافقة مبدئية',     tone: 'info'   },
  invite_interview_done: { label: 'انتهت المقابلة',    tone: 'muted'  },
  invite_final_ok:    { label: 'قبول نهائي',         tone: 'ok'     },
  invite_rejected:    { label: 'رفض',                   tone: 'danger' },
  invite_activated:   { label: 'تفعيل',                tone: 'em'     },
  invite_cancelled:   { label: 'إلغاء دعوة',           tone: 'muted'  },
}

export default function AdminAuditLog() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    let q = supabase.from('platform_audit_log')
      .select('id, admin_name, admin_role, action, target_label, details, created_at')
      .order('created_at', { ascending: false }).limit(300)
    if (filter === 'staff') q = q.in('action', ['staff_role_set', 'staff_removed', 'invite_sent', 'invite_activated'])
    else if (filter === 'invites') q = q.in('action', ['invite_sent', 'invite_prelim_ok', 'invite_final_ok', 'invite_rejected', 'invite_activated', 'invite_cancelled'])
    else if (filter !== 'all') q = q.eq('action', filter)
    const { data, error } = await q
    if (error) setErr('تعذر التحميل: ' + error.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [filter])
  useEffect(() => { load() }, [load])

  const filters = [
    { k: 'all',          t: 'الكل' },
    { k: 'invites',      t: 'التوظيف' },
    { k: 'plan_change',  t: 'الباقات' },
    { k: 'extend_trial', t: 'تمديدات' },
    { k: 'suspend',      t: 'تعليقات' },
    { k: 'restore',      t: 'تفعيلات' },
    { k: 'staff',        t: 'الفريق' },
  ]

  return (
    <div className="mlk-tab">
      <header className="mlk-tab-head">
        <h1 className="mlk-tab-title">سجل النشاط</h1>
        <span className="mlk-tab-count">{rows.length} حدث</span>
        <button className="mlk-action" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={13} />}
          تحديث
        </button>
      </header>

      <div className="mlk-filter">
        {filters.map(c => (
          <button key={c.k} className={`mlk-fchip ${filter === c.k ? 'active' : ''}`}
                  onClick={() => setFilter(c.k)}>{c.t}</button>
        ))}
      </div>

      {err && <div className="alert err">{err}</div>}

      {loading ? <SkeletonList count={5} /> :
       rows.length === 0 ? <div className="mlk-empty">لا نشاط في هذه التصفية</div> :
       <ul className="mlk-list">
         {rows.map(r => {
           const meta = ACTION_LABEL[r.action] || { label: r.action, tone: 'muted' }
           const detail = formatDetails(r.action, r.details)
           return (
             <li key={r.id} className="mlk-list-row">
               <div className="mlk-list-body">
                 <div className="mlk-list-meta">
                   <span className={`mlk-pill ${meta.tone}`}>{meta.label}</span>
                   <span>·</span>
                   <span>{r.admin_name || '—'}</span>
                   <span className="mlk-list-time" style={{ marginInlineStart: 'auto' }}>{fmtDateTime(r.created_at)}</span>
                 </div>
                 {r.target_label && <div className="mlk-list-title">{r.target_label}</div>}
                 {detail && <div className="mlk-list-meta" style={{ fontSize: 12 }}>{detail}</div>}
               </div>
             </li>
           )
         })}
       </ul>}
    </div>
  )
}

function formatDetails(action, d) {
  if (!d) return null
  if (action === 'plan_change' && d.from && d.to) return `${d.from} → ${d.to}${d.reason ? ' · ' + d.reason : ''}`
  if (action === 'extend_trial' && d.days) return `+${d.days} يوما${d.reason ? ' · ' + d.reason : ''}`
  if (action === 'suspend' && d.reason) return d.reason
  if (action === 'restore' && d.prev_reason) return 'السابق: ' + d.prev_reason
  if (action === 'staff_role_set') return `${d.from || '—'} → ${d.to || '—'}`
  if (action === 'staff_removed') return 'الدور السابق: ' + (d.from || '—')
  if (action === 'invite_sent') return d.role
  if (action === 'invite_prelim_ok' && d.interview_at) return new Date(d.interview_at).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  if (action === 'invite_rejected') return `${d.stage || ''} · ${d.reason || ''}`
  if (action === 'invite_activated') return d.role
  return null
}
