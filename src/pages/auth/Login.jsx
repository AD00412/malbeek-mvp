import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { homeForRole } from '../../app/RequireAuth'
import AuthShell from './AuthShell'

// ترجمة رسائل الخطأ الشائعة من Supabase إلى العربية
function arError(msg = '') {
  const m = String(msg).toLowerCase()
  if (m.includes('invalid login')) return 'البريد أو كلمة المرور غير صحيحة.'
  if (m.includes('email not confirmed')) return 'لم يتم تأكيد البريد بعد. عطّل «Confirm email» في إعدادات Supabase أثناء التطوير.'
  if (m.includes('timeout')) return 'تعذّر الوصول إلى خادم Supabase خلال ١٠ ثوانٍ. تحقّق من VITE_SUPABASE_URL في .env، ومن أن مشروعك ليس متوقّفًا، ومن أن شبكتك لا تحجب supabase.co'
  if (m.includes('network') || m.includes('fetch')) return 'تعذّر الاتصال بالخادم. تحقّق من رابط Supabase في .env.'
  return 'حدث خطأٌ غير متوقّع. حاول مرة أخرى.'
}

// timeout دفاعي: لو signin معلَّق، نرفع خطأً واضحًا بدلًا من تجمّد الزر
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
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

    try {
      // ١٠ ثوانٍ كحدٍّ أقصى لطلب الدخول قبل عرض رسالة timeout
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
        10000,
      )
      if (error) { setErr(arError(error.message)); return }

      // ٥ ثوانٍ لقراءة الدور — لو فشلت نُكمل للجذر ويتكفّل AuthProvider/RootRedirect
      const uid = data?.user?.id
      let role = null
      try {
        const { data: prof } = await withTimeout(
          supabase.from('profiles').select('role').eq('id', uid).maybeSingle(),
          5000,
        )
        role = prof?.role ?? null
      } catch (_) { /* تجاوزه؛ التوجيه الافتراضي يحدث أدناه */ }

      navigate(homeForRole(role), { replace: true })
    } catch (e2) {
      setErr(arError(e2?.message))
    } finally {
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
