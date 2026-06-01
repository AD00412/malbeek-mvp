import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { AuthContext } from './useAuth'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)   // { id, role, full_name, phone, subscriber_id }
  const [loading, setLoading] = useState(true)

  // تحميل الملف الشخصي (الدور + الحملة) — null-safe + self-heal
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

    // self-heal: لو لم يوجد ملفٌ شخصي (مثلًا التريغر لم يفعّل لحساباتٍ قديمة)،
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
      console.error('تعذّر إنشاء الملف الشخصي تلقائيًا:', insErr.message,
        '— تأكّد من تشغيل supabase/schema.sql على مشروعك (التريغر + سياسات profiles).')
      setProfile(null)
      return
    }
    setProfile(created ?? null)
  }, [])

  useEffect(() => {
    let active = true

    // قراءة الجلسة الأولى عند الإقلاع. القفل المحدود في supabaseClient يضمن
    // ألّا يتجمّد getSession، لذا لا حاجة لأي سباق مؤقّتٍ هنا.
    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (!active) return
        const s = data?.session ?? null
        setSession(s)
        await loadProfile(s?.user?.id)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('تعذّر تهيئة الجلسة:', e?.message || e)
      } finally {
        if (active) setLoading(false)
      }
    }
    init()

    // أي تغيّرٍ لاحقٍ في حالة المصادقة (دخول/خروج/تجديد) يُحدّث الجلسة والملف
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!active) return
      setSession(s ?? null)
      try { await loadProfile(s?.user?.id) }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('تعذّر تحميل الملف عند تغيّر الجلسة:', e?.message || e)
      }
    })

    return () => {
      active = false
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
