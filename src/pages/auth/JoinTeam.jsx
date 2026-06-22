import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import { translateRpcError } from '../../lib/rpcErrors'
import { cleanName } from '../../lib/format'
import AuthShell from './AuthShell'
import Icon from '../../components/Icon'
import { ScreenLoader, homeForRole } from '../../app/RequireAuth'

const ROLE_AR = { manager: 'مشرف', staff: 'موظف' }

/**
 * صفحة قبول دعوة الانضمام لفريق حملة عبر رابط يرسله المالك للموظف.
 * تتعامل مع التسجيل/الدخول بالبريد المدعو ثم القبول — دون إنشاء حملة تلقائية.
 */
export default function JoinTeam() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { session, user, refreshProfile, signOut } = useAuth()

  const [resolving, setResolving] = useState(true)
  const [invite, setInvite] = useState(null)     // { org_name, role, email }
  const [notFound, setNotFound] = useState(false)
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await supabase.rpc('invite_info', { p_invite: id }).maybeSingle()
      if (!active) return
      if (error || !data) setNotFound(true)
      else setInvite(data)
      setResolving(false)
    })()
    return () => { active = false }
  }, [id])

  async function accept() {
    if (busy) return
    setErr(''); setBusy(true)
    const { error } = await supabase.rpc('accept_invite', { p_invite: id })
    setBusy(false)
    if (error) { setErr(translateRpcError(error, 'تعذر قبول الدعوة.')); return }
    await refreshProfile?.()
    navigate('/dashboard', { replace: true })
  }

  async function signUpAndAccept(e) {
    e.preventDefault()
    if (busy) return
    if (cleanName(fullName).split(/\s+/).filter(Boolean).length < 2) { setErr('اكتب اسمك الكامل.'); return }
    if (password.length < 6) { setErr('كلمة المرور ٦ أحرف على الأقل.'); return }
    setErr(''); setInfo(''); setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: invite.email,
      password,
      options: { data: { role: 'customer', full_name: cleanName(fullName) } },
    })
    if (error) {
      setBusy(false)
      if (/already registered|already been registered/i.test(error.message)) {
        setErr('هذا البريد مسجل مسبقا — سجل الدخول لقبول الدعوة.')
      } else setErr('تعذر إنشاء الحساب. حاول مجددا.')
      return
    }
    if (!data.session) {   // تأكيد البريد مفعل
      setBusy(false)
      setInfo('أنشأنا حسابك. فعل بريدك ثم ارجع لهذا الرابط لقبول الدعوة.')
      return
    }
    // لدينا جلسة بالبريد المدعو نفسه → اقبل فورا (لا تنشأ حملة تلقائية هنا)
    const { error: accErr } = await supabase.rpc('accept_invite', { p_invite: id })
    setBusy(false)
    if (accErr) { setErr(translateRpcError(accErr, 'تعذر قبول الدعوة.')); return }
    await refreshProfile?.()
    navigate('/dashboard', { replace: true })
  }

  if (resolving) return <ScreenLoader label="جار فتح الدعوة…" />

  if (notFound) {
    return (
      <AuthShell footer={<>لديك حساب بالفعل؟ <Link to="/login">تسجيل الدخول</Link></>}>
        <div className="join-state">
          <span className="join-state-ic warn"><Icon name="customers" size={30} /></span>
          <h2 className="ttl">تعذر فتح الدعوة</h2>
          <p className="desc">قد تكون الدعوة ألغيت أو قبلت سابقا. اطلب من صاحب الحملة إرسال دعوة جديدة.</p>
        </div>
      </AuthShell>
    )
  }

  const roleAr = ROLE_AR[invite?.role] || 'عضو'

  // مسجل الدخول: زر قبول مباشر (مع رسائل خطأ واضحة لعدم تطابق البريد/ملكية حملة)
  if (session && user) {
    const sameEmail = (user.email || '').toLowerCase() === (invite?.email || '').toLowerCase()
    return (
      <AuthShell>
        <div className="join-state">
          <span className="join-state-ic ok"><Icon name="customers" size={30} /></span>
          <h2 className="ttl">انضمام كـ«{roleAr}»</h2>
          <p className="desc">دعيت للانضمام لفريق حملة «{invite?.org_name}». أنت مسجل بـ {user.email}.</p>
          {!sameEmail && (
            <div className="alert warn" style={{ marginTop: 8 }}>
              هذه الدعوة لبريد <b className="ltr">{invite?.email}</b>. سجل خروجا وادخل بذلك البريد لقبولها.
            </div>
          )}
          {err && <div className="alert err" style={{ marginTop: 8 }}>{err}</div>}
          {sameEmail && (
            <button className="btn btn-em btn-block" style={{ marginTop: 16 }} onClick={accept} disabled={busy}>
              {busy ? <span className="spinner" /> : <><Icon name="check" size={16} /> قبول الانضمام</>}
            </button>
          )}
          <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => signOut()}>
            <Icon name="logout" size={16} /> تسجيل الخروج
          </button>
        </div>
      </AuthShell>
    )
  }

  // غير مسجل: تسجيل سريع بالبريد المدعو (مقفل) ثم قبول فوري
  return (
    <AuthShell
      title="قبول الدعوة"
      sub={`دعوة للانضمام لفريق «${invite?.org_name || ''}» كـ«${roleAr}».`}
      footer={<>لديك حساب بالبريد نفسه؟ <Link to="/login">سجل الدخول</Link> ثم ارجع لهذا الرابط.</>}
    >
      {info ? (
        <div className="alert ok" style={{ marginTop: 8 }}>{info}</div>
      ) : (
        <form className="auth-form" onSubmit={signUpAndAccept}>
          <div className="field with-ic ltr">
            <label>البريد الإلكتروني (المدعو)</label>
            <span className="f-ic"><Icon name="mail" size={17} /></span>
            <input type="email" value={invite?.email || ''} readOnly disabled />
          </div>
          <div className="field with-ic">
            <label>الاسم الكامل <span className="req">*</span></label>
            <span className="f-ic"><Icon name="user" size={17} /></span>
            <input type="text" placeholder="اسمك" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="field with-ic has-toggle ltr">
            <label>كلمة المرور <span className="req">*</span></label>
            <span className="f-ic"><Icon name="lock" size={17} /></span>
            <input type={showPw ? 'text' : 'password'} placeholder="٦ أحرف على الأقل" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="pw-toggle" aria-label={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} onClick={() => setShowPw((s) => !s)} tabIndex={-1}>
              <Icon name={showPw ? 'eyeOff' : 'eye'} size={17} />
            </button>
          </div>
          {err && <div className="alert err">{err}</div>}
          <button className="btn btn-em btn-block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : <><Icon name="check" size={16} /> إنشاء الحساب والانضمام</>}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
