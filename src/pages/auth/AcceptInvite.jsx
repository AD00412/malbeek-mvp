import { useState, useEffect, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import { translateRpcError } from '../../lib/rpcErrors'
import { cleanName, fmtDateTime } from '../../lib/format'
import AuthShell from './AuthShell'
import Icon from '../../components/Icon'
import { ScreenLoader } from '../../app/RequireAuth'

const ROLE_AR = {
  admin:   'أدمن — صلاحية كاملة',
  support: 'دعم — قراءة والرد على الرسائل',
}

const STATUS_MSG = {
  not_found:          'لم نجد هذه الدعوة. ربما الرابط خاطئ أو ألغاها الأدمن.',
  expired:            'انتهت صلاحية الدعوة. اطلب من الأدمن دعوة جديدة.',
  cancelled:          'ألغيت هذه الدعوة.',
  rejected_documents: 'بعد مراجعة الوثائق، اعتذر عن قبول دعوتك.',
  rejected_interview: 'بعد المقابلة، اعتذر عن قبول دعوتك.',
  active:             'دورك مفعل. سجل دخولك من mulabeek.com/login.',
}

const ACCEPT_TYPES = 'application/pdf,image/jpeg,image/jpg,image/png'
const MAX_BYTES = 5 * 1024 * 1024
const MAX_QUALS = 5

export default function AcceptInvite() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { session, user } = useAuth()

  const [resolving, setResolving] = useState(true)
  const [info, setInfo] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')

  // signup form
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  // application form (submitted)
  const [appPhone, setAppPhone] = useState('')
  const [appNationalId, setAppNationalId] = useState('')
  const [appAddress, setAppAddress] = useState('')
  const [appDob, setAppDob] = useState('')
  const [appMessage, setAppMessage] = useState('')
  const [idCardFile, setIdCardFile] = useState(null)
  const [cvFile, setCvFile] = useState(null)
  const [qualFiles, setQualFiles] = useState([])

  // onboarding form (final_approved)
  const [emergencyContact, setEmergencyContact] = useState('')
  const [bankIban, setBankIban] = useState('')
  const [onboardNotes, setOnboardNotes] = useState('')

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const idRef = useRef(null)
  const cvRef = useRef(null)
  const qualRef = useRef(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await supabase.rpc('get_invitation_info', { p_token: token })
      if (!active) return
      if (error) { setStatusMsg('تعذر التحقق من الدعوة. جرب لاحقا.'); setResolving(false); return }
      const row = Array.isArray(data) ? data[0] : data
      if (!row || row.status === 'not_found') setStatusMsg(STATUS_MSG.not_found)
      else {
        setInfo(row)
        if (STATUS_MSG[row.status]) setStatusMsg(STATUS_MSG[row.status])
        else if (!row.is_valid && row.status === 'pending') setStatusMsg(STATUS_MSG.expired)
      }
      setResolving(false)
    })()
    return () => { active = false }
  }, [token])

  const matchesEmail = !!(session && user?.email && info?.email &&
    user.email.toLowerCase() === info.email.toLowerCase())

  function validateFile(f, label) {
    if (!f) return null
    if (f.size > MAX_BYTES) return `${label}: حجم يتجاوز ٥ ميجابايت.`
    if (!ACCEPT_TYPES.split(',').includes(f.type)) return `${label}: نوع غير مدعوم (PDF/JPG/PNG فقط).`
    return null
  }

  async function uploadFile(file, kind, idx) {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    const path = `${user.id}/${kind}-${Date.now()}${idx != null ? '-' + idx : ''}.${ext}`
    const { error } = await supabase.storage.from('staff-applications')
      .upload(path, file, { upsert: false, contentType: file.type })
    if (error) throw new Error(`رفع ${kind} فشل: ` + error.message)
    return path
  }

  async function signUpAndPrep(e) {
    e.preventDefault()
    if (busy) return
    if (cleanName(fullName).split(/\s+/).filter(Boolean).length < 2) {
      setErr('اكتب اسمك الكامل (الاسم الأول + الأخير على الأقل).'); return
    }
    if (password.length < 8) { setErr('كلمة المرور ٨ أحرف على الأقل.'); return }
    setErr(''); setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: info.email,
      password,
      options: { data: { role: 'subscriber', full_name: cleanName(fullName) } },
    })
    if (error) {
      setBusy(false)
      if (/already registered|already been registered/i.test(error.message)) {
        setErr('هذا البريد مسجل — سجل دخولك بنفس البريد ثم ارجع لهذه الصفحة.')
      } else setErr(translateRpcError(error, 'تعذر إنشاء الحساب.'))
      return
    }
    setBusy(false)
    if (!data.session) setErr('أنشأنا حسابك. فعل بريدك ثم ارجع لهذا الرابط.')
  }

  async function submitApplication(e) {
    e.preventDefault()
    if (busy) return
    setErr('')
    if (appPhone.replace(/\D/g, '').length < 8) return setErr('رقم جوال غير صحيح.')
    if (appNationalId.replace(/\D/g, '').length < 8) return setErr('رقم الهوية الوطنية غير صحيح.')
    if (!idCardFile) return setErr('أرفق صورة الهوية الوطنية.')
    if (!cvFile) return setErr('أرفق سيرتك الذاتية.')
    for (const f of [idCardFile, cvFile, ...qualFiles]) {
      const e2 = validateFile(f, f === idCardFile ? 'الهوية' : f === cvFile ? 'السيرة' : 'شهادة')
      if (e2) return setErr(e2)
    }
    setBusy(true); setProgress('رفع الوثائق…')
    try {
      const idPath = await uploadFile(idCardFile, 'id')
      const cvPath = await uploadFile(cvFile, 'cv')
      const qualPaths = []
      for (let i = 0; i < qualFiles.length; i++) {
        qualPaths.push(await uploadFile(qualFiles[i], 'qual', i))
      }
      setProgress('حفظ النموذج…')
      const { error } = await supabase.rpc('submit_staff_invitation', {
        p_token: token,
        p_full_name: cleanName(info.applicant_full_name || user?.user_metadata?.full_name || ''),
        p_phone: appPhone.trim(),
        p_message: appMessage.trim() || null,
        p_national_id: appNationalId.trim(),
        p_id_card_url: idPath,
        p_cv_url: cvPath,
        p_qual_urls: qualPaths,
        p_address: appAddress.trim() || null,
        p_dob: appDob || null,
      })
      if (error) throw error
      setDone(true)
    } catch (e2) {
      setErr(translateRpcError(e2, 'تعذر إرسال الطلب.'))
    } finally {
      setBusy(false); setProgress('')
    }
  }

  async function submitOnboarding(e) {
    e.preventDefault()
    if (busy) return
    setErr('')
    if (emergencyContact.trim().length < 5) return setErr('اكتب جهة اتصال للطوارئ.')
    setBusy(true)
    const { error } = await supabase.rpc('complete_invitation_onboarding', {
      p_token: token,
      p_emergency_contact: emergencyContact.trim(),
      p_bank_iban: bankIban.trim() || null,
      p_notes: onboardNotes.trim() || null,
    })
    setBusy(false)
    if (error) { setErr(translateRpcError(error, 'تعذر حفظ النموذج.')); return }
    setDone(true)
  }

  if (resolving) return <ScreenLoader label="نتحقق من الدعوة…" />

  // حالات مغلقة
  if (statusMsg && !info) {
    return <AuthShell title="دعوة غير صالحة" sub={statusMsg}
      footer={<Link to="/">العودة للرئيسية</Link>} />
  }
  if (info && ['rejected_documents','rejected_interview','cancelled','expired','active'].includes(info.status)) {
    return <AuthShell title="حالة الدعوة" sub={statusMsg || STATUS_MSG[info.status]}
      footer={info.status === 'active'
        ? <Link to="/login">تسجيل الدخول →</Link>
        : <Link to="/">العودة للرئيسية</Link>} />
  }

  // ١) لا جلسة → سجل/ادخل
  if (!session) {
    return (
      <AuthShell
        title="دعوة للانضمام لفريق ملبّيك"
        sub={`بصفة: ${ROLE_AR[info.invited_role] || info.invited_role}`}
      >
        <div className="alert" style={{ marginBottom: 12, background: 'var(--info-bg)', color: 'var(--info-ink)' }}>
          <strong>الإيميل المدعو:</strong> <span className="ltr">{info.email}</span>
        </div>
        <form onSubmit={signUpAndPrep} className="form">
          <div className="field">
            <label>الاسم الكامل</label>
            <input value={fullName} onChange={e => setFullName(e.target.value)}
                   placeholder="الاسم الأول + الأخير" required />
          </div>
          <div className="field">
            <label>كلمة مرور</label>
            <div className="input-with-action">
              <input type={showPw ? 'text' : 'password'}
                     value={password} onChange={e => setPassword(e.target.value)}
                     minLength={8} required />
              <button type="button" className="input-action" onClick={() => setShowPw(s => !s)}>
                {showPw ? 'إخفاء' : 'إظهار'}
              </button>
            </div>
          </div>
          {err && <div className="alert err">{err}</div>}
          <button className="btn btn-em" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : 'إنشاء حساب والمتابعة'}
          </button>
          <div className="auth-footer-text" style={{ marginTop: 12 }}>
            لديك حساب مسبق بهذا الإيميل؟ <Link to={`/login?next=/invite/${token}`}>سجل دخولك</Link>
          </div>
        </form>
      </AuthShell>
    )
  }

  // ٢) جلسة بإيميل مختلف
  if (!matchesEmail) {
    return (
      <AuthShell
        title="إيميل غير مطابق"
        sub={`الدعوة لـ ${info.email} لكنك سجلت دخولك بـ ${user?.email || '—'}.`}
      >
        <div className="alert err" style={{ marginBottom: 12 }}>
          سجل خروجك ثم ادخل بالإيميل المدعو.
        </div>
        <button className="btn" onClick={async () => { await supabase.auth.signOut(); location.reload() }}>
          تسجيل الخروج
        </button>
      </AuthShell>
    )
  }

  // ٣) submitted / prelim_approved / interview_done — عرض حالة
  if (['submitted','prelim_approved','interview_done'].includes(info.status)) {
    return (
      <AuthShell title="طلبك تحت المراجعة"
        sub={info.status === 'submitted'
          ? 'استلمنا وثائقك. ستراجعها الإدارة وستصلك رسالة بنتيجة المراجعة الأولية.'
          : info.status === 'prelim_approved'
          ? 'موافقة مبدئية ✓ — موعد مقابلتك أدناه.'
          : 'انتهت المقابلة. بانتظار القرار النهائي.'}
      >
        {info.status === 'prelim_approved' && info.interview_at && (
          <div className="alert ok" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>🗓 موعد المقابلة</div>
            <div style={{ marginTop: 6 }}>{fmtDateTime(info.interview_at)}</div>
            {info.interview_location && <div style={{ marginTop: 4 }}>📍 {info.interview_location}</div>}
            {info.interview_notes && <div className="muted" style={{ marginTop: 4 }}>{info.interview_notes}</div>}
          </div>
        )}
        <Link to="/" className="btn">العودة للرئيسية</Link>
      </AuthShell>
    )
  }

  // ٤) final_approved → نموذج التوظيف الإداري
  if (info.status === 'final_approved') {
    if (done) return (
      <AuthShell title="استلمنا نموذجك ✓"
        sub="بانتظار التفعيل النهائي من المدير. ستصلك رسالة عند جاهزية حسابك."
        footer={<Link to="/">العودة للرئيسية</Link>} />
    )
    return (
      <AuthShell title="نموذج التوظيف الإداري"
        sub="هنيئا 🎉 قبول نهائي — أكمل البيانات التعاقدية:">
        <form onSubmit={submitOnboarding} className="form">
          <div className="field">
            <label>جهة اتصال للطوارئ <span className="muted">(اسم + رقم)</span></label>
            <input value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} required />
          </div>
          <div className="field ltr">
            <label>IBAN للراتب <span className="muted">(اختياري، يمكن تعبئته لاحقا)</span></label>
            <input value={bankIban} onChange={e => setBankIban(e.target.value)} placeholder="SAxx..." />
          </div>
          <div className="field">
            <label>ملاحظات إضافية</label>
            <textarea rows={3} value={onboardNotes} onChange={e => setOnboardNotes(e.target.value)} />
          </div>
          {err && <div className="alert err">{err}</div>}
          <button className="btn btn-em" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : 'إرسال النموذج'}
          </button>
        </form>
      </AuthShell>
    )
  }

  // ٥) onboarded → ينتظر التفعيل
  if (info.status === 'onboarded') {
    return (
      <AuthShell title="بانتظار التفعيل"
        sub="أكملت نموذج التوظيف ✓ ستصلك رسالة تفعيل من المدير قريبا."
        footer={<Link to="/">العودة للرئيسية</Link>} />
    )
  }

  // ٦) pending → نموذج التقديم بالوثائق
  if (done) return (
    <AuthShell title="استلمنا طلبك ✓"
      sub="ستراجع الإدارة وثائقك خلال ٢-٥ أيام عمل. ستصلك رسالة بقرار المراجعة الأولية."
      footer={<Link to="/">العودة للرئيسية</Link>} />
  )

  return (
    <AuthShell title="نموذج طلب التوظيف"
      sub={`الدور المقترح: ${ROLE_AR[info.invited_role] || info.invited_role}`}
    >
      <div className="alert" style={{ marginBottom: 12, background: 'var(--info-bg)', color: 'var(--info-ink)' }}>
        ⚠️ كل الحقول والوثائق مطلوبة — لن نتمكن من المراجعة بدونها.
      </div>
      <form onSubmit={submitApplication} className="form">
        <div className="sec-label">١) بيانات شخصية</div>
        <div className="field ltr">
          <label>رقم الجوال</label>
          <input type="tel" value={appPhone} onChange={e => setAppPhone(e.target.value)}
                 placeholder="+9665XXXXXXXX" required />
        </div>
        <div className="grid-2">
          <div className="field ltr">
            <label>رقم الهوية الوطنية</label>
            <input value={appNationalId} onChange={e => setAppNationalId(e.target.value)}
                   maxLength={12} required />
          </div>
          <div className="field">
            <label>تاريخ الميلاد <span className="muted">(اختياري)</span></label>
            <input type="date" value={appDob} onChange={e => setAppDob(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>العنوان <span className="muted">(مدينة + حي)</span></label>
          <input value={appAddress} onChange={e => setAppAddress(e.target.value)} />
        </div>

        <div className="sec-label">٢) الوثائق</div>
        <div className="field">
          <label>صورة الهوية الوطنية <span style={{ color: 'var(--danger-ink)' }}>*</span></label>
          <input ref={idRef} type="file" accept={ACCEPT_TYPES}
                 onChange={e => setIdCardFile(e.target.files?.[0] || null)} required />
          {idCardFile && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {idCardFile.name} ({(idCardFile.size/1024).toFixed(0)} KB)
          </div>}
        </div>
        <div className="field">
          <label>السيرة الذاتية (PDF) <span style={{ color: 'var(--danger-ink)' }}>*</span></label>
          <input ref={cvRef} type="file" accept={ACCEPT_TYPES}
                 onChange={e => setCvFile(e.target.files?.[0] || null)} required />
          {cvFile && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {cvFile.name} ({(cvFile.size/1024).toFixed(0)} KB)
          </div>}
        </div>
        <div className="field">
          <label>الشهادات والمؤهلات <span className="muted">(حتى ٥ ملفات، اختياري)</span></label>
          <input ref={qualRef} type="file" accept={ACCEPT_TYPES} multiple
                 onChange={e => {
                   const fs = Array.from(e.target.files || []).slice(0, MAX_QUALS)
                   setQualFiles(fs)
                 }} />
          {qualFiles.length > 0 && (
            <ul className="muted" style={{ fontSize: 11, marginTop: 4, paddingInlineStart: 16 }}>
              {qualFiles.map((f, i) => <li key={i}>{f.name} ({(f.size/1024).toFixed(0)} KB)</li>)}
            </ul>
          )}
        </div>

        <div className="sec-label">٣) رسالة تعريفية</div>
        <div className="field">
          <label>اذكر خبراتك وما يؤهلك للدور <span className="muted">(اختياري)</span></label>
          <textarea rows={4} value={appMessage} onChange={e => setAppMessage(e.target.value)} />
        </div>

        {err && <div className="alert err">{err}</div>}
        {progress && <div className="alert" style={{ background: 'var(--info-bg)', color: 'var(--info-ink)' }}>{progress}</div>}
        <button className="btn btn-em" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : 'إرسال الطلب للمراجعة'}
        </button>
        <div className="hint" style={{ marginTop: 8 }}>
          بإرسال الطلب، توافق على مراجعة وثائقك بسرية من قبل إدارة ملبّيك.
        </div>
      </form>
    </AuthShell>
  )
}
