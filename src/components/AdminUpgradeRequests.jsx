import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'
import { useUI } from '../lib/useUI'
import { useAuth } from '../app/useAuth'
import { fmtDateTime } from '../lib/format'
import { translateRpcError } from '../lib/rpcErrors'

const STATUS_LABEL = {
  pending_proof: 'بانتظار إثبات الدفع',
  submitted:     'بانتظار المراجعة',
  approved:      'موافق — رقيت',
  rejected:      'مرفوض',
  cancelled:     'ملغى',
}
const STATUS_TONE = {
  pending_proof: 'warn', submitted: 'info', approved: 'ok', rejected: 'danger', cancelled: 'muted',
}

async function signedUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('plan-upgrade-proofs')
    .createSignedUrl(path, 600)
  if (error) return null
  return data?.signedUrl
}

export default function AdminUpgradeRequests() {
  const { role } = useAuth()
  const isAdmin = role === 'admin'
  const { confirm } = useUI()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('review')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [proofUrls, setProofUrls] = useState({})

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase.rpc('list_plan_upgrade_requests', { p_filter: filter })
    if (error) setErr('تعذر التحميل: ' + error.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [filter])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    let active = true
    ;(async () => {
      const entries = await Promise.all(
        rows.filter(r => r.proof_url).map(async r => [r.id, await signedUrl(r.proof_url)])
      )
      if (!active) return
      setProofUrls(Object.fromEntries(entries))
    })()
    return () => { active = false }
  }, [rows])

  function flash(setter, msg) {
    setter(msg); setTimeout(() => setter(''), 3500)
  }

  async function sendDecisionEmail(r) {
    try {
      await supabase.functions.invoke('send-upgrade-decision', { body: { request_id: r.id } })
    } catch { /* best-effort */ }
  }

  async function doApprove(r) {
    const ok2 = await confirm({
      title: 'الموافقة والترقية',
      message: `سيرقى «${r.org_name}» إلى الباقة المدفوعة فورا، ويستلم إيميل تأكيد. تأكيد؟`,
      confirmText: 'وافق ورق', cancelText: 'إلغاء',
    })
    if (!ok2) return
    setBusy(r.id); setErr('')
    const { error } = await supabase.rpc('approve_plan_upgrade', { p_req: r.id, p_notes: null })
    if (error) { setBusy(''); return setErr(translateRpcError(error, 'تعذرت الموافقة.')) }
    await sendDecisionEmail(r)
    setBusy('')
    flash(setOk, 'ووفق ورقي ✓ — أرسل الإيميل')
    load()
  }

  async function doReject(r) {
    const reason = window.prompt(`سبب رفض طلب «${r.org_name}»؟ (٥ أحرف فأكثر)`)
    if (!reason || reason.trim().length < 5) return
    setBusy(r.id); setErr('')
    const { error } = await supabase.rpc('reject_plan_upgrade', { p_req: r.id, p_reason: reason.trim() })
    if (error) { setBusy(''); return setErr(translateRpcError(error, 'تعذر الرفض.')) }
    await sendDecisionEmail(r)
    setBusy('')
    flash(setOk, 'رفض الطلب ✓ — أرسل الإيميل')
    load()
  }

  const counts = {
    review: rows.filter(r => r.status === 'submitted').length,
    pending: rows.filter(r => r.status === 'pending_proof').length,
  }

  return (
    <div className="mlk-tab">
      <header className="mlk-tab-head">
        <h1 className="mlk-tab-title">طلبات الترقية</h1>
        <span className="mlk-tab-count">{rows.length} طلب</span>
        <button className="mlk-action" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={13} />}
          تحديث
        </button>
      </header>

      <div className="mlk-filter">
        <button className={`mlk-fchip ${filter === 'review' ? 'active' : ''}`} onClick={() => setFilter('review')}>
          للمراجعة{counts.review > 0 ? ` (${counts.review})` : ''}
        </button>
        <button className={`mlk-fchip ${filter === 'pending' ? 'active' : ''}`} onClick={() => setFilter('pending')}>
          بانتظار الإثبات
        </button>
        <button className={`mlk-fchip ${filter === 'approved' ? 'active' : ''}`} onClick={() => setFilter('approved')}>
          موافقة
        </button>
        <button className={`mlk-fchip ${filter === 'rejected' ? 'active' : ''}`} onClick={() => setFilter('rejected')}>
          مرفوضة
        </button>
        <button className={`mlk-fchip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>الكل</button>
      </div>

      {err && <div className="alert err">{err}</div>}
      {ok && <div className="alert ok">{ok}</div>}

      {loading ? <SkeletonList count={3} /> :
       rows.length === 0 ? <div className="mlk-empty">لا توجد طلبات في هذه التصفية</div> :
       <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
         {rows.map(r => (
           <article key={r.id} className="mlk-card">
             <div className="mlk-list-meta" style={{ marginBottom: 6 }}>
               <span className={`mlk-pill ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
               <span className="mlk-pill em">{Number(r.amount).toLocaleString('en-US')} ﷼</span>
               <span className="mlk-list-time" style={{ marginInlineStart: 'auto' }}>
                 {fmtDateTime(r.submitted_at || r.requested_at)}
               </span>
             </div>
             <div className="mlk-list-title" style={{ fontSize: 17 }}>{r.org_name || '—'}</div>
             {r.owner_email && (
               <div className="mlk-list-meta ltr" style={{ marginTop: 4 }}>{r.owner_email}</div>
             )}
             {r.bank_ref && (
               <div className="mlk-list-meta" style={{ marginTop: 4 }}>مرجع التحويل: <span className="ltr">{r.bank_ref}</span></div>
             )}
             {r.applicant_notes && (
               <div className="mlk-card" style={{ marginTop: 8, fontSize: 13, whiteSpace: 'pre-wrap' }}>
                 {r.applicant_notes}
               </div>
             )}
             {r.reject_reason && (
               <div className="alert err" style={{ marginTop: 8 }}>
                 سبب الرفض: {r.reject_reason}
               </div>
             )}

             {/* إثبات الدفع */}
             {r.proof_url && proofUrls[r.id] && (
               <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                 <a href={proofUrls[r.id]} target="_blank" rel="noopener" className="mlk-action">
                   <Icon name="file-text" size={14} /> فتح إثبات الدفع
                 </a>
               </div>
             )}

             {/* أزرار الأدمن */}
             {isAdmin && r.status === 'submitted' && (
               <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                 <button className="mlk-action primary" onClick={() => doApprove(r)} disabled={busy === r.id}>
                   {busy === r.id ? <span className="spinner" /> : 'وافق ورق'}
                 </button>
                 <button className="mlk-action danger" onClick={() => doReject(r)} disabled={busy === r.id}>
                   رفض
                 </button>
               </div>
             )}
           </article>
         ))}
       </div>}
    </div>
  )
}
