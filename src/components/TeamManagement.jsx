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
  pending: 'gold', submitted: 'info', prelim_approved: 'info', interview_done: 'gold',
  final_approved: 'ok', onboarded: 'gold', active: 'ok',
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
    const invitationId = row?.invitation_id
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
    <section className="panel">
      <div className="panel-head">
        <h3>فريق ملبّيك</h3>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={() => { loadStaff(); loadInvites() }}
                disabled={loadingStaff || loadingInv}>
          {(loadingStaff || loadingInv) ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
          تحديث
        </button>
      </div>

      {/* تبويباتٌ مع شارة عدد المراجعة */}
      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>
          الفريق ({staff.length})
        </button>
        <button className={`chip ${tab === 'submitted' ? 'active' : ''}`} onClick={() => { setTab('submitted'); setReviewing(null) }}>
          طلباتُ التَّوظيف
          {pendingReview.length > 0 && <span className="tag gold" style={{ marginInlineStart: 6, fontSize: 10, padding: '1px 7px' }}>{pendingReview.length}</span>}
        </button>
        <button className={`chip ${tab === 'sent' ? 'active' : ''}`} onClick={() => setTab('sent')}>
          الدعوات ({sent.length})
        </button>
      </div>

      {err && <div className="alert err" style={{ marginBottom: 10 }}>{err}</div>}
      {ok  && <div className="alert ok"  style={{ marginBottom: 10 }}>{ok}</div>}

      {/* نموذج إرسال دعوةٍ جديدة — Admin فقط */}
      {isAdmin && tab !== 'staff' && (
        <form onSubmit={sendInvitation} className="form"
              style={{ marginBottom: 14, padding: 14, background: 'var(--bg-2)', borderRadius: 12 }}>
          <div className="sec-label" style={{ marginTop: 0 }}>
            <Icon name="mail" size={14} /> إرسالُ دعوةٍ جديدة
          </div>
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
          <div className="actions-row">
            <button className="btn btn-em btn-sm" type="submit" disabled={sending || !addEmail}>
              {sending ? <span className="spinner" /> : <><Icon name="send" size={14} /> أرسل الدعوة</>}
            </button>
          </div>
          <span className="hint" style={{ marginTop: 8, display: 'block' }}>
            سيَستلم البريدُ رابطَ دعوةٍ شخصيًّا، يَملأ فيه بياناتِه، ثمّ تُراجعها الإدارة.
          </span>
        </form>
      )}

      {/* تبويب: الفريق */}
      {tab === 'staff' && (
        loadingStaff ? <SkeletonList count={3} /> :
        staff.length === 0 ? <div className="empty"><div className="em-ttl">لا يَوجد فريقٌ بعد</div></div> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {staff.map((s) => {
            const isMe = s.profile_id === profile?.id
            return (
              <div key={s.profile_id} className="trip-card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%',
                    background: s.role === 'admin' ? 'var(--grad-gold)' : 'rgba(58,160,179,.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: s.role === 'admin' ? 'var(--em-950)' : 'var(--info-ink)', fontWeight: 800 }}>
                    {(s.full_name || s.email || '?').charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--cr-50)' }}>
                      {s.full_name || '—'}
                      {isMe && <span className="tag muted" style={{ fontSize: 9, marginInlineStart: 6 }}>أنت</span>}
                    </div>
                    <div className="muted ltr" style={{ fontSize: 12 }}>{s.email}</div>
                  </div>
                  <span className={`tag ${s.role === 'admin' ? 'gold' : 'info'}`}>{ROLE_LABEL[s.role]}</span>
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{ROLE_HINT[s.role]}</div>
                {isAdmin && !isMe && (
                  <div className="actions-row" style={{ marginTop: 10 }}>
                    <button className="icon-btn" onClick={() => removeMember(s)}
                            disabled={busyId === s.profile_id}
                            style={{ color: 'var(--danger-ink)' }}>
                      <Icon name="trash" size={14} /> نَزع
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* تبويب: للمراجعة — قائمةٌ مختصرة، النقر يَفتح المراجعةَ التَّفصيليّة */}
      {tab === 'submitted' && !reviewing && (
        loadingInv ? <SkeletonList count={2} /> :
        pendingReview.length === 0 ? <div className="empty"><div className="em-ttl">لا توجد طلباتُ توظيفٍ نَشِطة</div></div> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pendingReview.map(inv => (
            <button key={inv.id} className="trip-card"
                    onClick={() => setReviewing(inv)}
                    style={{ padding: 12, textAlign: 'inherit', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <strong style={{ flex: 1 }}>{inv.applicant_full_name || '—'}</strong>
                <span className={`tag ${STATUS_TONE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
                <span className={`tag ${inv.invited_role === 'admin' ? 'gold' : 'info'}`}>
                  {ROLE_LABEL[inv.invited_role]}
                </span>
              </div>
              <div className="muted ltr" style={{ fontSize: 12 }}>{inv.email}</div>
              {inv.applicant_phone && (
                <div className="ltr" style={{ fontSize: 13, marginTop: 4 }}>📞 {inv.applicant_phone}</div>
              )}
              {inv.interview_at && inv.status === 'prelim_approved' && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  🗓 مقابلة: {fmtDateTime(inv.interview_at)}
                </div>
              )}
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                {inv.onboarded_at ? `مَلأ النموذج: ${fmtDateTime(inv.onboarded_at)}`
                  : inv.submitted_at ? `رُفع: ${fmtDateTime(inv.submitted_at)}`
                  : `أُرسل: ${fmtDateTime(inv.created_at)}`}
                <span style={{ marginInlineStart: 8 }}>← اضغط للمراجعة</span>
              </div>
            </button>
          ))}
        </div>
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
        sent.length === 0 ? <div className="empty"><div className="em-ttl">لا توجد دعوات</div></div> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sent.map(inv => (
            <div key={inv.id} className="trip-card" style={{ padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ltr" style={{ fontWeight: 600, fontSize: 13 }}>{inv.email}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {fmtDateTime(inv.created_at)} · {ROLE_LABEL[inv.invited_role]}
                  </div>
                </div>
                <span className={`tag ${STATUS_TONE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
              </div>
              {inv.reject_reason && (
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  سببُ الرفض: {inv.reject_reason}
                </div>
              )}
              {isAdmin && inv.status === 'pending' && (
                <div className="actions-row" style={{ marginTop: 8 }}>
                  <button className="icon-btn" onClick={() => cancelInv(inv)}
                          disabled={busyId === inv.id}
                          style={{ color: 'var(--danger-ink)' }}>
                    <Icon name="x" size={14} /> إلغاء الدعوة
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
