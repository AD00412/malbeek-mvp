import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../app/useAuth'
import { useUI } from '../lib/useUI'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import ImageUpload from './ImageUpload'
import { slugify, isValidSlug } from '../lib/slug'

/**
 * إعدادات الحساب — ٣ تبويباتٍ: الملف الشخصيّ، حملتك (للمشتركين)، الهويّة البصريّة.
 * يستخدم BottomSheet (آمنٌ بعد إصلاح iOS) ليكون كثيرَ المحتوى لكن مُنظَّمًا.
 */
export default function SettingsSheet({ open, onClose, sub, onSubChanged }) {
  const { profile, user, refreshProfile, role } = useAuth()
  const { toast } = useUI()
  const [tab, setTab] = useState('profile')   // profile | org | brand
  const [busy, setBusy] = useState(false)

  // الملف الشخصيّ
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')

  // الحملة
  const [orgName, setOrgName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugErr, setSlugErr] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [storeUrl, setStoreUrl] = useState('')
  const [licenseNo, setLicenseNo] = useState('')

  // الهويّة
  const [logoUrl, setLogoUrl] = useState('')
  const [stampUrl, setStampUrl] = useState('')

  useEffect(() => {
    if (!open) return
    setFullName(profile?.full_name || '')
    setPhone(profile?.phone || '')
    setOrgName(sub?.org_name || '')
    setSlug(sub?.slug || '')
    setSlugErr('')
    setContactPhone(sub?.contact_phone || '')
    setStoreUrl(sub?.store_url || '')
    setLicenseNo(sub?.license_no || '')
    setLogoUrl(sub?.logo_url || '')
    setStampUrl(sub?.stamp_url || '')
    setTab('profile')
  }, [open, profile, sub])

  async function saveProfile() {
    if (busy) return
    setBusy(true)
    const { error } = await supabase.from('profiles')
      .update({ full_name: fullName.trim() || null, phone: phone.trim() || null })
      .eq('id', user.id)
    setBusy(false)
    if (error) toast('تعذّر الحفظ: ' + error.message, { type: 'error' })
    else { toast('حُفظ الملف الشخصيّ ✓', { type: 'success' }); refreshProfile?.() }
  }

  async function saveOrg() {
    if (busy || !sub?.id) return
    setSlugErr('')
    const safeSlug = (slug || '').trim().toLowerCase()
    if (safeSlug && !isValidSlug(safeSlug)) {
      setSlugErr('الرابط يجب أن يكون ٤–٤٠ حرفًا — حروف لاتينيّة صغيرة وأرقام وشُرَط، ولا يبدأ/ينتهي بشُرطة.')
      return
    }
    setBusy(true)
    const payload = {
      org_name: orgName.trim(),
      contact_phone: contactPhone.trim() || null,
      store_url: storeUrl.trim() || null,
      license_no: licenseNo.trim() || null,
    }
    // نُحدِّث الـ slug فقط إن تغيّر — لتجنّب توليد خطأٍ بسبب الفريديّة (unique).
    if (safeSlug && safeSlug !== sub.slug) payload.slug = safeSlug
    const { error } = await supabase.from('subscribers').update(payload).eq('id', sub.id)
    setBusy(false)
    if (error) {
      if (error.code === '23505') setSlugErr('هذا الرابط محجوزٌ لحملةٍ أخرى — جرّب اسمًا مختلفًا.')
      else toast('تعذّر الحفظ: ' + error.message, { type: 'error' })
      return
    }
    toast('حُفظت بيانات الحملة ✓', { type: 'success' })
    onSubChanged?.()
  }

  async function saveBrand() {
    if (busy || !sub?.id) return
    setBusy(true)
    const { error } = await supabase.from('subscribers')
      .update({ logo_url: logoUrl.trim() || null, stamp_url: stampUrl.trim() || null })
      .eq('id', sub.id)
    setBusy(false)
    if (error) toast('تعذّر الحفظ: ' + error.message, { type: 'error' })
    else { toast('حُفظت الهويّة البصريّة ✓', { type: 'success' }); onSubChanged?.() }
  }

  const showOrg = role === 'subscriber' && sub?.id

  return (
    <BottomSheet open={open} onClose={onClose} title="إعدادات الحساب">
      {/* شريط التبويب */}
      <div className="bus-tabs" style={{ marginBottom: 16 }}>
        <button className={`bus-tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>
          <Icon name="customers" size={14} /> الملف الشخصيّ
        </button>
        {showOrg && (
          <>
            <button className={`bus-tab ${tab === 'org' ? 'active' : ''}`} onClick={() => setTab('org')}>
              <Icon name="building" size={14} /> الحملة
            </button>
            <button className={`bus-tab ${tab === 'brand' ? 'active' : ''}`} onClick={() => setTab('brand')}>
              <Icon name="sparkle" size={14} /> الهويّة
            </button>
          </>
        )}
      </div>

      {/* الملف الشخصيّ */}
      {tab === 'profile' && (
        <div className="form">
          <div className="field">
            <label>الاسم الكامل</label>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="اسمك الكامل" />
          </div>
          <div className="field">
            <label>رقم الجوال</label>
            <input type="tel" inputMode="tel" className="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05XXXXXXXX" />
          </div>
          <div className="field">
            <label>البريد الإلكتروني</label>
            <input type="email" className="ltr" value={user?.email || ''} disabled
              style={{ opacity: 0.7, cursor: 'not-allowed' }} />
            <span className="muted" style={{ fontSize: 11, marginTop: 4 }}>لا يمكن تغيير البريد من هنا حاليًّا.</span>
          </div>
          <button className="btn btn-gold btn-block" onClick={saveProfile} disabled={busy}>
            {busy ? <span className="spinner" /> : <><Icon name="check" size={15} /> حفظ التغييرات</>}
          </button>
        </div>
      )}

      {/* بيانات الحملة */}
      {tab === 'org' && showOrg && (
        <div className="form">
          <div className="field">
            <label>اسم الحملة / المؤسسة</label>
            <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="اسم حملتك" />
          </div>

          {/* اختصارُ الرابط — مشتقٌّ من اسم الحملة بترجمةٍ ذكيّة. لا /j/ — رابطٌ مباشر. */}
          <div className="field">
            <label>رابط الحجز المختصر</label>
            <div className="slug-input">
              <span className="slug-prefix">{typeof window !== 'undefined' ? window.location.host : 'mulabeek.com'}/</span>
              <input type="text" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck="false"
                className="slug-field"
                value={slug}
                onChange={(e) => { setSlug(slugify(e.target.value)); setSlugErr('') }}
                placeholder="safwa-rahman" dir="ltr" />
            </div>
            {slugErr ? (
              <p style={{ fontSize: 11.5, marginTop: 6, color: 'var(--danger-ink)' }}>{slugErr}</p>
            ) : (
              <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                مشتقٌّ ذكيًّا من اسم حملتك (مثلًا «صفوة الرحمن» ← <code className="ltr link-chip">safwa-rahman</code>) — مشاركةٌ أسهل وتذكُّرٌ أسرع.
              </p>
            )}
          </div>

          <div className="field">
            <label>رقم تواصل الحملة (للمعتمرين)</label>
            <input type="tel" inputMode="tel" className="ltr" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="05XXXXXXXX" />
          </div>
          <div className="field">
            <label>رابط متجر الدفع (زِد / سلّة)</label>
            <input type="url" className="ltr" value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://store.example.com/..." />
          </div>
          <div className="field">
            <label>رقم التصريح / الترخيص</label>
            <input type="text" value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} placeholder="رقم التصريح" />
          </div>
          <button className="btn btn-gold btn-block" onClick={saveOrg} disabled={busy || !orgName.trim()}>
            {busy ? <span className="spinner" /> : <><Icon name="check" size={15} /> حفظ التغييرات</>}
          </button>
        </div>
      )}

      {/* الهويّة البصريّة — رفعٌ مباشرٌ من مكتبة الجوال/الكمبيوتر */}
      {tab === 'brand' && showOrg && (
        <div className="form">
          <ImageUpload
            subscriberId={sub.id}
            value={logoUrl}
            onChange={setLogoUrl}
            label="شعار الحملة"
            slot="logo"
            hint="PNG / JPG / WebP — يظهر في الكشف الرسميّ والتذكرة."
          />
          <ImageUpload
            subscriberId={sub.id}
            value={stampUrl}
            onChange={setStampUrl}
            label="الختم الإلكترونيّ (PNG شفّاف يُفضَّل)"
            slot="stamp"
            hint="أفضل صيغة PNG شفّافٍ للحصول على أفضل مظهر في الكشف."
          />
          <div className="alert info">
            تُستخدم الهويّة البصريّة في الكشف الرسميّ والتذكرة بدل علامة ملبّيك — حملتك تظهر بهويّتها الخاصّة.
          </div>
          <button className="btn btn-gold btn-block" onClick={saveBrand} disabled={busy}>
            {busy ? <span className="spinner" /> : <><Icon name="check" size={15} /> حفظ التغييرات</>}
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
