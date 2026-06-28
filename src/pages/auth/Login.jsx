import { useState, useEffect, useRef } from 'react'
import { Navigate, Link, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import { homeForRole } from '../../app/RequireAuth'
import AuthShell from './AuthShell'
import Icon from '../../components/Icon'
import GoogleButton from '../../components/GoogleButton'

function arError(msg = '') {
  const m = String(msg).toLowerCase()
  if (m.includes('invalid login') || m.includes('invalid credentials')) return 'البريد أو كلمة المرور غير صحيحة.'
  if (m.includes('email not confirmed')) return 'لم يتم تأكيد بريدك بعد. افتح رسالة التفعيل ثم أعد المحاولة.'
  if (m.includes('rate limit') || m.includes('too many')) return 'محاولات كثيرة متتالية. انتظر دقيقة ثم حاول مجددا.'
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch')) return 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.'
  return 'تعذر تسجيل الدخول. حاول مجددا.'
}

export default function Login() {
  const { session, profile, role, loading } = useAuth()
  const loc = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const emailRef = useRef(null)

  useEffect(() => { emailRef.current?.focus() }, [])

  // حارس ضد التعليق: لو تأخر تحميل الملف الشخصي بعد دخول ناجح،
  // نوقف الـ spinner ونعرض رسالة واضحة.
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => {
      setBusy(false)
      setErr('تم الدخول لكن تعذر تحميل ملفك الشخصي. حدث الصفحة، وإن تكرر الأمر تواصل مع الدعم.')
    }, 8000)
    return () => clearTimeout(t)
  }, [busy])

  // مسجل بالفعل؟ وجهه إلى لوحته (أو إلى الصفحة التي جاء منها).
  if (!loading && session && profile) {
    const from = loc.state?.from
    const dest = from && from !== '/login' ? from : homeForRole(role)
    return <Navigate to={dest} replace />
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setErr('')

    const mail = email.trim()
    if (!mail || !password) { setErr('أدخل البريد وكلمة المرور للمتابعة.'); return }

    setBusy(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: mail, password })
      if (error) { setErr(arError(error.message)); setBusy(false); return }
      // النجاح: AuthProvider يلتقط الجلسة ويتكفل <Navigate> أعلاه بالتوجيه.
    } catch (e2) {
      setErr(arError(e2?.message))
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="تسجيل الدخول"
      sub="أدخل بريدك وكلمة المرور للمتابعة."
      footer={<>مشترك جديد؟ <Link to="/signup">ابدأ تجربتك المجانية</Link></>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="field with-ic ltr">
          <label>البريد الإلكتروني</label>
          <span className="f-ic"><Icon name="mail" size={17} /></span>
          <input
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
        </div>

        <div className="field with-ic has-toggle ltr">
          <label>كلمة المرور</label>
          <span className="f-ic"><Icon name="lock" size={17} /></span>
          <input
            type={showPw ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
          <button
            type="button"
            className="pw-toggle"
            aria-label={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
            onClick={() => setShowPw((s) => !s)}
            tabIndex={-1}
          >
            <Icon name={showPw ? 'eyeOff' : 'eye'} size={17} />
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: -4 }}>
          <Link to="/forgot-password" className="auth-link-sm">نسيت كلمة المرور؟</Link>
        </div>

        {err && <div className="alert err">{err}</div>}

        <button className="btn btn-em btn-block" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : 'دخول'}
        </button>

        <div className="auth-divider">أو</div>
        <GoogleButton intent={{ kind: 'login' }} onError={setErr} disabled={busy} />
      </form>
    </AuthShell>
  )
}
