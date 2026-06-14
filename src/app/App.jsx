import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import RequireAuth, { homeForRole, ScreenLoader } from './RequireAuth'

import Login from '../pages/auth/Login'
import Signup from '../pages/auth/Signup'
import CustomerJoin from '../pages/auth/CustomerJoin'
import JoinTeam from '../pages/auth/JoinTeam'

// تقسيمٌ على مستوى المسار: لوحات التحكّم (وكلّ تبعيّاتها الثقيلة) تُحمَّل عند
// الحاجة فقط — فيبقى التحميل الأوّليّ (الدخول/التسجيل/الانضمام) خفيفًا وسريعًا.
const AdminHome      = lazy(() => import('../pages/app/Homes').then((m) => ({ default: m.AdminHome })))
const SubscriberHome = lazy(() => import('../pages/app/Homes').then((m) => ({ default: m.SubscriberHome })))
const CustomerHome   = lazy(() => import('../pages/app/Homes').then((m) => ({ default: m.CustomerHome })))

// الجذر: يوجّه كل مستخدمٍ إلى لوحته، وغير المسجّل إلى الدخول
function RootRedirect() {
  const { session, role, loading } = useAuth()
  if (loading) return <ScreenLoader />
  if (session) return <Navigate to={homeForRole(role)} replace />
  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Suspense fallback={<ScreenLoader label="جارٍ تجهيز لوحتك…" />}>
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
    </Suspense>
  )
}
