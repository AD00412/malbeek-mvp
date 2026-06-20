import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import { translateRpcError } from '../../lib/rpcErrors'
import { cleanName } from '../../lib/format'
import AuthShell from './AuthShell'
import Icon from '../../components/Icon'
import { ScreenLoader } from '../../app/RequireAuth'

const ROLE_AR = {
  admin:   'أدمن — صلاحيّةٌ كاملة',
  support: 'دعم — قراءةٌ والردُّ على الرسائل',
}

const STATUS_MSG = {
  not_found:  'لم نَجد هذه الدعوة. ربّما الرابطُ خاطئٌ أو ألغاها الأدمن.',
  submitted:  'رفعتَ بياناتِك من قبل. الإدارة تُراجعها الآن.',
  approved:   'وُوفق على دعوتك — سجّل دخولَك للوصول لِلوحة الفريق.',
  rejected:   'اعتُذر عن قبول هذه الدعوة.',
  expired:    'انتهت صلاحيّةُ الدعوة. اطلب من الأدمن دعوةً جديدة.',
  cancelled:  'أُلغيت هذه الدعوة.',
}

/**
 * صفحةُ قبول دعوةٍ لفريق ملبّيك (admin/support).
 * - تَستعمل token عامًّا للقراءة عبر get_invitation_info.
 * - تَطلب تَسجيل الدخول/التسجيل بإيميل الدعوة نفسه.
 * - بعد رفع البيانات، تَنتظر مراجعةَ الأدمن (status = submitted).
 */
