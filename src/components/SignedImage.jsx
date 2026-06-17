import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'

/**
 * يعرض صورةً مخزَّنةً في bucket خاصٍّ عبر signed URL مؤقّتٍ، مع تنظيفٍ على
 * إلغاء التحميل وحالة "جارٍ التحميل…" قبل وصول الرابط.
 *
 * يُفضَّل تمرير `presignedUrl` مسبقًا (من تجميعٍ Batch بالأب) لتجنّب N+1.
 *
 * @param {string} bucket
 * @param {string} path                 المسار داخل الـ bucket
 * @param {string} [presignedUrl]       رابطٌ موقّعٌ جاهزٌ — يُلغي الجلب من هنا
 * @param {number} [maxHeight=240]      أقصى ارتفاعٍ للعرض
 * @param {number} [ttlSeconds=3600]    عمر الرابط حين يُجلب محلّيًّا
 * @param {boolean} [showOpenFull]      يُظهر "فتح بحجم كامل" في الأسفل
 */
export default function SignedImage({
  bucket, path, presignedUrl, maxHeight = 240, ttlSeconds = 3600, showOpenFull = false,
}) {
  const [url, setUrl] = useState(presignedUrl || '')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (presignedUrl) { setUrl(presignedUrl); return }
    if (!bucket || !path) return
    let alive = true
    setFailed(false)
    ;(async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttlSeconds)
      if (!alive) return
      if (data?.signedUrl) setUrl(data.signedUrl)
      else if (error) setFailed(true)
    })()
    return () => { alive = false }
  }, [bucket, path, presignedUrl, ttlSeconds])

  if (failed) return (
    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>تعذّر تحميل المرفق — تأكّد من الصلاحيّة أو أعد المحاولة.</div>
  )
  if (!url) return (
    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>جارٍ تحميل المرفق…</div>
  )
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 8 }}>
      <img src={url} alt="مرفق" style={{ maxWidth: '100%', maxHeight, borderRadius: 10, border: '1px solid var(--line)' }} />
      {showOpenFull && (
        <div style={{ fontSize: 11, color: 'var(--gd-300)', marginTop: 4 }}>
          <Icon name="external" size={11} /> فتح بحجمٍ كامل
        </div>
      )}
    </a>
  )
}
