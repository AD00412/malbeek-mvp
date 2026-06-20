import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'
import { useUI } from '../lib/useUI'
import { useAuth } from '../app/useAuth'
import { fmtDateTime, isValidEmail } from '../lib/format'
import { translateRpcError } from '../lib/rpcErrors'
import InvitationReview from './InvitationReview'

const ROLE_LABEL = { admin: 'أدمن', support: 'دعم' }
const ROLE_HINT = {
  admin:   'صلاحيّةٌ كاملةٌ — كلُّ إجراءٍ متاح',
  support: 'قراءةٌ فقط + الردُّ على الرسائل',
}

const STATUS_LABEL = {
  pending:            'بانتظار التسجيل',
  submitted:          'مراجعةُ الوَثائق',
  prelim_approved:    'مَوافقةٌ مَبدئيّة — مقابلة',
  interview_done:     'انتهت المقابلة',
  final_approved:     'بانتظار نموذج التَّوظيف',
  onboarded:          'بانتظار التَّفعيل',
  active:             'مُفعَّل',
  rejected_documents: 'رُفض (وَثائق)',
  rejected_interview: 'رُفض (مقابلة)',
  expired:            'منتهية',
  cancelled:          'ملغاة',
}
const STATUS_TONE = {
  pending: 'warn', submitted: 'info', prelim_approved: 'info', interview_done: 'warn',
  final_approved: 'ok', onboarded: 'warn', active: 'ok',
  rejected_documents: 'danger', rejected_interview: 'danger',
  expired: 'muted', cancelled: 'muted',
}
const REVIEW_STATES = new Set(['submitted','prelim_approved','interview_done','final_approved','onboarded'])

/**
 * إدارةُ فريق ملبّيك:
 *  ١) قائمةُ الفريق الحاليّ (admin + support).
 *  ٢) دعواتٌ معلَّقةٌ — submitted: راجعها الأدمن.
 *  ٣) دعوةٌ جديدة: إيميل + دور → يُرسل بريدٌ بآليّة دعوةٍ كاملةٍ.
 */
