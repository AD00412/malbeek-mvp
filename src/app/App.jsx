import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import RequireAuth, { homeForRole, ScreenLoader } from './RequireAuth'

import Login from '../pages/auth/Login'
import Signup from '../pages/auth/Signup'
import CustomerJoin from '../pages/auth/CustomerJoin'
import JoinTeam from '../pages/auth/JoinTeam'
import { AdminHome, SubscriberHome, CustomerHome } from '../pages/app/Homes'

// الجذر: يوجّه كل مستخدمٍ إلى لوحته، وغير المسجّل إلى الدخول
// ملاحظة: صفحة الهبوط التسويقية (malbeek-landing.html) تُخدَم على الجذر في الإنتاج،
// أو يمكن استبدال هذا التوجيه بمكوّن <Landing/> عند نقلها إلى React.
function RootRedirect() {
  const { session, role, loading } = useAuth()
  if (loading) return <ScreenLoader />
  if (session) return <Navigate to={homeForRole(role)} replace />
  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      {/* عامة */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/j/:slug" element={<CustomerJoin />} />
      <Route path="/join-team/:id" element={<JoinTeam />} />

      {/* محميّة حسب الدور */}
      <Route path="/admin" element={<RequireAuth roles={['admin']}><AdminHome /></RequireAuth>} />
      <Route path="/dashboard" element={<RequireAuth roles={['subscriber']}><SubscriberHome /></RequireAuth>} />
      <Route path="/customer" element={<RequireAuth roles={['customer']}><CustomerHome /></RequireAuth>} />

      {/* الجذر + غير معروف */}
      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
