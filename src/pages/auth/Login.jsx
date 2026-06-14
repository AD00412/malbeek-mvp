import { useState, useEffect } from 'react'
import { Navigate, Link, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import { homeForRole } from '../../app/RequireAuth'
import AuthShell from './AuthShell'

// ترجمة رسائل الخطأ الشائعة من Supabase إلى العربية
function arError(msg = '') {
  const m = String(msg).toLowerCase()
  if (m.includes('invalid login') || m.includes('invalid credentials')) return 'البريد أو كلمة المرور غير صحيحة.'
  if (m.includes('email not confirmed')) return 'لم يتم تأكيد البريد بعد. عطّل «Confirm email» في إعدادات Supabase أثناء التطوير، أو فعّل بريدك ثم أعد المحاولة.'
  if (m.includes('rate limit') || m.includes('too many')) return 'محاولاتٌ كثيرةٌ متتالية. انتظر دقيقةً ثم حاول مجدّدًا.'
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch')) {
    return 'تعذّر الاتصال بخادم Supabase. تحقّق من اتصالك بالإنترنت ومن صحّة VITE_SUPABASE_URL في .env.'
  }
  return 'حدث خطأٌ غير متوقّع: ' + msg
}

export default function Login() {
  const { session, profile, role, loading } = useAuth()
  const loc = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // حارسٌ ضدّ التعليق الأبديّ: لو نجح الدخول لكن تعذّر تحميل الملفّ الشخصي
  // (صفٌّ مفقود/خطأ RLS)، يبقى <Navigate> معطّلًا (يشترط session && profile)
  // والـ spinner دائرًا للأبد. بعد مهلةٍ نوقفه ونعرض رسالةً واضحة.
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => {
      setBusy(false)
      setErr('تمّ الدخول لكن تعذّر تحميل ملفّك الشخصي. حدّث الصفحة، وإن تكرّر الأمر تواصل مع الدعم.')
    }, 8000)
    return () => clearTimeout(t)
  }, [busy])

  // مُسجَّلٌ بالفعل؟ وجّهه إلى لوحته (أو إلى الصفحة التي جاء منها) بلا إظهار النموذج.
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
      // النجاح: AuthProvider يلتقط الجلسة ويحمّل الملف الشخصي تلقائيًّا،
      // ثم يتكفّل <Navigate> أعلاه بالتوجيه. نُبقي الـ spinner دائرًا حتى ذلك
      // فلا يومض النموذج رجوعًا للحظة.
    } catch (e2) {
      setErr(arError(e2?.message))
      setBusy(false)
    }
  }

  return (
    <AuthShell
      heading="أهلًا بعودتك"
      blurb="سجّل دخولك للوصول إلى لوحتك — للإدارة والمشتركين والعملاء."
      points={['لوحةٌ مخصّصةٌ لكل دور', 'وصولٌ آمنٌ ومحمي', 'بياناتك دائمًا بين يديك']}
    >
      <h2 className="ttl">تسجيل الدخول</h2>
      <p className="desc">أدخل بريدك وكلمة المرور للمتابعة.</p>

      <form className="form" onSubmit={handleSubmit}>
        <div className="field ltr">
          <label>البريد الإلكتروني</label>
          <input
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

        <div className="field ltr">
          <label>كلمة المرور</label>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </div>

        {err && <div className="alert err">{err}</div>}

        <button className="btn btn-gold" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : 'دخول'}
        </button>
      </form>

      <div className="auth-foot">
        مشترك جديد؟ <Link to="/signup">ابدأ تجربتك المجانية</Link>
      </div>
    </AuthShell>
  )
}
