import { useEffect } from 'react'

/* عدّاد فتحٍ مشترك: يمنع كسر body.overflow عند تداخل ورقتين/أكثر معًا. */
let openCount = 0
let savedOverflow = ''

/**
 * ورقة سفلية (Bottom Sheet) — تتحوّل لمودال متوسّط على سطح المكتب.
 * Escape يُغلق، النقر خارج البطاقة يُغلق، يُقفل تمرير الجسم أثناء الفتح.
 *
 * @param {boolean}   open
 * @param {string}    title
 * @param {Function}  onClose
 * @param {ReactNode} actions   صفّ أزرارٍ سفلي (اختياري)
 */
export default function BottomSheet({ open, title, onClose, actions, children }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    if (openCount === 0) savedOverflow = document.body.style.overflow
    openCount += 1
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      openCount = Math.max(0, openCount - 1)
      if (openCount === 0) document.body.style.overflow = savedOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden="true" />
        <div className="m-head">
          {title && <h3>{title}</h3>}
          <button type="button" className="m-close" onClick={onClose} aria-label="إغلاق">×</button>
        </div>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}
