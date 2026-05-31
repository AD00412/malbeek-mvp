import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import AuthShell from './AuthShell'
import { ScreenLoader } from '../../app/RequireAuth'

function arError(msg = '') {
  const m = msg.toLowerCase()
  if (m.includes('already registered') || m.includes('already been registered')) return 'هذا البريد مُسجّل مسبقًا. سجّل الدخول من صفحة الدخول.'
  if (m.includes('password')) return 'كلمة المرور ضعيفة (٦ أحرف على الأقل).'
  if (m.includes('network')) return 'تعذّر الاتصال بالخادم. حاول مرة أخرى.'
  return 'تعذّر إنشاء الحساب. حاول مرة أخرى.'
}

export default function CustomerJoin() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()

  const [resolving, setResolving] = useState(true)
  const [org, setOrg] = useState(null)          // { id, org_name }
  const [notFound, setNotFound] = useState(false)

  const [fullName, setFullName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  // تحويل الـ slug إلى حملة (عبر العرض العام)
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await supabase
        .from('public_subscribers')
        .select('id, org_name')
        .eq('slug', slug)
        .maybeSingle()
      if (!active) return
      if (error || !data) { setNotFound(true) }
      else { setOrg(data) }
      setResolving(false)
    })()
    return () => { active = false }
  }, [slug])

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy || !org) return
    setErr(''); setInfo(''); setBusy(true)

    // 1) إنشاء حساب العميل مربوطًا بحملة هذا الرابط فقط
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          role: 'customer',
          full_name: fullName.trim(),
          phone: phone.trim(),
          subscriber_id: org.id,
        },
      },
    })

    if (error) { setBusy(false); setErr(arError(error.message)); return }

    // 2) تأكيد البريد مفعّل؟ أبلغ العميل
    if (!data.session) {
      setBusy(false)
      setInfo('تم تسجيل بياناتك. فعّل بريدك الإلكتروني ثم سجّل الدخول لعرض رحلاتك.')
      return
    }

    try {
      // 3) احفظ سجلّ المعتمر (ضمن حملته فقط — تتحقق منه سياسة RLS)
      const { error: insErr } = await supabase.from('customers').insert({
        subscriber_id: org.id,
        profile_id: data.user.id,
        full_name: fullName.trim(),
        national_id: nationalId.trim(),
        phone: phone.trim(),
      })
      if (insErr) throw insErr

      await refreshProfile()
      setBusy(false)
      navigate('/customer', { replace: true })
    } catch (e2) {
      setBusy(false)
      setErr(typeof e2?.message === 'string' ? e2.message : 'تعذّر حفظ بياناتك. حاول مرة أخرى.')
    }
  }

  if (resolving) return <ScreenLoader label="جارٍ فتح صفحة التسجيل…" />

  if (notFound) {
    return (
      <AuthShell heading="رابطٌ غير صالح" blurb="هذا الرابط غير موجودٍ أو انتهت صلاحيته." points={[]}>
        <h2 className="ttl">تعذّر العثور على الحملة</h2>
        <p className="desc">تأكّد من الرابط الذي وصلك من جهة الحملة، أو تواصل معهم لإعادة إرساله.</p>
        <div className="auth-foot" style={{ marginTop: 28 }}>
          لديك حسابٌ بالفعل؟ <Link to="/login">تسجيل الدخول</Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      heading={`التسجيل مع ${org.org_name}`}
      blurb="أدخل بياناتك مرةً واحدة، وادخل لوحتك في أي وقتٍ لاحقًا."
      points={['تذكرة صعودٍ بالباركود', 'حجزٌ سريعٌ دون إعادة تعبئة', 'ترى رحلات حملتك فقط']}
    >
      <h2 className="ttl">تسجيل معتمرٍ جديد</h2>
      <span className="auth-org"><span style={{ fontSize: 13 }}>الحملة:</span> {org.org_name}</span>

      <form className="form" onSubmit={handleSubmit}>
        <div className="field">
          <label>الاسم الرباعي</label>
          <input type="text" placeholder="الاسم كما في الهوية" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="field ltr">
          <label>رقم الهوية / الإقامة</label>
          <input type="text" inputMode="numeric" placeholder="1xxxxxxxxx" value={nationalId} onChange={(e) => setNationalId(e.target.value)} required />
        </div>
        <div className="field ltr">
          <label>رقم الجوال</label>
          <input type="tel" inputMode="tel" placeholder="05xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
        <div className="field ltr">
          <label>البريد الإلكتروني</label>
          <input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field ltr">
          <label>كلمة المرور</label>
          <input type="password" autoComplete="new-password" placeholder="٦ أحرف على الأقل" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
        </div>

        {err && <div className="alert err">{err}</div>}
        {info && <div className="alert ok">{info}</div>}

        <button className="btn btn-gold" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : 'تسجيل ودخول'}
        </button>
      </form>

      <div className="auth-foot">
        سجّلت سابقًا؟ <Link to="/login">ادخل حسابك</Link>
      </div>
    </AuthShell>
  )
}
