import { Link } from 'react-router-dom'
import CompassMark from '../../components/CompassMark'

/**
 * هيكل موحّد لشاشات الدخول/التسجيل:
 * يمين = لوحة الهوية الفخمة · يسار = البطاقة (children)
 */
export default function AuthShell({
  heading = 'بوصلتك إلى البيت العتيق',
  blurb = 'منصّةٌ متكاملةٌ لإدارة حملات العُمرة باحترافٍ وفخامة.',
  points = ['تنظيمٌ دقيقٌ للرحلات والباصات', 'كشوفٌ رسميةٌ وباركود', 'خصوصيةٌ وأمانٌ بالتصميم'],
  children,
}) {
  return (
    <div className="auth-wrap">
      <aside className="auth-art">
        <Link to="/" className="auth-brand">
          <CompassMark size={40} />
          <span className="nm">ملبّيك</span>
        </Link>

        <div className="head">
          <h1>{heading}</h1>
          <p>{blurb}</p>
        </div>

        <div className="pts">
          {points.map((p, i) => (
            <div className="li" key={i}><span className="c">✦</span>{p}</div>
          ))}
        </div>

        <div className="ghost"><CompassMark size={460} /></div>
      </aside>

      <main className="auth-panel">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  )
}