export default function AcceptInvite() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { session, user } = useAuth()

  const [resolving, setResolving] = useState(true)
  const [info, setInfo] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')

  // form
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await supabase
        .rpc('get_invitation_info', { p_token: token })
      if (!active) return
      if (error) {
        setStatusMsg('تعذّر التحقّقُ من الدعوة. جرّب لاحقًا.')
        setResolving(false)
        return
      }
      const row = Array.isArray(data) ? data[0] : data
      if (!row || row.status === 'not_found') {
        setStatusMsg(STATUS_MSG.not_found)
      } else {
        setInfo(row)
        if (row.status !== 'pending') {
          setStatusMsg(STATUS_MSG[row.status] || '')
        } else if (!row.is_valid) {
          setStatusMsg(STATUS_MSG.expired)
        }
      }
      setResolving(false)
    })()
    return () => { active = false }
  }, [token])

  const matchesEmail = !!(session && user?.email && info?.email &&
    user.email.toLowerCase() === info.email.toLowerCase())

  async function signUpAndPrep(e) {
    e.preventDefault()
    if (busy) return
    if (cleanName(fullName).split(/\s+/).filter(Boolean).length < 2) {
      setErr('اكتب اسمَك الكامل (الاسم الأول + الأخير على الأقلّ).')
      return
    }
    if (password.length < 8) { setErr('كلمةُ المرور ٨ أحرفٍ على الأقلّ.'); return }
    setErr(''); setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: info.email,
      password,
      options: { data: { role: 'subscriber', full_name: cleanName(fullName) } },
    })
    if (error) {
      setBusy(false)
      if (/already registered|already been registered/i.test(error.message)) {
        setErr('هذا البريد مسجَّلٌ — سجّل دخولك بنفس البريد ثمّ ارجع لهذه الصفحة.')
      } else setErr(translateRpcError(error, 'تعذّر إنشاءُ الحساب.'))
      return
    }
    if (!data.session) {
      setBusy(false)
      setErr('أنشأنا حسابَك. فعّل بريدَك ثمّ ارجع لهذا الرابط لإكمال الدعوة.')
      return
    }
    setBusy(false)
    // الجلسة جاهزة — انتظر تَجديد user ثمّ يُعرَض النموذج (matchesEmail = true)
  }

  async function submitInvitation(e) {
    e.preventDefault()
    if (busy) return
    if (cleanName(fullName).split(/\s+/).filter(Boolean).length < 2) {
      setErr('اكتب اسمَك الكامل.')
      return
    }
    if (phone.replace(/\D/g,'').length < 8) { setErr('رقمُ جوّالٍ غير صحيح.'); return }
    setErr(''); setBusy(true)
    const { error } = await supabase.rpc('submit_staff_invitation', {
      p_token: token,
      p_full_name: cleanName(fullName),
      p_phone: phone.trim(),
      p_message: message.trim() || null,
    })
    setBusy(false)
    if (error) {
      setErr(translateRpcError(error, 'تعذّر إرسالُ البيانات.'))
      return
    }
    setDone(true)
  }

  if (resolving) return <ScreenLoader label="نتحقّق من الدعوة…" />

  // حالاتُ الدعوة غير القابلة للمتابعة
  if (statusMsg && !info) {
    return (
      <AuthShell title="دعوةٌ غير صالحة" sub={statusMsg}
        footer={<Link to="/">العودةُ للرئيسيّة</Link>} />
    )
  }
  if (info && info.status !== 'pending') {
    return (
      <AuthShell title="حالةُ الدعوة" sub={statusMsg}
        footer={
          info.status === 'approved'
            ? <Link to="/login">تَسجيلُ الدخول →</Link>
            : <Link to="/">العودةُ للرئيسيّة</Link>
        } />
    )
  }
  if (info && !info.is_valid) {
    return <AuthShell title="انتهت الصلاحيّة" sub={STATUS_MSG.expired}
      footer={<Link to="/">العودةُ للرئيسيّة</Link>} />
  }

  if (done) {
    return (
      <AuthShell
        title="استلمنا بياناتِك ✓"
        sub="ستُراجعها الإدارةُ وستَصلك رسالةٌ بنتيجة المراجعة."
        footer={<Link to="/">العودةُ للرئيسيّة</Link>}
      />
    )
  }

  // ١) لا جلسة → ادعُ للدخول/التسجيل بإيميل الدعوة
  if (!session) {
    return (
      <AuthShell
        title="دعوةٌ للانضمام لفريق ملبّيك"
        sub={`بصفة: ${ROLE_AR[info.invited_role] || info.invited_role}`}
      >
        <div className="alert" style={{ marginBottom: 12, background: 'var(--info-bg)', color: 'var(--info-ink)' }}>
          <strong>الإيميلُ المدعو:</strong> <span className="ltr">{info.email}</span>
        </div>
        <form onSubmit={signUpAndPrep} className="form">
          <div className="field">
            <label>الاسمُ الكامل</label>
            <input value={fullName} onChange={e => setFullName(e.target.value)}
                   placeholder="الاسم الأول + الأخير" required />
          </div>
          <div className="field">
            <label>كلمةُ مرور</label>
            <div className="input-with-action">
              <input type={showPw ? 'text' : 'password'}
                     value={password} onChange={e => setPassword(e.target.value)}
                     minLength={8} required />
              <button type="button" className="input-action"
                      onClick={() => setShowPw(s => !s)}>
                {showPw ? 'إخفاء' : 'إظهار'}
              </button>
            </div>
          </div>
          {err && <div className="alert err">{err}</div>}
          <button className="btn btn-em" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : 'إنشاءُ حسابٍ والمتابعة'}
          </button>
          <div className="auth-footer-text" style={{ marginTop: 12 }}>
            لديك حسابٌ مسبقٌ بهذا الإيميل؟ <Link to={`/login?next=/invite/${token}`}>سجّل دخولك</Link>
          </div>
        </form>
      </AuthShell>
    )
  }

  // ٢) جلسةٌ موجودةٌ لكنّها بإيميلٍ مختلفٍ
  if (!matchesEmail) {
    return (
      <AuthShell
        title="إيميلٌ غير مطابق"
        sub={`الدعوة لـ ${info.email} لكنّك سجّلتَ دخولَك بـ ${user?.email || '—'}.`}
      >
        <div className="alert err" style={{ marginBottom: 12 }}>
          سجّل خروجَك ثمّ ادخل بالإيميل المدعوّ، أو افتح الرابط في نافذةٍ خاصّة.
        </div>
        <button className="btn" onClick={async () => { await supabase.auth.signOut(); location.reload() }}>
          تَسجيلُ الخروج
        </button>
      </AuthShell>
    )
  }

  // ٣) جلسةٌ مطابقة → نموذج البيانات
  return (
    <AuthShell
      title="إكمالُ بيانات الدعوة"
      sub={`بصفة: ${ROLE_AR[info.invited_role] || info.invited_role}`}
    >
      <div className="alert" style={{ marginBottom: 12, background: 'var(--info-bg)', color: 'var(--info-ink)' }}>
        ستَخضع بياناتُك لمراجعة الإدارة قبل التَّفعيل.
      </div>
      <form onSubmit={submitInvitation} className="form">
        <div className="field">
          <label>الاسمُ الكامل</label>
          <input value={fullName} onChange={e => setFullName(e.target.value)}
                 placeholder="الاسم الكامل كما في الهويّة" required />
        </div>
        <div className="field ltr">
          <label>رقمُ الجوّال</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                 placeholder="+9665XXXXXXXX" required />
        </div>
        <div className="field">
          <label>رسالةٌ تَعريفيّةٌ <span className="muted">(اختياريّ)</span></label>
          <textarea rows={4} value={message} onChange={e => setMessage(e.target.value)}
                    placeholder="اذكر خبرتَك وما يُؤهّلُك لهذا الدور…" />
        </div>
        {err && <div className="alert err">{err}</div>}
        <button className="btn btn-em" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : 'إرسالُ البيانات للمراجعة'}
        </button>
      </form>
    </AuthShell>
  )
}
