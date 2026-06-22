import { createContext, useContext } from 'react'

// سياق المصادقة + الخطاف، منفصلين عن مكون AuthProvider
// لإرضاء Fast Refresh (الملف يجب أن يصدر مكونات React فقط أو خطافات/أدوات فقط، لا الاثنين معا)
export const AuthContext = createContext(null)

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth يجب أن يستخدم داخل <AuthProvider>')
  return ctx
}
