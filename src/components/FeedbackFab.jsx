import { useEffect, useRef, useState, useCallback } from 'react'
import Icon from './Icon'

/**
 * زر عائم للتغذية الراجعة — ذكي وقابل للسحب وللحذف بشكل طبيعي.
 *
 * تجربة المستخدم:
 *  - نقرة: يفتح ورقة التواصل.
 *  - سحب بإصبع: يتحرك ويلتصق بأقرب حافة عند الإفلات. الموضع يحفظ.
 *  - ضغطة مطولة (٤٠٠ms): يدخل «وضع الحذف» — تظهر سلة حمراء في الأسفل
 *    مع اهتزاز خفيف، ويهتز الزر بهدوء. يكفي أن تسحبه إلى السلة لحذفه.
 *  - عند الإفلات داخل السلة: ينطوي الزر بحركة ناعمة ويختفي لهذه الجلسة.
 *  - عند فتح التطبيق من جديد: يعود الزر في **آخر موضع** كان فيه.
 *  - ذكاء مضاد للإزعاج: إن حذفه المستخدم ٣ مرات متتالية دون استخدامه،
 *    يتوقف عن الظهور (يستعاد عند فتح «الدعم» من القائمة).
 *  - أي تفاعل مع ورقة التواصل (من أي مكان) يصفر العداد.
 *
 * @param {() => void} onOpen   فتح ورقة التغذية الراجعة
 * @param {number}     badge    عدد الردود غير المقروءة (اختياري)
 */
const POS_KEY      = 'malbeek.fab.pos'
const SESSION_HIDE = 'malbeek.fab.sessionHidden'
const DISMISS_CNT  = 'malbeek.fab.dismissCount'
const PERMA_HIDE   = 'malbeek.fab.permaSuppressed'

const FAB = 52
const MARGIN = 16
const TRASH_SIZE = 88
const DRAG_THRESHOLD = 6
const LONG_PRESS_MS = 400
const MAX_DISMISSES = 3

