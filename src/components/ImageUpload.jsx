import { useState, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { safeExt } from '../lib/format'
import Icon from './Icon'

/**
 * رفع صورةٍ (ختم/شعار) إلى Supabase Storage في `org-assets/<subscriber_id>/<filename>`.
 * يقبل ملفًّا من الجوال أو الكمبيوتر، يعرض معاينةً ذكيّة، ويُرجع الرابط العامّ.
 *
 * @param {string}   subscriberId   معرّف الحملة (يستخدم كاسم مجلّدٍ في الـ bucket)
 * @param {string}   value          الرابط الحاليّ (للعرض)
 * @param {Function} onChange       (newUrl) => void
 * @param {string}   label          تسمية الحقل
 * @param {string}   slot           اسم اللاحقة في الملفّ: 'stamp' | 'logo' | غيرها
 * @param {string}   hint           نصُّ مساعدةٍ صغير
 */
export default function ImageUpload({ subscriberId, value, onChange, label, slot = 'image', hint }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)

  async function handleFile(file) {
    if (!file) return
    if (!subscriberId) { setErr('تعذّر تحديد الحملة. حدّث الصفحة.'); return }
    const okTypes = ['image/png', 'image/jpeg', 'image/webp']
    if (!okTypes.includes(file.type)) { setErr('الصيغة غير مدعومة. استخدم PNG / JPG / WebP.'); return }
    if (file.size > 2 * 1024 * 1024) { setErr('حجم الملفّ كبير (٢ ميغابايت بحدٍّ أقصى).'); return }

    setBusy(true); setErr('')
    try {
      const ext = safeExt(file)
      const path = `${subscriberId}/${slot}-${Date.now()}.${ext}`
      const { error } = await supabase.storage
        .from('org-assets')
        .upload(path, file, { upsert: true, cacheControl: '3600', contentType: file.type })
      if (error) throw error
      const { data: pub } = supabase.storage.from('org-assets').getPublicUrl(path)
      onChange?.(pub.publicUrl)
    } catch (e) {
      setErr('تعذّر الرفع: ' + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  function pick() { fileRef.current?.click() }
  function clear() { onChange?.(null); setErr('') }

  return (
    <div className="field">
      {label && <label>{label}</label>}
      {/* بدون capture: iOS Safari يعرض قائمةً بثلاثة خياراتٍ (مكتبة الصور / التقاط صورة / اختيار ملفّ)
          بدل فتح الكاميرا مباشرةً — تجربةٌ أكثر مرونةً ومطابقةٌ لتوقّعات المستخدم. */}
      <input
        ref={fileRef} type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {value ? (
        <div className="img-upload preview">
          <img src={value} alt={label || ''} />
          <div className="img-upload-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={pick} disabled={busy}>
              {busy ? <span className="spinner" /> : <><Icon name="refresh" size={14} /> استبدال</>}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={busy} style={{ color: 'var(--danger)' }}>
              <Icon name="trash" size={14} /> حذف
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="img-upload dropzone" onClick={pick} disabled={busy || !subscriberId}>
          {busy ? <span className="spinner" /> : (
            <>
              <Icon name="download" size={22} style={{ transform: 'rotate(180deg)' }} />
              <strong>اختر صورةً من جهازك</strong>
              <span className="muted" style={{ fontSize: 12 }}>الجوّال أو الكمبيوتر · PNG / JPG / WebP · ٢ ميغابايت كحدٍّ أقصى</span>
            </>
          )}
        </button>
      )}
      {hint && !err && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{hint}</p>}
      {err && <div className="alert err" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  )
}
