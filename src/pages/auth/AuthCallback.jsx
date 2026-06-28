import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import { homeForRole } from '../../app/RequireAuth'
import { readOAuthIntent, clearOAuthIntent } from '../../lib/oauth'
import AuthShell from './AuthShell'
import Icon from '../../components/Icon'

/**
 * صفحةُ عودة OAuth — تُكمل التزويد بحسب «النيّة» المحفوظة قبل التحويل.
 * supabaseClient مضبوطٌ بـ detectSessionInUrl + flowType:'pkce' فيتبادل
 * الكود تلقائيًّا؛ ننتظر الجلسة ثمّ ننفّذ التزويد عبر RPCs آمنة.
 */
export default function AuthCallback() {
  const nav = useNavigate()
  const { refreshProfile } = useAuth()
  const [err, setErr] = useState('')
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    let cancelled = false

    ;(async () => {
      // ١) انتظر الجلسة (قد يحتاج تبادلُ الكود لحظات)
      let session = null
      for (let i = 0; i < 12 && !cancelled; i++) {
        const { data } = await supabase.auth.getSession()
        if (data?.session) { session = data.session; break }
        await new Promise((r) => setTimeout(r, 300))
      }
      if (cancelled) return
      if (!session) {
        clearOAuthIntent()
        setErr('تعذّر إكمال الدخول عبر Google. حاول مجددا.')
        return
      }

      const uid = session.user.id
      const intent = readOAuthIntent() || { kind: 'login' }

      try {
        if (intent.kind === 'subscriber') {
          // مشتركٌ جديد: ترقيةٌ آمنة عبر RPC (تُنشئ الحملة + ترفع الدور)
          const { error } = await supabase.rpc('provision_subscriber_after_oauth', {
            p_org_name: (intent.orgName || '').trim() || 'حملتي',
          })
          if (error) throw error
          clearOAuthIntent(); await refreshProfile()
          if (!cancelled) nav('/dashboard', { replace: true })
          return
        }

        if (intent.kind === 'customer' && intent.subscriberId) {
          // معتمرٌ ينضمّ لحملة: ربطٌ آمن عبر RPC ثمّ إنشاء سجلّ المعتمر
          const { error } = await supabase.rpc('link_customer_to_campaign', {
            p_subscriber_id: intent.subscriberId,
          })
          if (error) throw error
          await refreshProfile()
          // سجلّ المعتمر (إن توفّرت بياناته من نموذج الانضمام) — اختياريّ، يُكمل لاحقًا بالحجز
          if (intent.fullName || intent.nationalId) {
            await supabase.from('customers').insert({
              subscriber_id: intent.subscriberId,
              profile_id: uid,
              full_name: intent.fullName || session.user.user_metadata?.full_name || null,
              national_id: intent.nationalId || null,
              phone: intent.phone || null,
              pickup_location: intent.pickupLocation || null,
            }).then(() => {}, () => {})  // 23505/أخطاء غير حرجة تُتجاهَل بهدوء
          }
          clearOAuthIntent()
          if (!cancelled) nav('/customer', { replace: true })
          return
        }

        if (intent.kind === 'staff-invite' && intent.returnTo) {
          // الموظّف: نعيده لصفحة الدعوة ليُكمل التدفّق متعدّد المراحل وهو مُصادَق
          clearOAuthIntent()
          if (!cancelled) nav(intent.returnTo, { replace: true })
          return
        }

        // login أو بلا نيّة: وجّه بحسب الدور الفعليّ
        clearOAuthIntent()
        const prof = await refreshProfile()
        if (!cancelled) nav(homeForRole(prof?.role), { replace: true })
      } catch (e) {
        clearOAuthIntent()
        if (!cancelled) {
          const m = String(e?.message || '')
          if (/already.*linked|مرتبط/i.test(m)) {
            // الملف مرتبطٌ مسبقًا — وجّهه بدوره بدل إظهار خطأ
            const prof = await refreshProfile()
            nav(homeForRole(prof?.role), { replace: true })
          } else {
            setErr('تعذّر تجهيز حسابك. ' + (m || 'حاول مجددا أو تواصل مع الدعم.'))
          }
        }
      }
    })()

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (err) {
    return (
      <AuthShell title="تعذّر الإكمال" sub="حدثت مشكلة أثناء الدخول عبر Google." footer={<Link to="/login">العودة لتسجيل الدخول</Link>}>
        <div className="auth-form">
          <div className="alert err" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="lock" size={18} />
            <div style={{ flex: 1, lineHeight: 1.7 }}>{err}</div>
          </div>
          <Link to="/login" className="btn btn-em btn-block" style={{ textDecoration: 'none' }}>العودة لتسجيل الدخول</Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="جارٍ تجهيز حسابك…" sub="لحظات ونكمل دخولك عبر Google.">
      <div className="auth-form" style={{ display: 'grid', placeItems: 'center', minHeight: 120 }}>
        <span className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    </AuthShell>
  )
}
