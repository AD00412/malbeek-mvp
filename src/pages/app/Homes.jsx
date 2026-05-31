import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/AuthProvider'
import CompassMark from '../../components/CompassMark'

/* ---------- شريط علوي مشترك ---------- */
function TopBar({ roleLabel }) {
  const { signOut, profile } = useAuth()
  return (
    <header className="app-bar">
      <CompassMark size={34} />
      <span className="nm">ملبّيك</span>
      <span className="role-tag">{roleLabel}</span>
      <span className="sp" />
      {profile?.full_name && <span style={{ color: 'var(--cream-200)', fontSize: 14 }}>{profile.full_name}</span>}
      <button className="btn btn-ghost" style={{ padding: '9px 16px' }} onClick={signOut}>خروج</button>
    </header>
  )
}

function fmtDate(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return '—' }
}

/* ============================================================
   لوحة الإدارة
   ============================================================ */
export function AdminHome() {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('subscribers')
        .select('id, org_name, slug, plan, created_at')
        .order('created_at', { ascending: false })
      if (active) { setSubs(data ?? []); setLoading(false) }
    })()
    return () => { active = false }
  }, [])

  return (
    <div className="app">
      <TopBar roleLabel="الإدارة" />
      <main className="app-main">
        <h1 className="app-h">لوحة الإدارة</h1>
        <p className="app-sub">إشرافٌ عامٌ على المشتركين في منصّة ملبّيك.</p>

        <section className="panel">
          <h3>المشتركون ({subs.length})</h3>
          {loading ? (
            <div className="empty">جارٍ التحميل…</div>
          ) : subs.length === 0 ? (
            <div className="empty">لا يوجد مشتركون بعد.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>الحملة</th><th>الرابط</th><th>الباقة</th><th>تاريخ الاشتراك</th></tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id}>
                    <td>{s.org_name}</td>
                    <td style={{ direction: 'ltr' }}><code style={{ color: 'var(--gold-300)' }}>/j/{s.slug}</code></td>
                    <td><span className={`st ${s.plan === 'paid' ? 'ok' : 'warn'}`}>{s.plan === 'paid' ? 'مدفوعة' : 'تجريبية'}</span></td>
                    <td>{fmtDate(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  )
}

/* ============================================================
   لوحة المشترك (صاحب الحملة)
   ============================================================ */
export function SubscriberHome() {
  const { user } = useAuth()
  const [sub, setSub] = useState(null)
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    const { data: s } = await supabase
      .from('subscribers')
      .select('id, org_name, slug, plan, trial_ends_at')
      .eq('owner_id', user.id)
      .maybeSingle()
    setSub(s ?? null)
    if (s?.id) {
      const { data: t } = await supabase
        .from('trips')
        .select('id, title, route_from, route_to, depart_at, status')
        .eq('subscriber_id', s.id)
        .order('created_at', { ascending: false })
      setTrips(t ?? [])
    }
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  // إضافة رحلة تجريبية سريعة (لإثبات الكتابة المحميّة)
  async function addSampleTrip() {
    if (!sub?.id) return
    await supabase.from('trips').insert({
      subscriber_id: sub.id,
      title: 'رحلة عُمرة',
      route_from: 'جازان',
      route_to: 'مكة المكرمة',
      depart_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      status: 'open',
    })
    load()
  }

  const shareUrl = sub?.slug ? `${window.location.origin}/j/${sub.slug}` : ''

  function copyLink() {
    if (!shareUrl) return
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="app">
      <TopBar roleLabel="المشترك" />
      <main className="app-main">
        <h1 className="app-h">{sub?.org_name || 'حملتي'}</h1>
        <p className="app-sub">
          {sub?.plan === 'paid' ? 'باقة ملبّيك — رحلاتٌ غير محدودة.' : `الباقة التجريبية — حتى ${fmtDate(sub?.trial_ends_at)}.`}
        </p>

        <section className="panel">
          <h3>رابط تسجيل العملاء</h3>
          <p style={{ color: 'var(--cream-200)', fontWeight: 300, fontSize: 14, marginBottom: 4 }}>
            شارك هذا الرابط مع معتمري حملتك — كلٌّ يسجّل بياناته ويرى رحلاتك فقط.
          </p>
          <div className="share-box">
            <code>{shareUrl || '—'}</code>
            <span className="sp" style={{ flex: 1 }} />
            <button className="btn btn-em" style={{ padding: '9px 16px' }} onClick={copyLink} disabled={!shareUrl}>
              {copied ? 'تم النسخ ✓' : 'نسخ الرابط'}
            </button>
          </div>
        </section>

        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0 }}>الرحلات ({trips.length})</h3>
            <span className="sp" style={{ flex: 1 }} />
            <button className="btn btn-gold" style={{ width: 'auto', padding: '10px 18px' }} onClick={addSampleTrip} disabled={!sub}>
              + رحلة سريعة
            </button>
          </div>
          {loading ? (
            <div className="empty">جارٍ التحميل…</div>
          ) : trips.length === 0 ? (
            <div className="empty">لا توجد رحلاتٌ بعد — أضف أول رحلة.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>الرحلة</th><th>المسار</th><th>الإقلاع</th><th>الحالة</th></tr>
              </thead>
              <tbody>
                {trips.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>{(t.route_from || '—') + ' ← ' + (t.route_to || '—')}</td>
                    <td>{fmtDate(t.depart_at)}</td>
                    <td><span className={`st ${t.status === 'open' ? 'ok' : 'warn'}`}>{t.status === 'open' ? 'مفتوحة' : t.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  )
}

/* ============================================================
   لوحة العميل (المعتمر) — يرى رحلات حملته فقط
   لا نُرسل أي فلترة يدوية؛ سياسة RLS تتكفّل بالعزل تلقائيًا
   ============================================================ */
export function CustomerHome() {
  const { subscriberId } = useAuth()
  const [orgName, setOrgName] = useState('')
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      // اسم الحملة (RLS يسمح للعميل بقراءة حملته فقط)
      const { data: s } = await supabase
        .from('subscribers')
        .select('org_name')
        .maybeSingle()
      if (active && s) setOrgName(s.org_name)

      // الرحلات — تُعزل تلقائيًا لحملة العميل عبر RLS
      const { data: t } = await supabase
        .from('trips')
        .select('id, title, route_from, route_to, depart_at, status')
        .order('depart_at', { ascending: true })
      if (active) { setTrips(t ?? []); setLoading(false) }
    })()
    return () => { active = false }
  }, [subscriberId])

  return (
    <div className="app">
      <TopBar roleLabel="العميل" />
      <main className="app-main">
        <h1 className="app-h">أهلًا بك</h1>
        <p className="app-sub">{orgName ? `رحلات حملة ${orgName} المتاحة لك.` : 'رحلاتك المتاحة.'}</p>

        <section className="panel">
          <h3>الرحلات المتاحة ({trips.length})</h3>
          {loading ? (
            <div className="empty">جارٍ التحميل…</div>
          ) : trips.length === 0 ? (
            <div className="empty">لا توجد رحلاتٌ متاحةٌ حاليًا.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>الرحلة</th><th>المسار</th><th>الإقلاع</th><th>الحالة</th></tr>
              </thead>
              <tbody>
                {trips.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>{(t.route_from || '—') + ' ← ' + (t.route_to || '—')}</td>
                    <td>{fmtDate(t.depart_at)}</td>
                    <td><span className={`st ${t.status === 'open' ? 'ok' : 'warn'}`}>{t.status === 'open' ? 'مفتوحة' : t.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p style={{ color: 'var(--cream-200)', fontWeight: 300, fontSize: 13, marginTop: 18, textAlign: 'center' }}>
          🔒 تُعرض لك رحلات حملتك فقط — بياناتك معزولةٌ تمامًا عن بقية الحملات.
        </p>
      </main>
    </div>
  )
}