export default function FeedbackFab({ onOpen, badge = 0 }) {
  const [pos, setPos] = useState(null)
  const [hidden, setHidden] = useState(true)      // مبدئيا مخفي حتى يحل
  const [mode, setMode] = useState('idle')        // idle | dragging | delete | destroying
  const [overTrash, setOverTrash] = useState(false)
  const ref = useRef(null)
  const drag = useRef({ active: false, moved: false, dx: 0, dy: 0, sx: 0, sy: 0, longTimer: null })

  const clamp = useCallback((x, y) => {
    if (typeof window === 'undefined') return { x, y }
    const maxX = window.innerWidth - FAB - MARGIN
    const maxY = window.innerHeight - FAB - MARGIN
    return {
      x: Math.max(MARGIN, Math.min(x, maxX)),
      y: Math.max(MARGIN + 40, Math.min(y, maxY)),  // +40 لتجنب الرأس
    }
  }, [])

  const defaultPos = useCallback(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 }
    const isDesktop = window.innerWidth >= 820
    const bottomGap = isDesktop ? 24 : 96 + 16
    return { x: window.innerWidth - FAB - MARGIN, y: window.innerHeight - FAB - bottomGap }
  }, [])

  const resolveVisibility = useCallback(() => {
    if (typeof window === 'undefined') return
    const perma = localStorage.getItem(PERMA_HIDE) === '1'
    const sess = sessionStorage.getItem(SESSION_HIDE) === '1'
    if (perma || sess) { setHidden(true); return }

    let saved = null
    try { const raw = localStorage.getItem(POS_KEY); if (raw) saved = JSON.parse(raw) } catch { /* ignore */ }
    const init = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : defaultPos()
    setPos(clamp(init.x, init.y))
    setHidden(false)
  }, [clamp, defaultPos])

  // التحقق من الرؤية عند التحميل
  useEffect(() => { resolveVisibility() }, [resolveVisibility])

  // الاستماع لطلب الإظهار الخارجي (من «الدعم» في الدرج مثلا)
  useEffect(() => {
    function onShow() {
      try {
        sessionStorage.removeItem(SESSION_HIDE)
        localStorage.removeItem(PERMA_HIDE)
        localStorage.setItem(DISMISS_CNT, '0')   // إعادة ضبط ذكاء مضاد الإزعاج
      } catch { /* ignore */ }
      resolveVisibility()
    }
    window.addEventListener('malbeek:fab:show', onShow)
    return () => window.removeEventListener('malbeek:fab:show', onShow)
  }, [resolveVisibility])

  // إعادة التثبيت عند تغير حجم النافذة/الدوران
  useEffect(() => {
    function onResize() { setPos((p) => (p ? clamp(p.x, p.y) : p)) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clamp])

  // نظافة: إن فكك المكون أثناء التفاعل، نرفع القفل عن الـ body
  useEffect(() => () => { document.body.classList.remove('fab-interacting') }, [])

  function getTrashRect() {
    if (typeof window === 'undefined') return { cx: 0, cy: 0 }
    const isDesktop = window.innerWidth >= 820
    const bottomGap = isDesktop ? 32 + 16 : 96 + 16 + 16
    return {
      cx: window.innerWidth / 2,
      cy: window.innerHeight - bottomGap - TRASH_SIZE / 2,
    }
  }
  function isOverTrash(x, y) {
    const r = getTrashRect()
    const fabCx = x + FAB / 2, fabCy = y + FAB / 2
    return Math.hypot(fabCx - r.cx, fabCy - r.cy) < TRASH_SIZE * 0.8
  }

  function onPointerDown(e) {
    if (e.button === 2) return
    // نمنع iOS Safari من تشغيل تحديد النص/قائمة السياق التلقائية
    // عند الضغطة المطولة على الصفحة، فيبقى الزر معزولا تماما.
    e.preventDefault()
    // قفل شامل: نمنع التحديد والتمييز في الصفحة كلها أثناء التفاعل،
    // فلا تظهر مستطيلات زرقاء على البطاقات/الأزرار خلف الزر.
    document.body.classList.add('fab-interacting')
    const rect = ref.current.getBoundingClientRect()
    drag.current = {
      active: true, moved: false,
      dx: e.clientX - rect.left, dy: e.clientY - rect.top,
      sx: e.clientX, sy: e.clientY,
      longTimer: null,
    }
    ref.current.setPointerCapture?.(e.pointerId)

    // مؤقت الضغطة المطولة — يدخل وضع الحذف إن بقي الإصبع ثابتا
    drag.current.longTimer = setTimeout(() => {
      if (drag.current.active && !drag.current.moved) {
        setMode('delete')
        if (navigator.vibrate) navigator.vibrate(25)
      }
    }, LONG_PRESS_MS)
  }

  function onPointerMove(e) {
    if (!drag.current.active) return
    const dist = Math.hypot(e.clientX - drag.current.sx, e.clientY - drag.current.sy)

    if (dist > DRAG_THRESHOLD && !drag.current.moved) {
      drag.current.moved = true
      // إن لم نكن قد دخلنا وضع الحذف بعد، فالحركة السريعة تلغي الضغطة المطولة
      // وتبدأ سحبا عاديا. أما إن كنا في وضع الحذف فالسحب نحو السلة.
      if (drag.current.longTimer && mode === 'idle') {
        clearTimeout(drag.current.longTimer)
        drag.current.longTimer = null
        setMode('dragging')
      }
    }

    if (drag.current.moved) {
      const next = clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy)
      setPos(next)
      if (mode === 'delete') {
        const over = isOverTrash(next.x, next.y)
        if (over !== overTrash) {
          setOverTrash(over)
          if (over && navigator.vibrate) navigator.vibrate(15)
        }
      }
    }
  }

  function onPointerUp(e) {
    const wasMoved = drag.current.moved
    const wasMode = mode
    const wasOver = overTrash

    if (drag.current.longTimer) { clearTimeout(drag.current.longTimer); drag.current.longTimer = null }
    drag.current.active = false
    ref.current?.releasePointerCapture?.(e.pointerId)
    // ارفع قفل التحديد عن الصفحة بمجرد انتهاء التفاعل
    document.body.classList.remove('fab-interacting')

    // الحالة ١: في وضع الحذف وفوق السلة → احذف
    if (wasMode === 'delete' && wasOver) {
      dismiss()
      return
    }
    // الحالة ٢: في وضع الحذف لكن خارج السلة → خروج من وضع الحذف + التصاق بالحافة
    if (wasMode === 'delete') {
      setMode('idle')
      setOverTrash(false)
      snapToEdge()
      return
    }
    // الحالة ٣: نقرة بسيطة (دون حركة) → افتح ورقة التواصل + صفر العداد
    if (!wasMoved) {
      try { localStorage.setItem(DISMISS_CNT, '0') } catch { /* ignore */ }
      onOpen?.()
      return
    }
    // الحالة ٤: سحب عادي → التصاق بالحافة وحفظ الموضع
    setMode('idle')
    snapToEdge()
  }

  function snapToEdge() {
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

  function dismiss() {
    setMode('destroying')
    setOverTrash(false)
    if (navigator.vibrate) navigator.vibrate([20, 40, 60])
    // أبق الحركة مرئية لحظة قبل الإخفاء النهائي
    setTimeout(() => {
      try {
        sessionStorage.setItem(SESSION_HIDE, '1')
        const count = parseInt(localStorage.getItem(DISMISS_CNT) || '0', 10) + 1
        localStorage.setItem(DISMISS_CNT, String(count))
        if (count >= MAX_DISMISSES) localStorage.setItem(PERMA_HIDE, '1')
      } catch { /* ignore */ }
      setHidden(true)
      setMode('idle')
    }, 280)
  }

  if (hidden || !pos) return null

  return (
    <>
      <div
        ref={ref}
        className={`fab-fb mode-${mode} ${overTrash ? 'over-trash' : ''}`}
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}    // يلغي قائمة iOS/الويب التلقائية
        onDragStart={(e) => e.preventDefault()}      // يلغي drag-image التلقائي للصورة
        role="button"
        tabIndex={0}
        aria-label="تواصل مع إدارة ملبّيك"
        title="انقر للتواصل · اضغط مطولا للحذف"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.() } }}
      >
        <Icon name="message" size={20} />
        {badge > 0 && <span className="fab-fb-badge">{badge > 9 ? '9+' : badge}</span>}
      </div>

      {(mode === 'delete' || mode === 'destroying') && (
        <div className={`fab-trash ${overTrash ? 'active' : ''} ${mode === 'destroying' ? 'destroying' : ''}`}>
          <div className="fab-trash-circle" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"/>
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          </div>
          <div className="fab-trash-label">{overTrash ? 'أفلت للحذف' : 'اسحبه هنا للحذف'}</div>
        </div>
      )}
    </>
  )
}

/**
 * مساعد لإعادة إظهار الزر من أي مكان (مثلا عند فتح «الدعم» من الدرج).
 * يصفر عداد الحذف وعلامة الإخفاء الدائم.
 */
export function showFeedbackFab() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('malbeek:fab:show'))
}
