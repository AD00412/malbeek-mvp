import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import AuthShell from './AuthShell'

function arError(msg = '') {
  const m = msg.toLowerCase()
  if (m.includes('already registered') || m.includes('already been registered')) return 'هذا البريد مُسجّل مسبقًا. سجّل الدخول بدلًا من ذلك.'
  if (m.includes('password')) return 'كلمة المرور ضعيفة (٦ أحرف على الأقل).'
  if (m.includes('network')) return 'تعذّر الاتصال بالخادم. حاول مرة أخرى.'
  return 'تعذّر إنشاء الحساب. حاول مرة أخرى.'
}

function makeSlug() {
  return 'hamla-' + Math.random().toString(36).slice(2, 8)
}

export default function Signup() {
  const [orgName, setOrgName] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const navigate = useNavigate()
  const { refreshProfile } = useAuth()

  // إنشاء سجلّ الحملة مع توليد slug فريد (إعادة المحاولة عند التعارض)
  async function createSubscriber(userId) {
    for (let i = 0; i < 4; i++) {
      const slug = makeSlug()
      const { data, error } = await supabase
        .from('subscribers')
        .insert({ owner_id: userId, org_name: orgName.trim(), slug, plan: 'trial' })
        .select('id, slug')
        .single()
      if (!error) return data
      if (error.code !== '23505') throw error // أي خطأ غير تعارض الـ slug
    }
    throw new Error('تعذّر توليد رابطٍ فريد للحملة.')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setErr(''); setInfo(''); setBusy(true)

    // 1) إنشاء حساب المصادقة (الدور = مشترك يُحفظ في بيانات المستخدم)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { role: 'subscriber', full_name: fullName.trim(), phone: phone.trim() } },
    })

    if (error) { setBusy(false); setErr(arError(error.message)); return }

    // 2) إن لم تُنشأ جلسة (تأكيد البريد مفعّل) — أبلغ المستخدم
    if (!data.session) {
      setBusy(false)
      setInfo('تم إنشاء حسابك. فعّل بريدك الإلكتروني ثم سجّل الدخول لإكمال تجهيز حملتك.')
      return
    }

    try {
      // 3) أنشئ سجلّ الحملة ثم اربطه بالملف الشخصي
      const sub = await createSubscriber(data.user.id)
      const { error: upErr } = await supabase
        .from('profiles')
        .update({ subscriber_id: sub.id })
        .eq('id', data.user.id)
      if (upErr) throw upErr

      await refreshProfile()
      setBusy(false)
      navigate('/dashboard', { replace: true })
    } catch (e2) {
      setBusy(false)
      setErr(typeof e2?.message === 'string' ? e2.message : 'تعذّر تجهيز الحملة. تواصل مع الدعم.')
    }
  }

  return (
    <AuthShell
      heading="ابدأ تجربتك المجانية"
      blurb="١٤ يومًا مجانًا برحلةٍ واحدة — جرّب ملبّيك كاملًا بلا بطاقة."
      points={['تسجيل المعتمرين والكشوف', 'الباركود وتذكرة الصعود', 'رابط تسجيلٍ خاصٌّ بحملتك']}
    >
      <h2 className="ttl">إنشاء حساب مشترك</h2>
      <p className="desc">سجّل حملتك وابدأ خلال دقيقة.</p>

      <form className="form" onSubmit={handleSubmit}>
        <div className="field">
          <label>اسم الحملة / المؤسسة</label>
          <input type="text" placeholder="مثال: دروب الإيمان للنقل" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
        </div>
        <div className="field">
          <label>اسمك الكامل</label>
          <input type="text" placeholder="الاسم الرباعي" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="field ltr">
          <label>رقم الجوال</label>
          <input type="tel" inputMode="tel" placeholder="05xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
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
          {busy ? <span className="spinner" /> : 'ابدأ التجربة المجانية'}
        </button>
      </form>

      <div className="auth-foot">
        لديك حسابٌ بالفعل؟ <Link to="/login">تسجيل الدخول</Link>
      </div>
    </AuthShell>
  )
}
