import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import AuthShell from './AuthShell'
import Icon from '../../components/Icon'
import PasswordStrengthMeter from '../../components/PasswordStrengthMeter'
import { scorePassword } from '../../lib/passwordStrength'

/**
 * صفحةُ إعادة تعيين كلمة المرور — تُفتح من رابط البريد.
 *
 * تدفّق Supabase:
 *  ١) Supabase يقرأ access_token من الـ URL ويُنشئ recovery session تلقائيًّا
 *  ٢) يُطلق onAuthStateChange بحدث 'PASSWORD_RECOVERY'
 *  ٣) نُمكّن المستخدم من تعيين كلمةٍ جديدة عبر updateUser
 *  ٤) عند النجاح: تسجيل خروج (recovery session فقط) → /login
 */
export default function ResetPassword() {
  const nav = useNavigate()
  const [ready, setReady] = useState(false)        // session recovery موجودة
  const [validating, setValidating] = useState(true)
  const [invalid, setInvalid] = useState(false)    // رابطٌ منتهٍ أو غير صالح

  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const pwRef = useRef(null)

  // ١) ترصّد حالة المصادقة — Supabase يضع المستخدم في recovery session تلقائيًّا
  useEffect(() => {
    let cancelled = false

    // كشفُ المؤشّرات في الـ URL مبكّرًا — لو الرابط صحيح، نَنتظر أطول
    const url = window.location.href
    const hash = window.location.hash || ''
    const search = window.location.search || ''
    const hasRecoveryHint =
      hash.includes('type=recovery') || hash.includes('access_token=') ||
      search.includes('type=recovery') || search.includes('code=') ||
      search.includes('token_hash=') || hash.includes('error=')
    const hasError =
      hash.includes('error=') || search.includes('error=')

    // لو الرابط يَحمل error صريحًا من Supabase (مثل otp_expired) — اعرض رسالة فورًا
    if (hasError) { setInvalid(true); setValidating(false); return }

    // تحقّقٌ مبدئيّ — قد تكون الجلسة قائمةً بالفعل
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      if (session) {
        setReady(true)
        setValidating(false)
        setTimeout(() => pwRef.current?.focus(), 50)
        return
      }
      // مهلة استرداد: ٤ ثوانٍ لو في hint، ٢ لو ما في (iOS in-app browser أبطأ)
      const waitMs = hasRecoveryHint ? 4000 : 2000
      setTimeout(async () => {
        if (cancelled) return
        const { data: { session: s } } = await supabase.auth.getSession()
        if (cancelled) return
        if (s) {
          setReady(true)
        } else {
          // محاولةٌ أخيرة: لو في token_hash نتولّى التَّبادل يدويًّا (PKCE flow الجديد)
          const params = new URLSearchParams(search)
          const tokenHash = params.get('token_hash')
          const type = params.get('type')
          if (tokenHash && (type === 'recovery' || !type)) {
            const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
            if (!cancelled) {
              if (error) setInvalid(true)
              else setReady(true)
            }
          } else {
            setInvalid(true)
          }
        }
        if (!cancelled) setValidating(false)
      }, waitMs)
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        setReady(true)
        setInvalid(false)
        setValidating(false)
        setTimeout(() => pwRef.current?.focus(), 50)
      }
    })

    return () => { cancelled = true; sub?.subscription?.unsubscribe?.() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setErr('')

    const s = scorePassword(pw1)
    if (!s.ok) { setErr('كلمة المرور ضعيفة — ' + (s.suggestions[0] || 'قوِّها بإضافة أرقام ورموز.')); return }
    if (pw1 !== pw2) { setErr('تأكيد كلمة المرور لا يطابق.'); return }

    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 })
      if (error) {
        const m = String(error.message || '')
        if (/pwned|leaked|compromise/i.test(m)) {
          setErr('🔓 هذه الكلمة ظهرت في تسريباتٍ معروفة — اختر كلمةً فريدة.')
        } else if (/weak|at least/i.test(m)) {
          setErr('كلمة المرور ضعيفةٌ جدًّا.')
        } else if (/session.*expired|invalid.*token/i.test(m)) {
          setErr('انتهت صلاحية الرابط. اطلب رابطًا جديدًا.')
        } else {
          setErr('تعذر تحديث كلمة المرور. حاول مجددا.')
        }
        setBusy(false)
        return
      }
      // النجاح: نُسجّل خروج (recovery session) ثم نوجه للدخول
      await supabase.auth.signOut()
      setDone(true)
      setBusy(false)
      setTimeout(() => nav('/login', { replace: true }), 2500)
    } catch {
      setErr('تعذر تحديث كلمة المرور. حاول مجددا.')
      setBusy(false)
    }
  }

  // ─── ١) لحظة التحقق من الرابط ───────────────────────────
  if (validating) {
    return (
      <AuthShell title="جارٍ التحقق…" sub="نتأكد من صلاحية رابط الاسترداد.">
        <div className="auth-form" style={{ display: 'grid', placeItems: 'center', minHeight: 120 }}>
          <span className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      </AuthShell>
    )
  }

  // ─── ٢) رابطٌ منتهٍ أو غير صالح ─────────────────────────
  if (invalid) {
    return (
      <AuthShell
        title="الرابط غير صالح"
        sub="انتهت صلاحية رابط الاسترداد أو استُخدم مسبقا."
        footer={<Link to="/login">العودة لتسجيل الدخول</Link>}
      >
        <div className="auth-form">
          <div className="alert err" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="lock" size={18} />
            <div style={{ flex: 1, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>تعذر التحقق من الرابط</div>
              <div style={{ fontSize: 13, color: 'var(--cr-200)' }}>
                الروابط صالحةٌ لمدةٍ محدودة. اطلب رابطًا جديدًا للمتابعة.
              </div>
            </div>
          </div>
          <Link to="/forgot-password" className="btn btn-em btn-block" style={{ textDecoration: 'none' }}>
            طلبُ رابطٍ جديد
          </Link>
        </div>
      </AuthShell>
    )
  }

  // ─── ٣) تم — التوجيه للدخول ─────────────────────────────
  if (done) {
    return (
      <AuthShell title="تم تحديث كلمة المرور" sub="جارٍ تحويلك لصفحة الدخول…">
        <div className="auth-form">
          <div className="alert ok" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Icon name="check" size={18} />
            <div style={{ flex: 1, fontWeight: 600 }}>
              كلمة المرور الجديدة فعّالة. سجّل دخولك الآن.
            </div>
          </div>
        </div>
      </AuthShell>
    )
  }

  // ─── ٤) نموذج تعيين الكلمة الجديدة ──────────────────────
  return (
    <AuthShell
      title="تعيين كلمة مرورٍ جديدة"
      sub="اختر كلمةً قويةً تستعملها لتسجيل الدخول لاحقا."
      footer={<Link to="/login">العودة لتسجيل الدخول</Link>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {!ready && <input type="hidden" value="recovery" readOnly />}

        <div className="field with-ic has-toggle ltr">
          <label>كلمة المرور الجديدة</label>
          <span className="f-ic"><Icon name="lock" size={17} /></span>
          <input
            ref={pwRef}
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="••••••••"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            disabled={busy}
            required
            minLength={8}
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
        <PasswordStrengthMeter password={pw1} />

        <div className="field with-ic ltr">
          <label>تأكيد كلمة المرور</label>
          <span className="f-ic"><Icon name="lock" size={17} /></span>
          <input
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="••••••••"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            disabled={busy}
            required
            minLength={8}
          />
        </div>

        {err && <div className="alert err">{err}</div>}

        <button className="btn btn-em btn-block" type="submit" disabled={busy || !ready}>
          {busy ? <span className="spinner" /> : 'حفظ كلمة المرور'}
        </button>
      </form>
    </AuthShell>
  )
}
