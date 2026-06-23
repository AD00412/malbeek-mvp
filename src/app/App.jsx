import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import RequireAuth, { ScreenLoader } from './RequireAuth'

import Login from '../pages/auth/Login'
import Signup from '../pages/auth/Signup'
import ForgotPassword from '../pages/auth/ForgotPassword'
import ResetPassword from '../pages/auth/ResetPassword'
import CustomerJoin from '../pages/auth/CustomerJoin'
import JoinTeam from '../pages/auth/JoinTeam'
import AcceptInvite from '../pages/auth/AcceptInvite'
import Landing from '../pages/Landing'
import Legal from '../pages/Legal'

// تقسيم على مستوى المسار: لوحات التحكم (وكل تبعياتها الثقيلة) تحمل عند
// الحاجة فقط — فيبقى التحميل الأولي (الدخول/التسجيل/الانضمام) خفيفا وسريعا.
const AdminHome      = lazy(() => import('../pages/app/Homes').then((m) => ({ default: m.AdminHome })))
const SubscriberHome = lazy(() => import('../pages/app/Homes').then((m) => ({ default: m.SubscriberHome })))
const CustomerHome   = lazy(() => import('../pages/app/Homes').then((m) => ({ default: m.CustomerHome })))

// الجذر: يوجه المسجل إلى لوحته. غير المسجل يرى صفحة الترحيب
// (تعرض الميزات والتسجيل المجاني). Landing نفسها تتولى عرض حالة التحميل
// والـ Navigate إن صار للزائر جلسة لاحقا.

export default function App() {
  const { session } = useAuth()
  // تحميل مسبق لحزمة اللوحة بمجرد وجود جلسة، فينتقل المستخدم إليها بلا أي
  // وميض تحميل بعد الدخول (سلاسة في الانتقال).
  useEffect(() => { if (session) import('../pages/app/Homes') }, [session])

  return (
    <Suspense fallback={<ScreenLoader label="جار تجهيز لوحتك…" />}>
      <Routes>
        {/* عامة */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/terms" element={<Legal kind="terms" />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
        <Route path="/j/:slug" element={<CustomerJoin />} />
        <Route path="/join-team/:id" element={<JoinTeam />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />

        {/* محمية حسب الدور */}
        <Route path="/admin" element={<RequireAuth roles={['admin','support']}><AdminHome /></RequireAuth>} />
        <Route path="/dashboard" element={<RequireAuth roles={['subscriber']}><SubscriberHome /></RequireAuth>} />
        <Route path="/customer" element={<RequireAuth roles={['customer']}><CustomerHome /></RequireAuth>} />

        {/* الجذر + المسارات المختصرة (slug مباشر بلا /j/) + غير معروف.
            الترتيب مهم: الجذر أولا، ثم slug عام (يبدأ بحرف صغير)،
            ثم catch-all. الـ regex يضمن ألا يلتقط أي مسار نظامي أعلن
            أعلاه — هذه مختارة قبله. */}
        <Route path="/" element={<Landing />} />
        <Route path="/:slug" element={<CustomerJoin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
