import { useEffect, useRef, useState, useCallback } from 'react'
import Icon from './Icon'

/**
 * زرٌّ عائمٌ للتغذية الراجعة — قابلٌ للسحب باللمس، يتذكّر موضعه، ويُخفى
 * بضغطةٍ إن أزعج المستخدم (يبقى الوصولُ للملاحظات من «الدعم» في الدرج).
 *
 * - السحب: Pointer Events (لمسٌ + ماوس) مع عتبةِ حركةٍ تميّز النقرَ عن السحب.
 * - عند الإفلات: يلتصق بأقرب حافّةٍ (يمين/يسار) ويُحفظ الموضع في localStorage.
 * - زرّ × صغيرٌ يُخفيه نهائيًّا (يُحفظ)، ويُستعاد افتراضيًّا في جلسةٍ جديدةٍ
 *   فقط إن مسح المستخدم التخزين — وإلّا يبقى الوصولُ عبر الدرج.
 *
 * @param {() => void} onOpen   فتحُ ورقة التغذية الراجعة
 * @param {number}     badge    عددُ الردود غير المقروءة (اختياريّ)
 */
const POS_KEY = 'malbeek.fab.pos'
const HIDE_KEY = 'malbeek.fab.hidden'
const FAB = 52          // قطرُ الزرّ
const MARGIN = 16       // هامشٌ عن الحواف
const DRAG_THRESHOLD = 6 // بكسلٌ يميّز السحبَ عن النقر

export default function FeedbackFab({ onOpen, badge = 0 }) {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false }
  })
  const [pos, setPos] = useState(null)   // { x, y } بالبكسل (top-left)
  const [dragging, setDragging] = useState(false)
  const ref = useRef(null)
  const drag = useRef({ active: false, moved: false, dx: 0, dy: 0, sx: 0, sy: 0 })

  // الموضعُ الافتراضيّ: أسفل-بداية (RTL = يمين)، فوق شريط التبويب على الجوال
  const defaultPos = useCallback(() => {
    if (typeof window === 'undefined') return { x: MARGIN, y: 200 }
    const isDesktop = window.innerWidth >= 820
    const bottomGap = isDesktop ? 24 : 96 + 16
    return {
      x: MARGIN,   // RTL: inset-inline-end = يسار الشاشة فعليًّا للحافّة البادئة؟ نضبط أدناه
      y: window.innerHeight - FAB - bottomGap,
    }
  }, [])

  // تحميلُ الموضع المحفوظ + التثبيتُ داخل النافذة
  useEffect(() => {
    if (typeof window === 'undefined') return
    let saved = null
    try {
      const raw = localStorage.getItem(POS_KEY)
      if (raw) saved = JSON.parse(raw)
    } catch { /* ignore */ }
    const init = saved && typeof saved.x === 'number' ? saved : (() => {
      // افتراضيًّا: الحافّةُ البادئةُ (يمين في RTL) أسفل الشاشة
      const isDesktop = window.innerWidth >= 820
      const bottomGap = isDesktop ? 24 : 96 + 16
      return { x: window.innerWidth - FAB - MARGIN, y: window.innerHeight - FAB - bottomGap }
    })()
    setPos(clamp(init.x, init.y))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clamp(x, y) {
    if (typeof window === 'undefined') return { x, y }
    const maxX = window.innerWidth - FAB - MARGIN
    const maxY = window.innerHeight - FAB - MARGIN
    return {
      x: Math.max(MARGIN, Math.min(x, maxX)),
      y: Math.max(MARGIN + 40, Math.min(y, maxY)),  // +40 لتجنّب الرأس
    }
  }

  // إعادةُ التثبيت عند تغيّر حجم النافذة/الدوران
  useEffect(() => {
    function onResize() { setPos((p) => (p ? clamp(p.x, p.y) : p)) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function onPointerDown(e) {
    if (e.button === 2) return
    const rect = ref.current.getBoundingClientRect()
    drag.current = {
      active: true, moved: false,
      dx: e.clientX - rect.left, dy: e.clientY - rect.top,
      sx: e.clientX, sy: e.clientY,
    }
    ref.current.setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e) {
    if (!drag.current.active) return
    const dist = Math.hypot(e.clientX - drag.current.sx, e.clientY - drag.current.sy)
    if (dist > DRAG_THRESHOLD) {
      if (!drag.current.moved) { drag.current.moved = true; setDragging(true) }
      setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy))
    }
  }

  function onPointerUp(e) {
    const wasMoved = drag.current.moved
    drag.current.active = false
    ref.current?.releasePointerCapture?.(e.pointerId)
    if (!wasMoved) {
      // نقرةٌ: افتح الورقة
      onOpen?.()
      return
    }
    // سحبٌ: التصق بأقرب حافّةٍ أفقيّةٍ ثمّ احفظ
    setDragging(false)
    setPos((p) => {
      if (!p) return p
      const mid = window.innerWidth / 2
      const center = p.x + FAB / 2
      const snappedX = center < mid ? MARGIN : window.innerWidth - FAB - MARGIN
      const next = clamp(snappedX, p.y)
      try { localStorage.setItem(POS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  function dismiss(e) {
    e.stopPropagation()
    setHidden(true)
    try { localStorage.setItem(HIDE_KEY, '1') } catch { /* ignore */ }
  }

  if (hidden || !pos) return null

  return (
    <div
      ref={ref}
      className={`fab-fb ${dragging ? 'dragging' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="button"
      tabIndex={0}
      aria-label="تواصل مع إدارة ملبّيك"
      title="تواصل مع إدارة ملبّيك — اسحبه لتحريكه"
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.() } }}
    >
      <Icon name="message" size={20} />
      {badge > 0 && <span className="fab-fb-badge">{badge > 9 ? '9+' : badge}</span>}
      <button
        type="button"
        className="fab-fb-close"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={dismiss}
        aria-label="إخفاء الزرّ"
        title="إخفاء (يبقى الوصولُ من «الدعم» في القائمة)"
      >×</button>
    </div>
  )
}
