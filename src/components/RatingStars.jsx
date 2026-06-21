import { useState } from 'react'

/**
 * نجومُ التَّقييم — عرضٌ أو إدخال.
 *   value     القيمةُ الحاليّة (0..5)
 *   onChange  لو مُرِّر صار قابلًا للنقر (وضعُ الإدخال)
 *   size      حجمُ النجمة بالبكسل
 *   count     عددُ التقييمات (للعرض المُجمَّع، اختياريّ)
 */
export default function RatingStars({ value = 0, onChange, size = 22, count, readOnly = false }) {
  const editable = typeof onChange === 'function' && !readOnly
  const [hover, setHover] = useState(0)
  const shown = hover || value

  return (
    <div className="rating-stars" role={editable ? 'radiogroup' : 'img'}
         aria-label={`تقييم ${Number(value).toFixed(1)} من ٥`}
         onMouseLeave={editable ? () => setHover(0) : undefined}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`rating-star ${n <= shown ? 'on' : ''} ${editable ? 'editable' : ''}`}
          style={{ fontSize: size }}
          disabled={!editable}
          aria-label={`${n} ${n === 1 ? 'نجمة' : 'نجوم'}`}
          aria-checked={editable ? n === value : undefined}
          role={editable ? 'radio' : undefined}
          onMouseEnter={editable ? () => setHover(n) : undefined}
          onClick={editable ? () => onChange(n) : undefined}
        >★</button>
      ))}
      {count != null && (
        <span className="rating-count">{value ? Number(value).toFixed(1) : '—'}{count > 0 ? ` · ${count} تقييم` : ''}</span>
      )}
    </div>
  )
}
