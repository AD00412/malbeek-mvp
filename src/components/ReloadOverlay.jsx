import { useEffect, useState } from 'react'
import { onShowReload } from '../lib/wake'
import Icon from './Icon'

/**
 * بطاقةُ "إعادة التحميل" في وسط الشاشة عند تجمّد التطبيق بعد العودة من
 * الخلفية. تَظهر تلقائيًّا عند اكتشاف تعليقٍ ثمّ تُعيد تحميلًا تلقائيًّا
 * بعد ٣ ثوانٍ. يَستطيع المستخدم الضغطَ مبكّرًا أو الإغلاق.
 */
const AUTO_RELOAD_MS = 3000

export default function ReloadOverlay() {
  const [open, setOpen] = useState(false)
  const [countdown, setCountdown] = useState(3)

  useEffect(() => {
    const unsub = onShowReload(() => setOpen(true))
    return unsub
  }, [])

  useEffect(() => {
    if (!open) return
    setCountdown(3)
    const startedAt = Date.now()
    const tick = setInterval(() => {
      const left = Math.max(0, AUTO_RELOAD_MS - (Date.now() - startedAt))
      setCountdown(Math.ceil(left / 1000))
    }, 200)
    const reloadAt = setTimeout(() => {
      try { window.location.reload() } catch { /* ignore */ }
    }, AUTO_RELOAD_MS)
    return () => { clearInterval(tick); clearTimeout(reloadAt) }
  }, [open])

  if (!open) return null

  return (
    <div className="reload-overlay" role="alertdialog" aria-modal="true" aria-labelledby="reload-title">
      <div className="reload-card">
        <div className="reload-ic"><Icon name="refresh" size={28} /></div>
        <h3 id="reload-title" className="reload-title">تطبيقك بحاجة لإعادة تحميل</h3>
        <p className="reload-msg">قد يكونُ توقّفَ مؤقّتًا بعد عودته من الخلفيّة. سنُعيدُ تحميلَه تلقائيًّا خلال {countdown} ثانية.</p>
        <div className="reload-actions">
          <button type="button" className="btn btn-em" onClick={() => { try { window.location.reload() } catch (e) { /* ignore */ } }}>
            <Icon name="refresh" size={16} /> إعادة التحميل الآن
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            تجاهل
          </button>
        </div>
      </div>
    </div>
  )
}
