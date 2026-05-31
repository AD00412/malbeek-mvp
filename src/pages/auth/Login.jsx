import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { homeForRole } from '../../app/RequireAuth'
import AuthShell from './AuthShell'

// ترجمة رسائل الخطأ الشائعة من Supabase إلى العربية
function arError(msg = '') {
  const m = msg.toLowerCase()
  if (m.includes('invalid login')) return 'البريد أو كلمة المرور غير صحيحة.'
  if (m.includes('email not confirmed')) return 'لم يتم تأكيد البريد بعد. تحقّق من بريدك.'
  if (m.includes('network')) return 'تعذّر الاتصال بالخادم. حاول مرة أخرى.'
  return 'حدث خطأٌ غير متوقّع. حاول مرة أخرى.'
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setErr('')
    setBusy(true)

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      setBusy(false)
      setErr(arError(error.message))
      return
    }

    // اقرأ الدور لتوجيه المستخدم إلى لوحته الصحيحة
    const uid = data?.user?.id
    const { data: prof } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', uid)
      .maybeSingle()

    setBusy(false)
    navigate(homeForRole(prof?.role), { replace: true })
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
