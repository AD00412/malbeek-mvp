import Icon from './Icon'

const STEPS = [
  { k: 'registered', t: 'مسجّل',        ic: 'check' },
  { k: 'paid',       t: 'مدفوع',        ic: 'payments' },
  { k: 'boarded',    t: 'صعد الحافلة',  ic: 'bus' },
  { k: 'checked_in', t: 'استلم الغرفة', ic: 'bed' },
]

/**
 * شريطُ تتبّعٍ لحالة المعتمر — يُبرز الخطوة الحاليّة وما اكتمل منها.
 * @param {string} status  registered | paid | boarded | checked_in
 * @param {boolean} [light]  نسخةٌ لخلفيّةٍ فاتحة (بطاقة التذكرة)
 */
export default function StatusTimeline({ status, light }) {
  const idx = Math.max(0, STEPS.findIndex((s) => s.k === status))
  return (
    <div className={`timeline ${light ? 'light' : ''}`} role="list" aria-label="حالة الحجز">
      {STEPS.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'current' : 'todo'
        return (
          <div className={`tl-step ${state}`} key={s.k} role="listitem" aria-current={state === 'current' || undefined}>
            {i > 0 && <span className={`tl-line ${i <= idx ? 'on' : ''}`} aria-hidden="true" />}
            <span className="tl-dot"><Icon name={i < idx ? 'check' : s.ic} size={13} /></span>
            <span className="tl-lbl">{s.t}</span>
          </div>
        )
      })}
    </div>
  )
}
