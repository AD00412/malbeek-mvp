import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useUI } from '../lib/useUI'
import { fmtDateTime } from '../lib/format'
import { translateRpcError } from '../lib/rpcErrors'

const STATUS_LABEL = {
  pending: 'بانتظار التسجيل',
  submitted: 'بانتظار مراجعة الوثائق',
  prelim_approved: 'موافقة مبدئية — موعد مقابلة',
  interview_done: 'انتهت المقابلة — قرار نهائي',
  final_approved: 'قبول نهائي — بانتظار نموذج التوظيف',
  onboarded: 'أكمل النموذج — بانتظار التفعيل',
  active: 'مفعل',
  rejected_documents: 'رفض في مرحلة الوثائق',
  rejected_interview: 'رفض بعد المقابلة',
  expired: 'منتهية',
  cancelled: 'ملغاة',
}
const STATUS_TONE = {
  pending: 'warn', submitted: 'info', prelim_approved: 'info', interview_done: 'warn',
  final_approved: 'ok', onboarded: 'warn', active: 'ok',
  rejected_documents: 'danger', rejected_interview: 'danger',
  expired: 'muted', cancelled: 'muted',
}
const ROLE_LABEL = { admin: 'أدمن', support: 'دعم' }

async function signedUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('staff-applications')
    .createSignedUrl(path, 600) // ١٠ دقائق
  if (error) return null
  return data?.signedUrl
}

/**
 * شاشة مراجعة تفصيلية لطلب توظيف.
 * Props: invitation (full row), onUpdate (callback after action)
 */
