import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import AuthShell from './AuthShell'
import Icon from '../../components/Icon'

function arError(msg = '') {
  const m = String(msg).toLowerCase()
  if (m.includes('rate limit') || m.includes('too many')) return 'محاولات كثيرة. انتظر دقيقة ثم حاول مجددا.'
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch')) return 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.'
  return 'تعذر إرسال رابط الاسترداد. حاول مجددا.'
}

/**
 * طلبُ استرداد كلمة المرور — يرسل رابطًا للبريد.
 * لأمان الخصوصيّة: نعرض رسالةَ نجاحٍ موحّدةً سواءٌ وُجد البريد أم لم يُوجَد
 * (نَمنع كشف وجود الحسابات للمهاجمين).
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)
  const emailRef = useRef(null)

  useEffect(() => { emailRef.current?.focus() }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setErr('')

    const mail = email.trim()
    if (!mail) { setErr('أدخل بريدك الإلكتروني للمتابعة.'); return }
    // فحص شكل البريد الأدنى
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
      setErr('صيغة البريد غير صحيحة.'); return
    }

    setBusy(true)
    try {
      const redirectTo = `${window.location.origin}/reset-password`
      const { error } = await supabase.auth.resetPasswordForEmail(mail, { redirectTo })
      // ملاحظة الأمان: حتى لو رجع خطأ من نوع "user not found"،
      // نُظهر النجاحَ نفسَه لمنع تعداد المستخدمين.
      if (error && !/not.*found|no user/i.test(error.message || '')) {
        setErr(arError(error.message))
        setBusy(false)
        return
      }
      setSent(true)
    } catch (e2) {
      setErr(arError(e2?.message))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <AuthShell
        title="تحقق من بريدك"
        sub="أرسلنا رابط إعادة التعيين إن كان البريد مسجلا لدينا."
        footer={<Link to="/login">العودة لتسجيل الدخول</Link>}
      >
        <div className="auth-form">
          <div className="alert ok" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="mail" size={18} />
            <div style={{ flex: 1, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>تم إرسال الرابط ✓</div>
              <div style={{ fontSize: 13, color: 'var(--cr-200)' }}>
                افتح رسالة من <strong>ملبّيك</strong> في بريدك (<span dir="ltr">{email}</span>)
                واضغط على الرابط لإعادة تعيين كلمة المرور. الرابط صالحٌ لمدةٍ محدودة.
              </div>
              <div style={{ fontSize: 12, color: 'var(--cr-300)', marginTop: 8 }}>
                لم تستلم الرسالة؟ تحقق من مجلد «غير المرغوب» (Spam)، أو حاول مجددا بعد دقيقة.
              </div>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-block"
            type="button"
            onClick={() => { setSent(false); setEmail(''); setTimeout(() => emailRef.current?.focus(), 50) }}
          >
            إرسال إلى بريدٍ آخر
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="نسيت كلمة المرور؟"
      sub="أدخل بريدك المسجل وسنرسل لك رابط إعادة التعيين."
      footer={<Link to="/login">العودة لتسجيل الدخول</Link>}
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

        {err && <div className="alert err">{err}</div>}

        <button className="btn btn-em btn-block" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : 'إرسال رابط الاسترداد'}
        </button>
      </form>
    </AuthShell>
  )
}
