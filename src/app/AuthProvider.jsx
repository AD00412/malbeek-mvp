import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

// خطّاف للوصول إلى حالة المصادقة من أي مكوّن
export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth يجب أن يُستخدم داخل <AuthProvider>')
  return ctx
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)   // { id, role, full_name, phone, subscriber_id }
  const [loading, setLoading] = useState(true)

  // تحميل الملف الشخصي (الدور + الحملة) — مع إنشاءٍ ذاتيّ إن غاب
  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); return }
    const COLS = 'id, role, full_name, phone, subscriber_id'

    const { data, error } = await supabase
      .from('profiles').select(COLS).eq('id', uid).maybeSingle()

    if (error) {
      // eslint-disable-next-line no-console
      console.error('تعذّر تحميل الملف الشخصي:', error.message)
      setProfile(null)
      return
    }

    if (data) { setProfile(data); return }

    // احتياطي (self-heal): لو لم يوجد ملفٌ شخصي (مثلاً لم يعمل التريغر)،
    // ننشئه من بيانات تسجيل المستخدم — مسموحٌ بسياسة "profile self insert".
    const { data: u } = await supabase.auth.getUser()
    const md = u?.user?.user_metadata ?? {}
    const { data: created, error: insErr } = await supabase
      .from('profiles')
      .insert({
        id: uid,
        role: md.role ?? 'customer',
        full_name: md.full_name ?? null,
        phone: md.phone ?? null,
        subscriber_id: md.subscriber_id ?? null,
      })
      .select(COLS)
      .maybeSingle()

    if (insErr) {
      // eslint-disable-next-line no-console
      console.error('تعذّر إنشاء الملف الشخصي:', insErr.message)
      setProfile(null)
      return
    }
    setProfile(created ?? null)
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      const s = data?.session ?? null
      setSession(s)
      await loadProfile(s?.user?.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!active) return
      setSession(s ?? null)
      await loadProfile(s?.user?.id)
    })

    return () => { active = false; sub?.subscription?.unsubscribe?.() }
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  // يجلب المستخدم الحالي من Supabase مباشرةً (لا يعتمد على نسخة session القديمة داخل الإغلاق)
  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getUser()
    await loadProfile(data?.user?.id)
  }, [loadProfile])

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    role: profile?.role ?? null,
    subscriberId: profile?.subscriber_id ?? null,
    loading,
    signOut,
    refreshProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}