export default function InvitationReview({ invitation: inv, onClose, onUpdate }) {
  const { confirm } = useUI()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // signed URLs
  const [idUrl, setIdUrl] = useState(null)
  const [cvUrl, setCvUrl] = useState(null)
  const [qualUrls, setQualUrls] = useState([])

  // prelim form
  const [showPrelim, setShowPrelim] = useState(false)
  const [interviewAt, setInterviewAt] = useState('')
  const [interviewLoc, setInterviewLoc] = useState('')
  const [interviewNotes, setInterviewNotes] = useState('')

  // final/reject form
  const [showFinal, setShowFinal] = useState(false)
  const [finalNotes, setFinalNotes] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      const [a, b] = await Promise.all([
        signedUrl(inv.id_card_url),
        signedUrl(inv.cv_url),
      ])
      const qs = await Promise.all((inv.qual_urls || []).map(signedUrl))
      if (!active) return
      setIdUrl(a); setCvUrl(b); setQualUrls(qs)
    })()
    return () => { active = false }
  }, [inv.id])

  async function sendDecisionEmail(kind) {
    // kind = 'interview' | 'decision' — يستدعى بعد كل انتقال
    try {
      await supabase.functions.invoke(
        kind === 'interview' ? 'send-staff-interview' : 'send-staff-decision',
        { body: { invitation_id: inv.id } },
      )
    } catch { /* الإيميل تلقائي — لا نجبر فشله على الفشل العام */ }
  }

  async function doPrelim(e) {
    e.preventDefault()
    if (!interviewAt) return setErr('حدد موعد المقابلة.')
    // حارس: تاريخ غير صالح يرمي RangeError من toISOString — نتحقق أولا.
    const interviewDate = new Date(interviewAt)
    if (isNaN(interviewDate.getTime())) return setErr('موعد المقابلة غير صالح.')
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('preliminary_approve_invitation', {
      p_invitation: inv.id,
      p_interview_at: interviewDate.toISOString(),
      p_location: interviewLoc.trim() || null,
      p_notes: interviewNotes.trim() || null,
    })
    if (error) { setBusy(false); return setErr(translateRpcError(error, 'تعذرت الموافقة المبدئية.')) }
    await sendDecisionEmail('interview')
    setBusy(false); setShowPrelim(false)
    onUpdate?.()
  }

  async function doInterviewDone() {
    const ok = await confirm({
      title: 'تأكيد انتهاء المقابلة',
      message: 'هل أجريت المقابلة مع المتقدم؟',
      confirmText: 'نعم، انتهت', cancelText: 'لاحقا',
    })
    if (!ok) return
    setBusy(true)
    const { error } = await supabase.rpc('mark_interview_done', { p_invitation: inv.id })
    setBusy(false)
    if (error) return setErr(translateRpcError(error, 'تعذر التحديث.'))
    onUpdate?.()
  }

  async function doFinalApprove(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('final_approve_invitation', {
      p_invitation: inv.id,
      p_notes: finalNotes.trim() || null,
    })
    if (error) { setBusy(false); return setErr(translateRpcError(error, 'تعذر القبول النهائي.')) }
    await sendDecisionEmail('decision')
    setBusy(false); setShowFinal(false)
    onUpdate?.()
  }

  async function doReject() {
    const reason = window.prompt('سبب الرفض (٥ أحرف فأكثر) — سيسجل في الـaudit:')
    if (!reason || reason.trim().length < 5) return
    const ok = await confirm({
      title: 'رفض الطلب',
      message: `تأكيد الرفض في مرحلة «${inv.status === 'submitted' ? 'الوثائق' : 'المقابلة'}»؟`,
      confirmText: 'تأكيد الرفض', cancelText: 'إلغاء', danger: true,
    })
    if (!ok) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('reject_staff_invitation', {
      p_invitation: inv.id, p_reason: reason.trim(),
    })
    if (error) { setBusy(false); return setErr(translateRpcError(error, 'تعذر الرفض.')) }
    await sendDecisionEmail('decision')
    setBusy(false)
    onUpdate?.()
  }

  async function doActivate() {
    const ok = await confirm({
      title: 'تفعيل نهائي',
      message: `سيسند دور «${ROLE_LABEL[inv.invited_role]}» لـ${inv.applicant_full_name} ويمكنه الدخول لـ/admin فورا. تأكيد؟`,
      confirmText: 'فعل الدور', cancelText: 'إلغاء',
    })
    if (!ok) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('activate_staff_invitation', { p_invitation: inv.id })
    if (error) { setBusy(false); return setErr(translateRpcError(error, 'تعذر التفعيل.')) }
    await sendDecisionEmail('decision')
    setBusy(false)
    onUpdate?.()
  }

  const canPrelim = inv.status === 'submitted'
  const canInterviewDone = inv.status === 'prelim_approved'
  const canFinal = ['prelim_approved','interview_done'].includes(inv.status)
  const canReject = ['submitted','prelim_approved','interview_done'].includes(inv.status)
  const canActivate = inv.status === 'onboarded'

  return (
    <div className="mlk-tab">
      <header className="mlk-tab-head">
        <h1 className="mlk-tab-title">مراجعة طلب توظيف</h1>
        <span className={`mlk-pill ${STATUS_TONE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
        <button className="mlk-action" onClick={onClose}>إغلاق</button>
      </header>

      {/* ملخص المتقدم */}
      <div className="mlk-card is-feature">
        <div className="mlk-list-meta" style={{ marginBottom: 6 }}>
          <span className={`mlk-pill ${inv.invited_role === 'admin' ? 'em' : 'info'}`}>
            دور مقترح: {ROLE_LABEL[inv.invited_role]}
          </span>
        </div>
        <div className="mlk-list-title" style={{ fontSize: 18 }}>{inv.applicant_full_name || '—'}</div>
        <div className="mlk-list-meta ltr" style={{ marginTop: 4 }}>{inv.email}</div>
        {inv.applicant_phone && <div className="mlk-list-meta ltr">{inv.applicant_phone}</div>}
        {inv.applicant_address && <div className="mlk-list-meta">{inv.applicant_address}</div>}
        {inv.national_id && <div className="mlk-list-meta ltr">هوية: {inv.national_id}</div>}
      </div>

      {/* الوثائق */}
      <section>
        <h2 className="mlk-h2">الوثائق</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {idUrl && <a href={idUrl} target="_blank" rel="noopener" className="mlk-action">الهوية الوطنية</a>}
          {cvUrl && <a href={cvUrl} target="_blank" rel="noopener" className="mlk-action">السيرة الذاتية</a>}
          {qualUrls.map((u, i) => u && (
            <a key={i} href={u} target="_blank" rel="noopener" className="mlk-action">شهادة {i + 1}</a>
          ))}
          {!idUrl && !cvUrl && <span className="mlk-list-meta">لا وثائق مرفوعة</span>}
        </div>
      </section>

      {inv.applicant_message && (
        <section>
          <h2 className="mlk-h2">رسالة المتقدم</h2>
          <div className="mlk-card" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 13.5 }}>
            {inv.applicant_message}
          </div>
        </section>
      )}

      {inv.interview_at && (
        <section>
          <h2 className="mlk-h2">المقابلة</h2>
          <div className="mlk-card is-feature">
            <div className="mlk-list-title">{fmtDateTime(inv.interview_at)}</div>
            {inv.interview_location && <div className="mlk-list-meta">{inv.interview_location}</div>}
            {inv.interview_notes && <div className="mlk-list-meta" style={{ marginTop: 6 }}>{inv.interview_notes}</div>}
          </div>
        </section>
      )}

      {inv.reject_reason && (
        <div className="alert err">
          <strong>سبب الرفض ({inv.rejection_stage}):</strong> {inv.reject_reason}
        </div>
      )}

      {err && <div className="alert err">{err}</div>}

      {/* نموذج الموافقة المبدئية */}
      {showPrelim && (
        <form onSubmit={doPrelim} className="mlk-card">
          <h2 className="mlk-h2">تحديد موعد مقابلة</h2>
          <div className="form">
            <div className="field">
              <label>تاريخ ووقت المقابلة</label>
              <input type="datetime-local" value={interviewAt} onChange={e => setInterviewAt(e.target.value)} required />
            </div>
            <div className="field">
              <label>الموقع <span className="muted">(عنوان أو رابط)</span></label>
              <input value={interviewLoc} onChange={e => setInterviewLoc(e.target.value)} />
            </div>
            <div className="field">
              <label>ملاحظات للمتقدم</label>
              <textarea rows={2} value={interviewNotes} onChange={e => setInterviewNotes(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" className="mlk-action primary" disabled={busy}>
                {busy ? <span className="spinner" /> : 'موافقة مبدئية + إرسال'}
              </button>
              <button type="button" className="mlk-action" onClick={() => setShowPrelim(false)}>إلغاء</button>
            </div>
          </div>
        </form>
      )}

      {/* نموذج القرار النهائي */}
      {showFinal && (
        <form onSubmit={doFinalApprove} className="mlk-card">
          <h2 className="mlk-h2">قرار نهائي</h2>
          <div className="form">
            <div className="field">
              <label>ملاحظات داخلية <span className="muted">(لا ترسل للمتقدم)</span></label>
              <textarea rows={3} value={finalNotes} onChange={e => setFinalNotes(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" className="mlk-action primary" disabled={busy}>
                {busy ? <span className="spinner" /> : 'قبول نهائي'}
              </button>
              <button type="button" className="mlk-action" onClick={() => setShowFinal(false)}>إلغاء</button>
            </div>
          </div>
        </form>
      )}

      {/* أزرار العمل */}
      {!showPrelim && !showFinal && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canPrelim && (
            <button className="mlk-action primary" onClick={() => setShowPrelim(true)} disabled={busy}>
              موافقة مبدئية + مقابلة
            </button>
          )}
          {canInterviewDone && (
            <button className="mlk-action" onClick={doInterviewDone} disabled={busy}>
              أنجزت المقابلة
            </button>
          )}
          {canFinal && (
            <button className="mlk-action primary" onClick={() => setShowFinal(true)} disabled={busy}>
              قبول نهائي
            </button>
          )}
          {canActivate && (
            <button className="mlk-action primary" onClick={doActivate} disabled={busy}>
              فعل الدور
            </button>
          )}
          {canReject && (
            <button className="mlk-action danger" onClick={doReject} disabled={busy}>رفض</button>
          )}
        </div>
      )}

      {/* خط زمني */}
      <section>
        <h2 className="mlk-h2">الخط الزمني</h2>
        <ul className="mlk-list">
          {inv.created_at && <li className="mlk-list-row"><span className="mlk-list-body"><span className="mlk-list-meta">الدعوة أرسلت</span></span><span className="mlk-list-time">{fmtDateTime(inv.created_at)}</span></li>}
          {inv.submitted_at && <li className="mlk-list-row"><span className="mlk-list-body"><span className="mlk-list-meta">الوثائق رفعت</span></span><span className="mlk-list-time">{fmtDateTime(inv.submitted_at)}</span></li>}
          {inv.prelim_reviewed_at && <li className="mlk-list-row"><span className="mlk-list-body"><span className="mlk-list-meta">موافقة مبدئية</span></span><span className="mlk-list-time">{fmtDateTime(inv.prelim_reviewed_at)}</span></li>}
          {inv.final_reviewed_at && <li className="mlk-list-row"><span className="mlk-list-body"><span className="mlk-list-meta">قرار نهائي</span></span><span className="mlk-list-time">{fmtDateTime(inv.final_reviewed_at)}</span></li>}
          {inv.onboarded_at && <li className="mlk-list-row"><span className="mlk-list-body"><span className="mlk-list-meta">نموذج التوظيف</span></span><span className="mlk-list-time">{fmtDateTime(inv.onboarded_at)}</span></li>}
          {inv.activated_at && <li className="mlk-list-row"><span className="mlk-list-body"><span className="mlk-list-meta">فعل</span></span><span className="mlk-list-time">{fmtDateTime(inv.activated_at)}</span></li>}
        </ul>
      </section>
    </div>
  )
}
