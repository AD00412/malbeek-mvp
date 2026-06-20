import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { useUI } from '../lib/useUI'
import { fmtDateTime } from '../lib/format'
import { translateRpcError } from '../lib/rpcErrors'

const STATUS_LABEL = {
  pending: 'بانتظار التسجيل',
  submitted: 'بانتظار مراجعة الوَثائق',
  prelim_approved: 'مَوافقةٌ مَبدئيّة — مَوعدُ مقابلة',
  interview_done: 'انتهت المقابلة — قَرارٌ نهائيّ',
  final_approved: 'قَبولٌ نهائيّ — بانتظار نموذج التَّوظيف',
  onboarded: 'أَكمل النموذج — بانتظار التَّفعيل',
  active: 'مُفعَّل',
  rejected_documents: 'رُفض في مرحلة الوَثائق',
  rejected_interview: 'رُفض بعد المقابلة',
  expired: 'منتهية',
  cancelled: 'ملغاة',
}
const STATUS_TONE = {
  pending: 'gold', submitted: 'info', prelim_approved: 'info', interview_done: 'gold',
  final_approved: 'ok', onboarded: 'gold', active: 'ok',
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
 * شاشةُ مراجعةٍ تَفصيليّةٍ لطلب توظيف.
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
    // kind = 'interview' | 'decision' — يُستدعى بعد كلّ انتقال
    try {
      await supabase.functions.invoke(
        kind === 'interview' ? 'send-staff-interview' : 'send-staff-decision',
        { body: { invitation_id: inv.id } },
      )
    } catch { /* الإيميل تَلقائيٌّ — لا نُجبر فشلَه على الفشل العامّ */ }
  }

  async function doPrelim(e) {
    e.preventDefault()
    if (!interviewAt) return setErr('حدّد موعد المقابلة.')
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('preliminary_approve_invitation', {
      p_invitation: inv.id,
      p_interview_at: new Date(interviewAt).toISOString(),
      p_location: interviewLoc.trim() || null,
      p_notes: interviewNotes.trim() || null,
    })
    if (error) { setBusy(false); return setErr(translateRpcError(error, 'تعذّرت الموافقة المبدئيّة.')) }
    await sendDecisionEmail('interview')
    setBusy(false); setShowPrelim(false)
    onUpdate?.()
  }

  async function doInterviewDone() {
    const ok = await confirm({
      title: 'تَأكيدُ انتهاء المقابلة',
      message: 'هل أَجريتَ المقابلةَ مع المتقدّم؟',
      confirmText: 'نعم، انتهت', cancelText: 'لاحقًا',
    })
    if (!ok) return
    setBusy(true)
    const { error } = await supabase.rpc('mark_interview_done', { p_invitation: inv.id })
    setBusy(false)
    if (error) return setErr(translateRpcError(error, 'تعذّر التَّحديث.'))
    onUpdate?.()
  }

  async function doFinalApprove(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('final_approve_invitation', {
      p_invitation: inv.id,
      p_notes: finalNotes.trim() || null,
    })
    if (error) { setBusy(false); return setErr(translateRpcError(error, 'تعذّر القبول النهائيّ.')) }
    await sendDecisionEmail('decision')
    setBusy(false); setShowFinal(false)
    onUpdate?.()
  }

  async function doReject() {
    const reason = window.prompt('سببُ الرفض (٥ أحرفٍ فأكثر) — سيُسجَّل في الـaudit:')
    if (!reason || reason.trim().length < 5) return
    const ok = await confirm({
      title: 'رفضُ الطلب',
      message: `تأكيدُ الرفض في مرحلة «${inv.status === 'submitted' ? 'الوَثائق' : 'المقابلة'}»؟`,
      confirmText: 'تأكيد الرفض', cancelText: 'إلغاء', danger: true,
    })
    if (!ok) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('reject_staff_invitation', {
      p_invitation: inv.id, p_reason: reason.trim(),
    })
    if (error) { setBusy(false); return setErr(translateRpcError(error, 'تعذّر الرفض.')) }
    await sendDecisionEmail('decision')
    setBusy(false)
    onUpdate?.()
  }

  async function doActivate() {
    const ok = await confirm({
      title: 'تَفعيلٌ نهائيّ',
      message: `سيُسنَد دور «${ROLE_LABEL[inv.invited_role]}» لـ${inv.applicant_full_name} ويُمكنه الدخول لـ/admin فورًا. تأكيد؟`,
      confirmText: 'فعِّل الدور', cancelText: 'إلغاء',
    })
    if (!ok) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('activate_staff_invitation', { p_invitation: inv.id })
    setBusy(false)
    if (error) return setErr(translateRpcError(error, 'تعذّر التَّفعيل.'))
    onUpdate?.()
  }

  const canPrelim = inv.status === 'submitted'
  const canInterviewDone = inv.status === 'prelim_approved'
  const canFinal = ['prelim_approved','interview_done'].includes(inv.status)
  const canReject = ['submitted','prelim_approved','interview_done'].includes(inv.status)
  const canActivate = inv.status === 'onboarded'

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="panel-head">
        <h3>مراجعةُ طلب توظيف</h3>
        <span className={`tag ${STATUS_TONE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>

      {/* ملخّصُ المتقدّم */}
      <div className="trip-card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{inv.applicant_full_name || '—'}</div>
        <div className="muted ltr" style={{ fontSize: 13 }}>{inv.email}</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>📞 {inv.applicant_phone || '—'}</div>
        {inv.applicant_address && <div style={{ fontSize: 13 }}>📍 {inv.applicant_address}</div>}
        {inv.national_id && <div style={{ fontSize: 13, marginTop: 4 }}>🆔 {inv.national_id}</div>}
        <div style={{ marginTop: 8 }}>
          <span className={`tag ${inv.invited_role === 'admin' ? 'gold' : 'info'}`}>
            دور مُقترح: {ROLE_LABEL[inv.invited_role]}
          </span>
        </div>
      </div>

      {/* الوَثائق */}
      <div className="sec-label">الوَثائق</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {idUrl && <a href={idUrl} target="_blank" rel="noopener" className="btn btn-sm">
          <Icon name="file-text" size={14} /> الهويّة الوطنيّة
        </a>}
        {cvUrl && <a href={cvUrl} target="_blank" rel="noopener" className="btn btn-sm">
          <Icon name="file-text" size={14} /> السيرة الذاتيّة
        </a>}
        {qualUrls.map((u, i) => u && (
          <a key={i} href={u} target="_blank" rel="noopener" className="btn btn-sm">
            <Icon name="file-text" size={14} /> شهادة {i + 1}
          </a>
        ))}
        {!idUrl && !cvUrl && <span className="muted">لا وَثائق مرفوعة</span>}
      </div>

      {/* رسالةٌ تَعريفيّة */}
      {inv.applicant_message && (
        <>
          <div className="sec-label">رسالةُ المتقدّم</div>
          <div style={{ padding: 12, background: 'var(--bg-2)', borderRadius: 8, fontSize: 13.5,
                        whiteSpace: 'pre-wrap', lineHeight: 1.7, marginBottom: 14 }}>
            {inv.applicant_message}
          </div>
        </>
      )}

      {/* المقابلة */}
      {inv.interview_at && (
        <>
          <div className="sec-label">المقابلة</div>
          <div className="alert" style={{ background: 'var(--info-bg)', color: 'var(--info-ink)', marginBottom: 14 }}>
            <div>🗓 {fmtDateTime(inv.interview_at)}</div>
            {inv.interview_location && <div style={{ marginTop: 4 }}>📍 {inv.interview_location}</div>}
            {inv.interview_notes && <div className="muted" style={{ marginTop: 4 }}>{inv.interview_notes}</div>}
          </div>
        </>
      )}

      {/* قراراتٌ سابقة */}
      {inv.reject_reason && (
        <div className="alert err" style={{ marginBottom: 14 }}>
          <strong>سببُ الرفض ({inv.rejection_stage}):</strong> {inv.reject_reason}
        </div>
      )}

      {err && <div className="alert err" style={{ marginBottom: 10 }}>{err}</div>}

      {/* نموذجُ المُوافقةُ المَبدئيّة */}
      {showPrelim && (
        <form onSubmit={doPrelim} className="form"
              style={{ padding: 14, background: 'var(--bg-2)', borderRadius: 10, marginBottom: 12 }}>
          <div className="sec-label" style={{ marginTop: 0 }}>تَحديدُ مَوعد مقابلة</div>
          <div className="field">
            <label>تاريخُ ووقت المقابلة</label>
            <input type="datetime-local" value={interviewAt} onChange={e => setInterviewAt(e.target.value)} required />
          </div>
          <div className="field">
            <label>الموقع <span className="muted">(عنوان أو رابطُ Zoom/Meet)</span></label>
            <input value={interviewLoc} onChange={e => setInterviewLoc(e.target.value)} />
          </div>
          <div className="field">
            <label>ملاحظاتٌ للمتقدّم <span className="muted">(تَجهيزات، وَثائق إضافيّة...)</span></label>
            <textarea rows={2} value={interviewNotes} onChange={e => setInterviewNotes(e.target.value)} />
          </div>
          <div className="actions-row">
            <button type="submit" className="btn btn-em btn-sm" disabled={busy}>
              {busy ? <span className="spinner" /> : 'مَوافقةٌ مَبدئيّةٌ + إرسال'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setShowPrelim(false)}>إلغاء</button>
          </div>
        </form>
      )}

      {/* نموذجُ القرار النهائيّ */}
      {showFinal && (
        <form onSubmit={doFinalApprove} className="form"
              style={{ padding: 14, background: 'var(--bg-2)', borderRadius: 10, marginBottom: 12 }}>
          <div className="sec-label" style={{ marginTop: 0 }}>قرارٌ نهائيّ</div>
          <div className="field">
            <label>ملاحظاتٌ داخليّة <span className="muted">(لا تُرسَل للمتقدّم)</span></label>
            <textarea rows={3} value={finalNotes} onChange={e => setFinalNotes(e.target.value)} />
          </div>
          <div className="actions-row">
            <button type="submit" className="btn btn-em btn-sm" disabled={busy}>
              {busy ? <span className="spinner" /> : 'قَبولٌ نهائيٌّ — افتح نموذج التَّوظيف'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setShowFinal(false)}>إلغاء</button>
          </div>
        </form>
      )}

      {/* أزرارُ العمل */}
      {!showPrelim && !showFinal && (
        <div className="actions-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          {canPrelim && (
            <button className="btn btn-em btn-sm" onClick={() => setShowPrelim(true)} disabled={busy}>
              <Icon name="check" size={14} /> مَوافقةٌ مَبدئيّة + مقابلة
            </button>
          )}
          {canInterviewDone && (
            <button className="btn btn-sm" onClick={doInterviewDone} disabled={busy}>
              <Icon name="check" size={14} /> أَنجزتُ المقابلة
            </button>
          )}
          {canFinal && (
            <button className="btn btn-em btn-sm" onClick={() => setShowFinal(true)} disabled={busy}>
              <Icon name="check" size={14} /> قَبولٌ نهائيّ
            </button>
          )}
          {canActivate && (
            <button className="btn btn-em btn-sm" onClick={doActivate} disabled={busy}>
              <Icon name="sparkle" size={14} /> فعِّل الدور
            </button>
          )}
          {canReject && (
            <button className="icon-btn" onClick={doReject} disabled={busy}
                    style={{ color: 'var(--danger-ink)' }}>
              <Icon name="x" size={14} /> رفض
            </button>
          )}
        </div>
      )}

      {/* خطّ زمنيّ */}
      <div className="sec-label" style={{ marginTop: 16 }}>الخطّ الزمنيّ</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
        {inv.created_at        && <div>• الدعوة أُرسلت: {fmtDateTime(inv.created_at)}</div>}
        {inv.submitted_at      && <div>• الوَثائق رُفعت: {fmtDateTime(inv.submitted_at)}</div>}
        {inv.prelim_reviewed_at&& <div>• مُوافقةٌ مَبدئيّة: {fmtDateTime(inv.prelim_reviewed_at)}</div>}
        {inv.final_reviewed_at && <div>• قَرارٌ نهائيّ: {fmtDateTime(inv.final_reviewed_at)}</div>}
        {inv.onboarded_at      && <div>• نموذجُ التَّوظيف: {fmtDateTime(inv.onboarded_at)}</div>}
        {inv.activated_at      && <div>• فُعِّل: {fmtDateTime(inv.activated_at)}</div>}
      </div>
    </div>
  )
}
