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

  // تحميل الملف الشخصي (الدور + الحملة) — null-safe
  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); return }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, full_name, phone, subscriber_id')
      .eq('id', uid)
      .maybeSingle()
    if (error) {
      // eslint-disable-next-line no-console
      console.error('تعذّر تحميل الملف الشخصي:', error.message)
      setProfile(null)
      return
    }
    setProfile(data ?? null)
  }, [])

  useEffect(() => {
    let active = true
    let timeoutId = null

    const init = async () => {
      try {
        // إن تعلّق getSession (توكِنٌ قديمٌ بمشروعٍ مختلف، شبكةٌ متذبذبة، …)
        // نعتبر "لا جلسة" بعد ٥ ثوانٍ بدلًا من البقاء عالقين على شاشة التحميل
        const session = await Promise.race([
          supabase.auth.getSession().then((r) => r?.data?.session ?? null),
          new Promise((resolve) => {
            timeoutId = setTimeout(() => {
              // eslint-disable-next-line no-console
              console.warn('⏱️ getSession تأخّر عن ٥ ثوانٍ — أتجاوزه كأنّه بلا جلسة. امسح localStorage إن استمرّ.')
              resolve(null)
            }, 5000)
          }),
        ])
        if (timeoutId) clearTimeout(timeoutId)
        if (!active) return
        setSession(session)
        await loadProfile(session?.user?.id)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('AuthProvider init failed:', e?.message || e)
      } finally {
        if (active) setLoading(false)
      }
    }
    init()

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!active) return
      setSession(s ?? null)
      try { await loadProfile(s?.user?.id) }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('loadProfile failed on auth change:', e?.message || e)
      }
    })

    return () => {
      active = false
      if (timeoutId) clearTimeout(timeoutId)
      sub?.subscription?.unsubscribe?.()
    }
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  const refreshProfile = useCallback(
    () => loadProfile(session?.user?.id),
    [loadProfile, session]
  )

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
