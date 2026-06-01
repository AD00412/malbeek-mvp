import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { AuthContext } from './useAuth'

const PROFILE_COLS = 'id, role, full_name, phone, subscriber_id'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)   // { id, role, full_name, phone, subscriber_id }
  const [loading, setLoading] = useState(true)

  /* تحميل الملف الشخصي (الدور + الحملة) — null-safe + self-heal */
  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); return }

    const { data, error } = await supabase
      .from('profiles').select(PROFILE_COLS).eq('id', uid).maybeSingle()
    if (error) {
      // eslint-disable-next-line no-console
      console.error('تعذّر تحميل الملف الشخصي:', error.message)
      setProfile(null)
      return
    }
    if (data) { setProfile(data); return }

    // self-heal: لو غاب الملف (التريغر لم يفعّل لحساباتٍ قديمة) ننشئه من بيانات
    // التسجيل — مسموحٌ بسياسة "profile self insert".
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
      .select(PROFILE_COLS)
      .maybeSingle()
    if (insErr) {
      // 23505 = المفتاح الأساسي: التريغر أنشأ الملف بالتوازي. ليس خطأً — أعد قراءته.
      if (insErr.code === '23505') {
        const { data: again } = await supabase
          .from('profiles').select(PROFILE_COLS).eq('id', uid).maybeSingle()
        setProfile(again ?? null)
        return
      }
      // eslint-disable-next-line no-console
      console.error('تعذّر إنشاء الملف الشخصي تلقائيًا:', insErr.message,
        '— تأكّد من تشغيل supabase/schema.sql (التريغر + سياسات profiles).')
      setProfile(null)
      return
    }
    setProfile(created ?? null)
  }, [])

  useEffect(() => {
    let active = true

    // onAuthStateChange يُطلق فورًا حدث INITIAL_SESSION بالجلسة الحالية،
    // ثم كل دخول/خروج/تجديد. مصدرٌ واحدٌ للحقيقة. مع القفل الصوري في
    // supabaseClient يصل الحدث الأوّل خلال أجزاء الثانية بلا أي تجمّد.
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!active) return
      setSession(s ?? null)
      try { await loadProfile(s?.user?.id) }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('تعذّر تحميل الملف:', e?.message || e)
        setProfile(null)
      } finally {
        if (active) setLoading(false)
      }
    })

    return () => { active = false; sub?.subscription?.unsubscribe?.() }
  }, [loadProfile])

  const signOut = useCallback(async () => {
    setProfile(null)
    await supabase.auth.signOut()
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
