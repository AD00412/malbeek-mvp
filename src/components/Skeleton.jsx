/**
 * هياكل تحميلٍ (skeletons) موحَّدةٌ تحلّ محلّ «جارٍ التحميل…» — إحساسٌ أرقى
 * وأقلّ ارتباكًا (يرى المستخدم شكل المحتوى القادم بدل علامة فراغ).
 * تحترم prefers-reduced-motion عبر القاعدة العامّة في app.css.
 */

/** صفوفُ بطاقاتٍ وهميّة (لقوائم الرحلات/المعتمرين/الإشعارات). */
export function SkeletonList({ count = 2, lines = 2 }) {
  return (
    <div className="sk-list" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <div className="sk-card" key={i}>
          <span className="sk sk-title" />
          {Array.from({ length: lines }).map((_, j) => (
            <span className="sk sk-line" key={j} style={{ width: j === lines - 1 ? '60%' : '92%' }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** صفّ إحصاءاتٍ وهميّ (لبطاقات المؤشّرات). */
export function SkeletonStats({ count = 4 }) {
  return (
    <div className="sk-stats" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => <span className="sk sk-stat" key={i} />)}
    </div>
  )
}

export default SkeletonList
