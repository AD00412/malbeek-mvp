import { useEffect, useRef, useId } from 'react'

/* عداد فتح مشترك: يمنع كسر body.overflow عند تداخل ورقتين/أكثر معا. */
let openCount = 0
let savedOverflow = ''

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * ورقة سفلية (Bottom Sheet) — تتحول لمودال متوسط على سطح المكتب.
 * Escape يغلق، النقر خارج البطاقة يغلق، يقفل تمرير الجسم أثناء الفتح،
 * يحصر التركيز داخل البطاقة (focus trap) ويعيده للعنصر المطلق عند الإغلاق.
 *
 * ★ iOS Safari fix: onClose يحفظ في ref بدل تبعية، لأن كل keystroke في
 *   نموذج بداخل الورقة يعيد إنشاء closure للأب → تغير مرجع onClose →
 *   re-run للـeffect → focus ينتقل من input → keyboard ينزل في iOS.
 *   النمط الجديد: التبعية على [open] فقط؛ الكلوجرات تقرأ من ref.
 *
 * @param {boolean}   open
 * @param {string}    title
 * @param {Function}  onClose
 * @param {ReactNode} actions   صف أزرار سفلي (اختياري)
 */
export default function BottomSheet({ open, title, onClose, actions, children }) {
  const cardRef = useRef(null)
  const lastFocusRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  // يبقى onCloseRef محدثا بآخر دالة بلا تسبيب re-run للـeffect.
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    // احفظ العنصر المركز قبل الفتح كي نعيد إليه التركيز لاحقا.
    lastFocusRef.current = document.activeElement

    const onKey = (e) => {
      if (e.key === 'Escape') { onCloseRef.current?.(); return }
      if (e.key !== 'Tab') return
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

    // ركز أول عنصر داخل البطاقة بعد الرسم — مرة واحدة عند الفتح.
    const t = setTimeout(() => {
      const card = cardRef.current
      if (!card) return
      // تجنب إعادة التركيز لو المستخدم بدأ يكتب في حقل أصلا.
      if (card.contains(document.activeElement)) return
      const first = card.querySelector(FOCUSABLE)
      ;(first || card).focus?.()
    }, 0)

    return () => {
      clearTimeout(t)
      openCount = Math.max(0, openCount - 1)
      if (openCount === 0) document.body.style.overflow = savedOverflow
      window.removeEventListener('keydown', onKey)
      const el = lastFocusRef.current
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus()
    }
    // ★ التبعية على [open] فقط — onClose عبر ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