export default function TeamManagement() {
  const { profile, role } = useAuth()
  const isAdmin = role === 'admin'

  // staff
  const [staff, setStaff] = useState([])
  const [loadingStaff, setLoadingStaff] = useState(true)
  // invitations
  const [invites, setInvites] = useState([])
  const [loadingInv, setLoadingInv] = useState(true)
  const [tab, setTab] = useState('staff') // staff | submitted | sent

  const [busyId, setBusyId] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [reviewing, setReviewing] = useState(null) // invitation object

  // form
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState('support')
  const [sending, setSending] = useState(false)

  const { confirm } = useUI()

  const loadStaff = useCallback(async () => {
    setLoadingStaff(true)
    const { data, error } = await supabase.rpc('platform_list_staff')
    if (error) setErr('تعذّر تحميلُ الفريق: ' + (error.message || ''))
    else setStaff(data ?? [])
    setLoadingStaff(false)
  }, [])

  const loadInvites = useCallback(async () => {
    setLoadingInv(true)
    const { data, error } = await supabase.rpc('list_staff_invitations', { p_filter: 'all' })
    if (error) setErr('تعذّر تحميلُ الدعوات: ' + (error.message || ''))
    else setInvites(data ?? [])
    setLoadingInv(false)
  }, [])

  useEffect(() => { loadStaff(); loadInvites() }, [loadStaff, loadInvites])

  function flash(setter, msg, ms = 3500) {
    setter(msg)
    setTimeout(() => setter(''), ms)
  }

  async function sendInvitation(e) {
    e?.preventDefault?.()
    setErr(''); setOk('')
    if (!isValidEmail(addEmail)) { setErr('بريدٌ غير صحيح'); return }
    setSending(true)
    const { data, error } = await supabase.rpc('create_staff_invitation', {
      p_email: addEmail.trim().toLowerCase(),
      p_role: addRole,
    })
    if (error) {
      setSending(false)
      setErr(translateRpcError(error, 'تعذّر إنشاءُ الدعوة.'))
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    const invitationId = row?.out_invitation_id ?? row?.invitation_id
    // ابعث البريد
    try {
      const { data: send, error: sErr } = await supabase.functions.invoke('send-staff-invite', {
        body: { invitation_id: invitationId },
      })
      if (sErr) throw sErr
      if (!send?.ok) throw new Error(send?.error || 'unknown')
      flash(setOk, `أُرسلت الدعوةُ إلى ${addEmail} ✓`)
      setAddEmail('')
    } catch (e2) {
      setErr('أُنشئت الدعوة لكن تعذّر إرسالُ البريد: ' + (e2?.message || e2))
    }
    setSending(false)
    loadInvites()
  }

  async function cancelInv(inv) {
    const ok2 = await confirm({
      title: 'إلغاءُ دعوة',
      message: `إلغاءُ الدعوةِ المُرسَلة لـ ${inv.email}؟`,
      confirmText: 'إلغاء الدعوة', cancelText: 'احتفظ', danger: true,
    })
    if (!ok2) return
    setBusyId(inv.id)
    const { error } = await supabase.rpc('cancel_staff_invitation', { p_invitation: inv.id })
    setBusyId('')
    if (error) { setErr(translateRpcError(error, 'تعذّر الإلغاء.')); return }
    flash(setOk, 'أُلغيت الدعوة')
    loadInvites()
  }

  async function removeMember(s) {
    if (s.profile_id === profile?.id) {
      setErr('لا يَجوز نَزعُ صلاحيّاتِك بنفسك — اطلب من أدمنٍ آخرَ ذلك.')
      return
    }
    const ok2 = await confirm({
      title: 'نَزعُ صلاحيّاتٍ',
      message: `إزالةُ ${s.full_name || s.email} من فريق ملبّيك؟ سيَعود مستخدمًا عاديًّا.`,
      confirmText: 'نَزع', cancelText: 'إلغاء', danger: true,
    })
    if (!ok2) return
    setBusyId(s.profile_id)
    const { error } = await supabase.rpc('platform_revoke_role', { p_profile: s.profile_id })
    setBusyId('')
    if (error) { setErr(translateRpcError(error, 'تعذّر النَّزع.')); return }
    flash(setOk, 'تمّ النَّزع ✓')
    loadStaff()
  }

  const pendingReview = invites.filter(i => REVIEW_STATES.has(i.status))
  const sent = invites.filter(i => !REVIEW_STATES.has(i.status))

  return (
    <div className="mlk-tab">
      <header className="mlk-tab-head">
        <h1 className="mlk-tab-title">فريق ملبّيك</h1>
        <span className="mlk-tab-count">{staff.length} عضو</span>
        <button className="mlk-action" onClick={() => { loadStaff(); loadInvites() }}
                disabled={loadingStaff || loadingInv}>
          {(loadingStaff || loadingInv) ? <span className="spinner" /> : <Icon name="refresh" size={13} />}
          تحديث
        </button>
      </header>

      <div className="mlk-filter">
        <button className={`mlk-fchip ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>
          الفريق ({staff.length})
        </button>
        <button className={`mlk-fchip ${tab === 'submitted' ? 'active' : ''}`} onClick={() => { setTab('submitted'); setReviewing(null) }}>
          طلباتُ التَّوظيف{pendingReview.length > 0 ? ` (${pendingReview.length})` : ''}
        </button>
        <button className={`mlk-fchip ${tab === 'sent' ? 'active' : ''}`} onClick={() => setTab('sent')}>
          الدعوات ({sent.length})
        </button>
      </div>

      {err && <div className="alert err">{err}</div>}
      {ok  && <div className="alert ok">{ok}</div>}

      {/* نموذجُ إرسال دعوةٍ جديدة — Admin فقط */}
      {isAdmin && tab !== 'staff' && (
        <form onSubmit={sendInvitation} className="mlk-card is-feature">
          <h2 className="mlk-h2">إرسالُ دعوةٍ جديدة</h2>
          <div className="form">
            <div className="grid-2">
              <div className="field ltr">
                <label>البريد</label>
                <input type="email" placeholder="staff@example.com" value={addEmail}
                       onChange={(e) => setAddEmail(e.target.value)} required />
              </div>
              <div className="field">
                <label>الدور المقترح</label>
                <select value={addRole} onChange={(e) => setAddRole(e.target.value)}>
                  <option value="support">دعم — قراءةٌ والردُّ على الرسائل</option>
                  <option value="admin">أدمن — صلاحيّةٌ كاملة</option>
                </select>
              </div>
            </div>
            <button className="mlk-action primary" type="submit" disabled={sending || !addEmail}
                    style={{ marginTop: 12 }}>
              {sending ? <span className="spinner" /> : 'أرسل الدعوة'}
            </button>
          </div>
        </form>
      )}

      {/* تبويب: الفريق */}
      {tab === 'staff' && (
        loadingStaff ? <SkeletonList count={3} /> :
        staff.length === 0 ? <div className="mlk-empty">لا يَوجد فريقٌ بعد</div> :
        <ul className="mlk-list">
          {staff.map((s) => {
            const isMe = s.profile_id === profile?.id
            return (
              <li key={s.profile_id} className="mlk-list-row">
                <div className="mlk-list-body">
                  <div className="mlk-list-meta">
                    <span className={`mlk-pill ${s.role === 'admin' ? 'em' : 'info'}`}>{ROLE_LABEL[s.role]}</span>
                    {isMe && <span className="mlk-pill muted">أنت</span>}
                  </div>
                  <div className="mlk-list-title">{s.full_name || '—'}</div>
                  <div className="mlk-list-meta ltr">{s.email}</div>
                </div>
                {isAdmin && !isMe && (
                  <button className="mlk-action danger" onClick={() => removeMember(s)}
                          disabled={busyId === s.profile_id}>
                    نَزع
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* تبويب: للمراجعة */}
      {tab === 'submitted' && !reviewing && (
        loadingInv ? <SkeletonList count={2} /> :
        pendingReview.length === 0 ? <div className="mlk-empty">لا توجد طلباتُ توظيفٍ نَشِطة</div> :
        <ul className="mlk-list">
          {pendingReview.map(inv => (
            <li key={inv.id}>
              <button type="button" className="mlk-list-row is-button" onClick={() => setReviewing(inv)}>
                <div className="mlk-list-body">
                  <div className="mlk-list-meta">
                    <span className={`mlk-pill ${STATUS_TONE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
                    <span className={`mlk-pill ${inv.invited_role === 'admin' ? 'em' : 'info'}`}>{ROLE_LABEL[inv.invited_role]}</span>
                  </div>
                  <div className="mlk-list-title">{inv.applicant_full_name || inv.email}</div>
                  <div className="mlk-list-meta">
                    {inv.applicant_phone && <span className="ltr">{inv.applicant_phone}</span>}
                    {inv.interview_at && inv.status === 'prelim_approved' && (
                      <span>مقابلة: {fmtDateTime(inv.interview_at)}</span>
                    )}
                  </div>
                </div>
                <span className="mlk-list-time">←</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* لوحةُ المراجعة التَّفصيليّة */}
      {tab === 'submitted' && reviewing && (
        <InvitationReview
          invitation={reviewing}
          onClose={() => setReviewing(null)}
          onUpdate={() => { setReviewing(null); loadInvites(); loadStaff(); flash(setOk, 'تمّ التَّحديث ✓') }}
        />
      )}

      {/* تبويب: كلّ الدعوات المُرسَلة */}
      {tab === 'sent' && (
        loadingInv ? <SkeletonList count={2} /> :
        sent.length === 0 ? <div className="mlk-empty">لا توجد دعوات</div> :
        <ul className="mlk-list">
          {sent.map(inv => (
            <li key={inv.id} className="mlk-list-row">
              <div className="mlk-list-body">
                <div className="mlk-list-meta">
                  <span className={`mlk-pill ${STATUS_TONE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
                  <span>·</span>
                  <span>{ROLE_LABEL[inv.invited_role]}</span>
                  <span className="mlk-list-time" style={{ marginInlineStart: 'auto' }}>{fmtDateTime(inv.created_at)}</span>
                </div>
                <div className="mlk-list-title ltr">{inv.email}</div>
                {inv.reject_reason && (
                  <div className="mlk-list-meta">سببُ الرفض: {inv.reject_reason}</div>
                )}
              </div>
              {isAdmin && inv.status === 'pending' && (
                <button className="mlk-action danger" onClick={() => cancelInv(inv)}
                        disabled={busyId === inv.id}>إلغاء</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
