import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import CompassMark from '../components/CompassMark'

// الوجهة الافتراضية لكل دور
export function homeForRole(role) {
  switch (role) {
    case 'admin':      return '/admin'
    case 'subscriber': return '/dashboard'
    case 'customer':   return '/customer'
    default:           return '/login'
  }
}

// شاشة تحميل أنيقة أثناء التحقق من الجلسة
export function ScreenLoader({ label = 'جارٍ التحميل…' }) {
  return (
    <div className="screen-loader">
      <div className="sl-mark"><CompassMark size={64} /></div>
      <div className="sl-text">{label}</div>
    </div>
  )
}

/**
 * يحمي المسار: يتطلّب جلسة، ويمكن تقييده بأدوار محدّدة.
 * <RequireAuth roles={['subscriber']}> ... </RequireAuth>
 */
export default function RequireAuth({ roles, children }) {
  const { session, profile, loading } = useAuth()
  const loc = useLocation()

  if (loading) return <ScreenLoader />

  if (!session) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  }

  // الجلسة موجودة لكن الملف الشخصي لم يُحمَّل بعد
  if (!profile) return <ScreenLoader label="جارٍ تجهيز حسابك…" />

  // تقييد حسب الدور: وجّه المستخدم إلى لوحته الصحيحة
  if (roles && !roles.includes(profile.role)) {
    return <Navigate to={homeForRole(profile.role)} replace />
  }

  return children
}
