import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import AuthShell from './AuthShell'
import Icon from '../../components/Icon'
import { ScreenLoader } from '../../app/RequireAuth'
import { toLatinDigits, normalizePhone, cleanName, isValidNationalId, isValidSaPhone, isValidEmail, pwStrength, PW_LABEL } from '../../lib/format'

function arError(msg = '') {
  const m = msg.toLowerCase()
  if (m.includes('already registered') || m.includes('already been registered')) return 'هذا البريد مُسجّل مسبقًا. سجّل الدخول من صفحة الدخول.'
  if (m.includes('duplicate key') || msg.includes('uniq_customer')) return 'أنت مسجّلٌ بالفعل في هذه الحملة. ادخل حسابك.'
  if (m.includes('password')) return 'كلمة المرور ضعيفة (٦ أحرف على الأقل).'
  if (m.includes('network')) return 'تعذّر الاتصال بالخادم. حاول مرة أخرى.'
  // رسائل التحقّق العربية من تريغرات القاعدة تظهر كما هي
  if (/[؀-ۿ]/.test(msg)) return msg
  return 'تعذّر إنشاء الحساب. حاول مرة أخرى.'
}

// ——— قواعد التحقّق الحيّ (تطابق تريغرات القاعدة: دفاعٌ متعدّد الطبقات) ———
function btrimWords(v = '') {
  const t = v.trim()
  return t ? t.split(/\s+/).length : 0
}
function validators() {
  return {
    fullName: (v) => btrimWords(v) >= 2 || 'اكتب الاسم الرباعي كاملًا.',
    nationalId: (v) => isValidNationalId(v) || '١٠ أرقام تبدأ بـ ١ أو ٢.',
    phone: (v) => isValidSaPhone(v) || 'مثال: 05XXXXXXXX.',
    email: (v) => isValidEmail(v) || 'بريدٌ إلكترونيٌّ غير صحيح.',
    password: (v) => v.length >= 6 || '٦ أحرف على الأقل.',
  }
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
  const [pickupLocation, setPickupLocation] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [touched, setTouched] = useState({})
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  // تحويل الـ slug إلى حملة (عبر العرض العام)
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await supabase
        .rpc('subscriber_by_slug', { p_slug: slug })
        .maybeSingle()
      if (!active) return
      if (error || !data) { setNotFound(true) }
      else { setOrg(data) }
      setResolving(false)
    })()
    return () => { active = false }
  }, [slug])

  const vals = { fullName, nationalId, phone, email, password }
  const rules = useMemo(() => validators(), [])
  const errors = useMemo(() => {
    const out = {}
    for (const k of Object.keys(rules)) {
      const r = rules[k](vals[k])
      if (r !== true) out[k] = r
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullName, nationalId, phone, email, password])
  const allValid = Object.keys(errors).length === 0
  const strength = pwStrength(password)

  function markTouched(k) { setTouched((t) => ({ ...t, [k]: true })) }
  function fieldCls(k, extra = '') {
    return `field with-ic ${extra} ${touched[k] && errors[k] ? 'invalid' : ''}`.trim()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy || !org) return
    setTouched({ fullName: 1, nationalId: 1, phone: 1, email: 1, password: 1 })
    if (!allValid) { setErr('يُرجى تصحيح الحقول المظلّلة.'); return }
    setErr(''); setInfo(''); setBusy(true)

    const cleanFullName = cleanName(fullName)
    const cleanId = toLatinDigits(nationalId).trim()
    const cleanPhone = normalizePhone(phone)

    // 1) إنشاء حساب العميل مربوطًا بحملة هذا الرابط فقط
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          role: 'customer',
          full_name: cleanFullName,
          phone: cleanPhone,
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
      // 3) احفظ سجلّ المعتمر (ضمن حملته فقط — تتحقق منه سياسة RLS).
      //    قد لا يكون تريغر إنشاء الملف الشخصي قد اكتمل بعد، فتُرجع
      //    my_subscriber_id() قيمة null ويُرفض الإدراج؛ نُعيد المحاولة قليلًا.
      const insertCustomer = () => supabase.from('customers').insert({
        subscriber_id: org.id,
        profile_id: data.user.id,
        full_name: cleanFullName,
        national_id: cleanId,
        phone: cleanPhone,
        pickup_location: pickupLocation.trim() || null,
      })

      let insErr = (await insertCustomer()).error
      for (let i = 0; insErr && insErr.code !== '23505' && i < 4; i++) {
        await refreshProfile()                              // يحدّث profiles.subscriber_id محليًّا وفي القاعدة
        await new Promise((r) => setTimeout(r, 350 * (i + 1)))
        insErr = (await insertCustomer()).error
      }
      // 23505 = العميل مسجّلٌ مسبقًا في الحملة؛ نكمل للوحته بدل الفشل
      if (insErr && insErr.code !== '23505') throw insErr

      await refreshProfile()
      setBusy(false)
      navigate('/customer', { replace: true })
    } catch (e2) {
      setBusy(false)
      setErr(arError(typeof e2?.message === 'string' ? e2.message : ''))
    }
  }

  if (resolving) return <ScreenLoader label="جارٍ فتح صفحة التسجيل…" />

  if (notFound) {
    return (
      <AuthShell heading="رابطٌ غير صالح" blurb="هذا الرابط غير موجودٍ أو انتهت صلاحيته." points={[]}>
        <div className="join-state">
          <span className="join-state-ic warn"><Icon name="location" size={30} /></span>
          <h2 className="ttl">تعذّر العثور على الحملة</h2>
          <p className="desc">تأكّد من الرابط الذي وصلك من جهة الحملة، أو تواصل معهم لإعادة إرساله.</p>
        </div>
        <div className="auth-foot" style={{ marginTop: 24 }}>
          لديك حسابٌ بالفعل؟ <Link to="/login">تسجيل الدخول</Link>
        </div>
      </AuthShell>
    )
  }

  // حالة "تأكيد البريد" — عرضٌ مخصّص بدل التنبيه النحيف
  if (info) {
    return (
      <AuthShell
        heading={`التسجيل مع ${org.org_name}`}
        blurb="خطوةٌ أخيرةٌ تفصلك عن لوحتك."
        points={['تذكرة صعودٍ بالباركود', 'حجزٌ سريعٌ دون إعادة تعبئة', 'ترى رحلات حملتك فقط']}
      >
        <div className="join-success">
          <span className="join-success-ic"><Icon name="mail" size={34} /></span>
          <h2 className="ttl">تحقّق من بريدك</h2>
          <p className="desc">{info}</p>
          <Link to="/login" className="btn btn-gold btn-block" style={{ marginTop: 22 }}>
            <Icon name="check" size={16} /> الذهاب لتسجيل الدخول
          </Link>
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

      {/* بطاقة الحملة */}
      <div className="join-org">
        <span className="join-org-ic"><Icon name="building" size={20} /></span>
        <div>
          <div className="join-org-lbl">أنت تنضمّ إلى حملة</div>
          <div className="join-org-nm">{org.org_name}</div>
        </div>
      </div>

      {/* شريط المزايا — يظهر على الجوال حيث تختفي لوحة الفنّ */}
      <div className="join-benefits">
        <div className="li"><Icon name="barcode" size={16} /> تذكرة صعودٍ بالباركود</div>
        <div className="li"><Icon name="seat" size={16} /> حجزٌ سريعٌ دون إعادة تعبئة</div>
        <div className="li"><Icon name="building" size={16} /> ترى رحلات حملتك فقط</div>
      </div>

      <form className="form" onSubmit={handleSubmit} noValidate>
        <div className={fieldCls('fullName')}>
          <label>الاسم الرباعي</label>
          <span className="f-ic"><Icon name="user" size={17} /></span>
          <input type="text" placeholder="الاسم كما في الهوية" value={fullName}
            onChange={(e) => setFullName(e.target.value)} onBlur={() => markTouched('fullName')} required />
          {touched.fullName && errors.fullName && <span className="hint">{errors.fullName}</span>}
        </div>

        <div className={fieldCls('nationalId', 'ltr')}>
          <label>رقم الهوية / الإقامة</label>
          <span className="f-ic"><Icon name="badge" size={17} /></span>
          <input type="text" inputMode="numeric" placeholder="1xxxxxxxxx" value={nationalId}
            onChange={(e) => setNationalId(e.target.value)} onBlur={() => markTouched('nationalId')} required />
          {touched.nationalId && errors.nationalId && <span className="hint">{errors.nationalId}</span>}
        </div>

        <div className={fieldCls('phone', 'ltr')}>
          <label>رقم الجوال</label>
          <span className="f-ic"><Icon name="phone" size={17} /></span>
          <input type="tel" inputMode="tel" placeholder="05xxxxxxxx" value={phone}
            onChange={(e) => setPhone(e.target.value)} onBlur={() => markTouched('phone')} required />
          {touched.phone && errors.phone && <span className="hint">{errors.phone}</span>}
        </div>

        <div className="field with-ic">
          <label>مكان الركوب <span className="muted" style={{ fontSize: 12 }}>(اختياري)</span></label>
          <span className="f-ic"><Icon name="location" size={17} /></span>
          <input type="text" placeholder="مثال: محطّة جازان المركزيّة"
            value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} />
          <span className="hint" style={{ color: 'var(--cr-300)' }}>
            يُملأ تلقائيًّا في حجوزاتك القادمة — تستطيع تغييره عند الحجز.
          </span>
        </div>

        <div className={fieldCls('email', 'ltr')}>
          <label>البريد الإلكتروني</label>
          <span className="f-ic"><Icon name="mail" size={17} /></span>
          <input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email}
            onChange={(e) => setEmail(e.target.value)} onBlur={() => markTouched('email')} required />
          {touched.email && errors.email && <span className="hint">{errors.email}</span>}
        </div>

        <div className={fieldCls('password', 'ltr has-toggle')}>
          <label>كلمة المرور</label>
          <span className="f-ic"><Icon name="lock" size={17} /></span>
          <input type={showPw ? 'text' : 'password'} autoComplete="new-password" placeholder="٦ أحرف على الأقل"
            value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => markTouched('password')}
            minLength={6} required />
          <button type="button" className="pw-toggle" aria-label={showPw ? 'إخفاء' : 'إظهار'}
            onClick={() => setShowPw((s) => !s)}>
            <Icon name={showPw ? 'eyeOff' : 'eye'} size={17} />
          </button>
          {password && (
            <div className={`pw-meter s${strength}`} aria-hidden="true"><i /><i /><i />
              <span className="pw-lbl">{PW_LABEL[strength]}</span>
            </div>
          )}
          {touched.password && errors.password && <span className="hint">{errors.password}</span>}
        </div>

        {err && <div className="alert err">{err}</div>}

        <button className="btn btn-gold" type="submit" disabled={busy || !allValid}>
          {busy ? <span className="spinner" /> : <><Icon name="check" size={16} /> تسجيل ودخول</>}
        </button>
      </form>

      <div className="auth-foot">
        سجّلت سابقًا؟ <Link to="/login">ادخل حسابك</Link>
      </div>
    </AuthShell>
  )
}
