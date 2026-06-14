import { useEffect, useRef, useId } from 'react'

/* عدّاد فتحٍ مشترك: يمنع كسر body.overflow عند تداخل ورقتين/أكثر معًا. */
let openCount = 0
let savedOverflow = ''

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * ورقة سفلية (Bottom Sheet) — تتحوّل لمودال متوسّط على سطح المكتب.
 * Escape يُغلق، النقر خارج البطاقة يُغلق، يُقفل تمرير الجسم أثناء الفتح،
 * يحصر التركيز داخل البطاقة (focus trap) ويعيده للعنصر المُطلِق عند الإغلاق.
 *
 * @param {boolean}   open
 * @param {string}    title
 * @param {Function}  onClose
 * @param {ReactNode} actions   صفّ أزرارٍ سفلي (اختياري)
 */
export default function BottomSheet({ open, title, onClose, actions, children }) {
  const cardRef = useRef(null)
  const lastFocusRef = useRef(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    // احفظ العنصر المُركَّز قبل الفتح كي نعيد إليه التركيز لاحقًا.
    lastFocusRef.current = document.activeElement

    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return }
      if (e.key !== 'Tab') return
      // حصر التركيز داخل البطاقة (Tab/Shift+Tab يدور ضمنها فقط).
      const card = cardRef.current
      if (!card) return
      const items = card.querySelectorAll(FOCUSABLE)
      if (!items.length) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    if (openCount === 0) savedOverflow = document.body.style.overflow
    openCount += 1
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)

    // ركّز أوّل عنصرٍ داخل البطاقة (أو البطاقة نفسها) بعد الرسم.
    const t = setTimeout(() => {
      const card = cardRef.current
      if (!card) return
      const first = card.querySelector(FOCUSABLE)
      ;(first || card).focus?.()
    }, 0)

    return () => {
      clearTimeout(t)
      openCount = Math.max(0, openCount - 1)
      if (openCount === 0) document.body.style.overflow = savedOverflow
      window.removeEventListener('keydown', onKey)
      // أعِد التركيز للعنصر الذي فتح الورقة (إن بقي في DOM).
      const el = lastFocusRef.current
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-card"
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <div className="grabber" aria-hidden="true" />
        <div className="m-head">
          {title && <h3 id={titleId}>{title}</h3>}
          <button type="button" className="m-close" onClick={onClose} aria-label="إغلاق">×</button>
        </div>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}
