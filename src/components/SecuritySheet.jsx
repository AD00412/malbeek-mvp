import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../app/useAuth'
import { useUI } from '../lib/useUI'
import Icon from './Icon'
import BottomSheet from './BottomSheet'
import PasswordStrengthMeter from './PasswordStrengthMeter'
import { scorePassword } from '../lib/passwordStrength'

function fmtDate(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }) } catch { return '—' }
}

/**
 * مركزُ أمان الحساب — لكل الأدوار.
 *  المستوى ١: تغيير كلمة المرور (بإعادة مصادقة) · حالةُ تأكيد البريد + إعادة الإرسال ·
 *             تحذيرُ كلمات المرور المسرّبة/الضعيفة (HaveIBeenPwned عبر Supabase) ·
 *             إدارةُ الجلسات (خروجٌ من كل الأجهزة) + آخر دخول.
 *  المستوى ٢: مصادقةٌ ثنائيّة TOTP (تسجيل QR + تحقّق).
 *  المستوى ٣: تحقّقُ الجوال (SMS OTP) — واجهةٌ بتفعيلٍ موقوف (يحتاج مزوّدًا).
 */
export default function SecuritySheet({ open, onClose }) {
  const { user } = useAuth()
  const { toast, confirm } = useUI()
  const email = user?.email || ''
  const emailConfirmed = !!(user?.email_confirmed_at || user?.confirmed_at)

  // ── تغيير كلمة المرور ──
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState('')

  async function changePassword(e) {
    e.preventDefault(); setPwErr('')
    const s = scorePassword(newPw)
    if (!s.ok) return setPwErr('كلمة المرور الجديدة ضعيفة — ' + (s.suggestions[0] || 'قوِّها'))
    if (newPw !== pw2) return setPwErr('تأكيد كلمة المرور لا يطابق.')
    if (newPw === curPw) return setPwErr('اختر كلمة مرورٍ مختلفةً عن الحالية.')
    setPwBusy(true)
    // إعادة مصادقة: نتحقّق من كلمة المرور الحالية أولًا
    const { error: reauthErr } = await supabase.auth.signInWithPassword({ email, password: curPw })
    if (reauthErr) { setPwBusy(false); return setPwErr('كلمة المرور الحالية غير صحيحة.') }
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setPwBusy(false)
    if (error) {
      const m = String(error.message || '')
      if (/pwned|leaked|compromise/i.test(m)) {
        return setPwErr('🔓 هذه الكلمة ظهرت في تسريباتٍ معروفة — اختر كلمةً فريدةً لم تستخدمها في موقعٍ آخر.')
      }
      return setPwErr(/weak|at least/i.test(m) ? 'كلمة المرور ضعيفةٌ جدًّا.' : 'تعذّر التغيير — حاول مجددًا.')
    }
    setCurPw(''); setNewPw(''); setPw2('')
    toast('تم تغيير كلمة المرور بنجاح ✓', { type: 'success' })
  }

  async function resendConfirm() {
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    toast(error ? 'تعذّر الإرسال — حاول لاحقًا.' : 'أرسلنا رابط التأكيد إلى بريدك ✓', { type: error ? 'error' : 'success' })
  }

  async function signOutEverywhere() {
    const ok = await confirm({
      title: 'خروج من كل الأجهزة',
      message: 'سيُسجَّل خروجُك من كل الأجهزة والجلسات. ستحتاج لتسجيل الدخول من جديد. متابعة؟',
      confirmText: 'خروج من الكل', danger: true,
    })
    if (!ok) return
    await supabase.auth.signOut({ scope: 'global' })
    window.location.href = '/login'
  }

  // ── المصادقة الثنائية (TOTP) ──
  const [factors, setFactors] = useState([])
  const [mfaLoading, setMfaLoading] = useState(true)
  const [enroll, setEnroll] = useState(null)   // { factorId, qr, secret }
  const [otp, setOtp] = useState('')
  const [mfaBusy, setMfaBusy] = useState(false)
  const [mfaErr, setMfaErr] = useState('')

  const loadFactors = useCallback(async () => {
    setMfaLoading(true)
    const { data } = await supabase.auth.mfa.listFactors()
    setFactors(data?.totp || [])
    setMfaLoading(false)
  }, [])
  useEffect(() => { if (open) loadFactors() }, [open, loadFactors])

  async function startEnroll() {
    setMfaErr('')
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `ملبّيك ${Date.now()}` })
    if (error) return setMfaErr('تعذّر بدء التسجيل — حاول مجددًا.')
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  }
  async function verifyEnroll(e) {
    e.preventDefault(); setMfaErr(''); setMfaBusy(true)
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enroll.factorId })
    if (chErr) { setMfaBusy(false); return setMfaErr('تعذّر التحقّق — حاول مجددًا.') }
    const { error } = await supabase.auth.mfa.verify({ factorId: enroll.factorId, challengeId: ch.id, code: otp.trim() })
    setMfaBusy(false)
    if (error) return setMfaErr('الرمز غير صحيح — تأكّد من تطبيق المصادقة وأعد المحاولة.')
    setEnroll(null); setOtp('')
    toast('فُعِّلت المصادقة الثنائية ✓', { type: 'success' })
    loadFactors()
  }
  async function removeFactor(id) {
    const ok = await confirm({ title: 'إلغاء المصادقة الثنائية', message: 'سيُلغى التحقّق بخطوتين عن حسابك. متابعة؟', confirmText: 'إلغاء', danger: true })
    if (!ok) return
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id })
    if (error) return toast('تعذّر الإلغاء.', { type: 'error' })
    toast('أُلغيت المصادقة الثنائية.', { type: 'info' })
    loadFactors()
  }

  const verifiedFactors = factors.filter((f) => f.status === 'verified')

  return (
    <BottomSheet open={open} onClose={onClose} title="أمان الحساب">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ① كلمة المرور */}
        <section className="mlk-card" style={{ padding: 14 }}>
          <h3 className="mlk-h2" style={{ marginTop: 0 }}><Icon name="settings" size={15} /> تغيير كلمة المرور</h3>
          <form className="form" onSubmit={changePassword}>
            <div className="field">
              <label>كلمة المرور الحالية</label>
              <input type="password" autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)} required />
            </div>
            <div className="field">
              <label>كلمة المرور الجديدة</label>
              <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
              <PasswordStrengthMeter password={newPw} />
            </div>
            <div className="field">
              <label>تأكيد كلمة المرور الجديدة</label>
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            </div>
            {pwErr && <div className="alert err">{pwErr}</div>}
            <button type="submit" className="btn btn-em btn-block" disabled={pwBusy}>
              {pwBusy ? <span className="spinner" /> : <><Icon name="check" size={15} /> تغيير كلمة المرور</>}
            </button>
            <span className="hint">نحميك تلقائيًّا من كلمات المرور المسرّبة (HaveIBeenPwned) — لو ظهرت كلمتك في تسريب، سنطلب غيرها.</span>
          </form>
        </section>

        {/* ② البريد الإلكتروني */}
        <section className="mlk-card" style={{ padding: 14 }}>
          <h3 className="mlk-h2" style={{ marginTop: 0 }}><Icon name="mail" size={15} /> البريد الإلكتروني</h3>
          <div className="mlk-list-meta" style={{ alignItems: 'center' }}>
            <span className="ltr" style={{ color: 'var(--cr-100)' }}>{email}</span>
            <span className={`badge ${emailConfirmed ? 'ok' : 'warn'}`} style={{ marginInlineStart: 'auto' }}>
              {emailConfirmed ? 'مؤكَّد ✓' : 'غير مؤكَّد'}
            </span>
          </div>
          {!emailConfirmed && (
            <button className="mlk-action" style={{ marginTop: 10 }} onClick={resendConfirm}>
              <Icon name="mail" size={15} /> إعادة إرسال رابط التأكيد
            </button>
          )}
        </section>

        {/* ③ المصادقة الثنائية TOTP */}
        <section className="mlk-card" style={{ padding: 14 }}>
          <h3 className="mlk-h2" style={{ marginTop: 0 }}><Icon name="check" size={15} /> المصادقة الثنائية (TOTP)</h3>
          <p className="hint" style={{ marginTop: 0 }}>طبقةُ حمايةٍ ثانيةٌ عبر تطبيق مصادقة (Google Authenticator / Authy) — رمزٌ متغيّرٌ كل ٣٠ ثانية.</p>
          {mfaLoading ? <span className="hint">جارٍ التحميل…</span> : verifiedFactors.length > 0 ? (
            <div className="alert ok" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="check" size={15} /> <span>مفعّلة على حسابك.</span>
              <button className="mlk-action" style={{ marginInlineStart: 'auto' }} onClick={() => removeFactor(verifiedFactors[0].id)}>إلغاء</button>
            </div>
          ) : enroll ? (
            <form className="form" onSubmit={verifyEnroll}>
              <p className="hint">امسح الرمز بتطبيق المصادقة، ثم أدخل الرمز المكوّن من ٦ أرقام:</p>
              {enroll.qr && <img src={enroll.qr} alt="رمز QR للمصادقة" style={{ width: 180, height: 180, margin: '0 auto', display: 'block', background: '#fff', borderRadius: 10, padding: 8 }} />}
              <div className="field">
                <label>أو أدخل المفتاح يدويًّا</label>
                <code className="ltr" style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--cr-200)' }}>{enroll.secret}</code>
              </div>
              <div className="field">
                <label>الرمز (٦ أرقام)</label>
                <input type="text" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="000000" autoComplete="one-time-code" />
              </div>
              {mfaErr && <div className="alert err">{mfaErr}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-em" disabled={mfaBusy || otp.length !== 6}>{mfaBusy ? <span className="spinner" /> : 'تأكيد التفعيل'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setEnroll(null); setOtp(''); setMfaErr('') }}>إلغاء</button>
              </div>
            </form>
          ) : (
            <>
              {mfaErr && <div className="alert err">{mfaErr}</div>}
              <button className="btn btn-em btn-block" onClick={startEnroll}><Icon name="plus" size={15} /> تفعيل المصادقة الثنائية</button>
              <span className="hint">الرموز الاحتياطية للاسترداد قادمةٌ قريبًا (تتطلّب تخزينًا آمنًا في الخادم).</span>
            </>
          )}
        </section>

        {/* ④ الجلسات */}
        <section className="mlk-card" style={{ padding: 14 }}>
          <h3 className="mlk-h2" style={{ marginTop: 0 }}><Icon name="logout" size={15} /> الجلسات والنشاط</h3>
          <div className="mlk-list-meta"><span className="hint">آخر دخول: {fmtDate(user?.last_sign_in_at)}</span></div>
          <button className="mlk-action" style={{ marginTop: 10 }} onClick={signOutEverywhere}>
            <Icon name="logout" size={15} /> تسجيل الخروج من كل الأجهزة
          </button>
        </section>

        {/* ⑤ تحقّق الجوال — المستوى ٣ (موقوف، يحتاج مزوّدًا) */}
        <section className="mlk-card" style={{ padding: 14, opacity: .75 }}>
          <h3 className="mlk-h2" style={{ marginTop: 0 }}><Icon name="phone" size={15} /> تحقّق برقم الجوال (SMS)</h3>
          <p className="hint" style={{ marginTop: 0 }}>تحقّقٌ إضافيٌّ برمزٍ يُرسَل لجوالك.</p>
          <button className="btn btn-ghost btn-block" disabled aria-disabled="true" style={{ opacity: .6, cursor: 'not-allowed' }}>
            موقوف — يحتاج ربطَ مزوّد رسائل
          </button>
        </section>

        {/* ⑥ خارطة الطريق — المستوى ٤ */}
        <section className="mlk-card" style={{ padding: 14 }}>
          <h3 className="mlk-h2" style={{ marginTop: 0 }}><Icon name="sparkle" size={15} /> قريبًا</h3>
          <ul className="hint" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.9 }}>
            <li>الدخول ببصمة الوجه/Passkeys (WebAuthn).</li>
            <li>الدخول عبر «نفاذ» الوطنيّ (يتطلّب تسجيلًا رسميًّا).</li>
          </ul>
        </section>
      </div>
    </BottomSheet>
  )
}
