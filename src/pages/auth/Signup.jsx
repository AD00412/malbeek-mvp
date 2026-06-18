import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import { suggestSlug } from '../../lib/slug'
import AuthShell from './AuthShell'

function arError(msg = '') {
  const m = msg.toLowerCase()
  if (m.includes('already registered') || m.includes('already been registered')) return 'هذا البريد مُسجّل مسبقًا. سجّل الدخول بدلًا من ذلك.'
  if (m.includes('password')) return 'كلمة المرور ضعيفة (٦ أحرف على الأقل).'
  if (m.includes('network')) return 'تعذّر الاتصال بالخادم. حاول مرة أخرى.'
  return 'تعذّر إنشاء الحساب. حاول مرة أخرى.'
}

export default function Signup() {
  const [orgName, setOrgName] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const navigate = useNavigate()
  const { refreshProfile } = useAuth()

  // إنشاء سجلّ الحملة بـ slug مشتقٍّ ذكيًّا من اسم الحملة (lib/slug)، مع
  // إعادة المحاولة عند تعارض الفريديّة. مصدرٌ واحدٌ للحقيقة — لا تكرارَ.
  async function createSubscriber(userId) {
    for (let i = 0; i < 5; i++) {
      const slug = suggestSlug(orgName) + (i === 0 ? '' : '-' + Math.random().toString(36).slice(2, 5))
      const { data, error } = await supabase
        .from('subscribers')
        .insert({ owner_id: userId, org_name: orgName.trim(), slug: slug.slice(0, 40), plan: 'trial' })
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
    if (!agreed) { setErr('يُرجى الموافقة على الشروط وسياسة الخصوصيّة للمتابعة.'); return }
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
      title="إنشاء حساب"
      sub="أنشئ حسابك للبدء في إدارة حملتك."
      footer={<>لديك حسابٌ بالفعل؟ <Link to="/login">تسجيل الدخول</Link></>}
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="field">
          <label>الاسم الكامل <span className="req">*</span></label>
          <input type="text" placeholder="الاسم الرباعي" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="field ltr">
          <label>البريد الإلكتروني <span className="req">*</span></label>
          <input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="auth-row">
          <div className="field">
            <label>اسم الحملة <span className="req">*</span></label>
            <input type="text" placeholder="مثال: دروب الإيمان" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
          </div>
          <div className="field ltr">
            <label>رقم الجوال</label>
            <input type="tel" inputMode="tel" placeholder="05xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <div className="field ltr">
          <label>كلمة المرور <span className="req">*</span></label>
          <input type="password" autoComplete="new-password" placeholder="٦ أحرف على الأقل" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
        </div>

        <label className="checkbox-group">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>أوافق على <Link to="/">الشروط والأحكام</Link> و<Link to="/">سياسة الخصوصيّة</Link></span>
        </label>

        {err && <div className="alert err">{err}</div>}
        {info && <div className="alert ok">{info}</div>}

        <button className="btn btn-em btn-block" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : 'إنشاء حساب'}
        </button>
      </form>
    </AuthShell>
  )
}
