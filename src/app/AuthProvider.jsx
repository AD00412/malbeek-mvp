import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { AuthContext } from './useAuth'
import { invalidateAll, getCached, setCached, buildPaxStats } from '../lib/dataCache'
import { installWakeListeners } from '../lib/wake'

const PROFILE_COLS = 'id, role, full_name, phone, subscriber_id'

/**
 * يبدأ تحميل بيانات لوحة المستخدم بمجرد أن يحل ملفه — قبل أن
 * تمون React صفحة اللوحة فعلا. النتيجة تخزن في الـ cache فتجدها
 * صفحة Homes جاهزة عند أول render، فلا يرى المستخدم skeleton أبدا.
 *
 * يعمل بصمت — أي خطأ يتجاهل؛ صفحة اللوحة ستحاول مرة ثانية.
 */
async function prefetchDashboard(profile, userId) {
  if (!profile || !userId) return
  try {
    if (profile.role === 'subscriber') {
      const key = `sub-dash:${userId}`
      if (getCached(key)) return            // محدث مسبقا — لا داعي
      const { data: managedId } = await supabase.rpc('my_managed_subscriber_id')
      if (!managedId) return                 // مالك جديد بلا حملة — تتولى الصفحة الإنشاء
      const subCols = 'id, owner_id, org_name, slug, plan, trial_ends_at, license_no, contact_phone, stamp_text, stamp_url, logo_url, store_url, carrier_company, created_at'
      const [subRes, tripsRes, paxRes] = await Promise.all([
        supabase.from('subscribers').select(subCols).eq('id', managedId).maybeSingle(),
        supabase.from('trips').select('id, title, route_from, route_to, depart_at, return_at, capacity, bus_label, boarding_point, status, notes, seating_policy, bus_rows, bus_back_row, price')
          .eq('subscriber_id', managedId).order('depart_at', { ascending: true }),
        supabase.from('passengers').select('trip_id, status').eq('subscriber_id', managedId),
      ])
      setCached(key, {
        sub: subRes.data ?? null,
        trips: tripsRes.data ?? [],
        paxStats: buildPaxStats(paxRes.data ?? []),
      })
    } else if (profile.role === 'customer') {
      const key = `cust-dash:${userId}`
      if (getCached(key)) return
      // قراءة آمنة الأعمدة عبر الـVIEW (تستثني admin_notes/suspended_*/trial_*)
      let sq = supabase.from('v_subscriber_public').select('id, org_name, store_url, logo_url')
      sq = profile.subscriber_id ? sq.eq('id', profile.subscriber_id) : sq.limit(1)
      let tq = supabase.from('trips')
        .select('id, title, route_from, route_to, depart_at, return_at, capacity, bus_label, boarding_point, status, seating_policy, bus_rows, bus_back_row, price, notes')
        .order('depart_at', { ascending: true })
      if (profile.subscriber_id) tq = tq.eq('subscriber_id', profile.subscriber_id)
      const [subRes, tripsRes, bRes] = await Promise.all([
        sq.maybeSingle(), tq,
        supabase.from('passengers')
          .select('id, trip_id, full_name, seat_no, status, ticket_code, boarded_at, boarding_point, national_id, phone, gender, is_family, payment_ref')
          .eq('profile_id', userId),
      ])
      setCached(key, {
        sub: subRes.data ?? null,
        trips: tripsRes.data ?? [],
        bookings: bRes.data ?? [],
      })
    } else if (profile.role === 'admin') {
      const key = 'admin-dash'
      if (getCached(key)) return
      const { data } = await supabase.rpc('admin_campaign_stats')
      setCached(key, { subs: (data ?? []).map((r) => ({ ...r, id: r.subscriber_id })) })
    }
  } catch { /* silent — صفحة اللوحة ستجلب مجددا */ }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)   // { id, role, full_name, phone, subscriber_id }
  const [loading, setLoading] = useState(true)
  const profileRef = useRef(null)
  profileRef.current = profile                    // مرآة للملف الحالي (لتفادي جلب مكرر)

  /* تحميل الملف الشخصي (الدور + الحملة) — null-safe + self-heal. يعيد
     الملف المحمل ليستخدم فورا (بدل قراءته من state غير المحدث بعد). */
  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); return null }

    const { data, error } = await supabase
      .from('profiles').select(PROFILE_COLS).eq('id', uid).maybeSingle()
    if (error) {
      // eslint-disable-next-line no-console
      console.error('تعذر تحميل الملف الشخصي:', error.message)
      setProfile(null)
      return null
    }
    if (data) { setProfile(data); return data }

    // self-heal: لو غاب الملف (التريغر لم يفعل لحسابات قديمة) ننشئه من بيانات
    // التسجيل — مسموح بسياسة "profile self insert".
    const { data: u } = await supabase.auth.getUser()
    const md = u?.user?.user_metadata ?? {}
    // ★ أمان: لا نثق بالدور القادم من بيانات العميل (user_metadata) — قد يحقن
    //   بـ 'admin' عبر استدعاء signUp ملفق. الأدمن يمنح من قاعدة البيانات فقط.
    let safeRole = md.role === 'subscriber' ? 'subscriber' : 'customer'
    const { data: created, error: insErr } = await supabase
      .from('profiles')
      .insert({
        id: uid,
        role: safeRole,
        full_name: md.full_name ?? null,
        phone: md.phone ?? null,
        subscriber_id: md.subscriber_id ?? null,
      })
      .select(PROFILE_COLS)
      .maybeSingle()
    if (insErr) {
      // 23505 = المفتاح الأساسي: التريغر أنشأ الملف بالتوازي. ليس خطأ — أعد قراءته.
      if (insErr.code === '23505') {
        const { data: again } = await supabase
          .from('profiles').select(PROFILE_COLS).eq('id', uid).maybeSingle()
        setProfile(again ?? null)
        return again ?? null
      }
      // eslint-disable-next-line no-console
      console.error('تعذر إنشاء الملف الشخصي تلقائيا:', insErr.message,
        '— تأكد من تشغيل supabase/schema.sql (التريغر + سياسات profiles).')
      setProfile(null)
      return null
    }
    setProfile(created ?? null)
    return created ?? null
  }, [])

  useEffect(() => {
    let active = true

    // onAuthStateChange يطلق فورا حدث INITIAL_SESSION بالجلسة الحالية،
    // ثم كل دخول/خروج/تجديد. مصدر واحد للحقيقة. مع القفل الصوري في
    // supabaseClient يصل الحدث الأول خلال أجزاء الثانية بلا أي تجمد.
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (!active) return
      setSession(s ?? null)
      // تجديد التوكن (كل ساعة) لا يغير الملف الشخصي — لا نعيد جلبه (تفادي طلب مكرر).
      if (event === 'TOKEN_REFRESHED' && profileRef.current && profileRef.current.id === s?.user?.id) {
        if (active) setLoading(false)
        return
      }
      let loaded = null
      try { loaded = await loadProfile(s?.user?.id) }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('تعذر تحميل الملف:', e?.message || e)
        setProfile(null)
      } finally {
        if (active) setLoading(false)
        // بدأنا تحميل بيانات اللوحة الآن — لا ننتظر — فتكون جاهزة في الـ
        // cache قبل أن يصل المستخدم لصفحة Homes فعلا.
        if (active && loaded && s?.user?.id) {
          prefetchDashboard(loaded, s.user.id)
        }
      }
    })

    return () => { active = false; sub?.subscription?.unsubscribe?.() }
  }, [loadProfile])

  const signOut = useCallback(async () => {
    setProfile(null)
    invalidateAll()                  // أمان: لا تسريب بيانات لحساب آخر
    await supabase.auth.signOut()
  }, [])

  /* إيقاظ التطبيق بعد التعليق — منسق مركزي في lib/wake.js يتولى
     رفع الجلسة + إعادة تشغيل Realtime + بث ‎malbeek:wake‎ لكل المشتركين.
     يسجل مرة واحدة على مستوى التطبيق. */
  useEffect(() => installWakeListeners(), [])

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
