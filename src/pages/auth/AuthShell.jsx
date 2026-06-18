import { Link } from 'react-router-dom'
import CompassMark from '../../components/CompassMark'

/**
 * هيكلٌ موحّدٌ لشاشات الدخول/التسجيل — نمط المرجع malbeek_2.html (AUTH PAGES):
 * شريطٌ علويٌّ ببطاقة «العودة للرئيسية» + بطاقةٌ مركزيّةٌ نظيفةٌ + لوكَب + سطرُ التذييل.
 *
 * @param {string}    title    عنوان البطاقة (مثلًا: «تسجيل الدخول»)
 * @param {string}    sub      سطرٌ تحت العنوان
 * @param {ReactNode} children النموذج
 * @param {ReactNode} footer   سطرُ التذييل (روابطٌ بين الدخول/التسجيل)
 */
export default function AuthShell({ title, sub, children, footer }) {
  return (
    <div className="auth-page">
      <div className="auth-topbar">
        <Link to="/" className="auth-back">
          <span aria-hidden="true">→</span> العودة للرئيسية
        </Link>
      </div>

      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-logo">
            <CompassMark size={56} />
            <span className="auth-logo-name">ملبّيك</span>
          </div>

          {title && <h1 className="auth-title">{title}</h1>}
          {sub && <p className="auth-sub">{sub}</p>}

          {children}

          {footer && <div className="auth-footer-text">{footer}</div>}

          <div className="auth-powered">mulabeek.com</div>
        </div>
      </div>
    </div>
  )
}
