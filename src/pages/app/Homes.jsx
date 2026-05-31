import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/AuthProvider'
import CompassMark from '../../components/CompassMark'
import TripFormModal from '../../components/TripFormModal'

/* خرائط عرض حالة الرحلة (نص عربي + لون شارة) */
const TRIP_STATUS_LABEL = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', done: 'منتهية' }
const TRIP_STATUS_CLASS = { draft: 'muted', open: 'ok', closed: 'warn', done: 'done' }

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
   لوحة المشترك (صاحب الحملة) — إدارة رحلات كاملة
   ============================================================ */
export function SubscriberHome() {
  const { user } = useAuth()
  const [sub, setSub]         = useState(null)
  const [trips, setTrips]     = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')
  const [copied, setCopied]   = useState(false)

  // حالة النافذة: open + الرحلة قيد التعديل (null = إنشاء جديد)
  const [modalOpen, setModalOpen]     = useState(false)
  const [editingTrip, setEditingTrip] = useState(null)
  // حالة الحذف الجاري (id الرحلة) لتعطيل زر الحذف فقط لها
  const [deletingId, setDeletingId]   = useState(null)

  const load = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    setErr('')
    try {
      // ١) اقرأ حملة المالك (مرّةً واحدة لكل تحميل)
      const { data: s, error: sErr } = await supabase
        .from('subscribers')
        .select('id, org_name, slug, plan, trial_ends_at')
        .eq('owner_id', user.id)
        .maybeSingle()
      if (sErr) throw sErr
      setSub(s ?? null)

      // ٢) اقرأ رحلات الحملة بكل الأعمدة التي يحتاجها الجدول/النموذج
      if (s?.id) {
        const { data: t, error: tErr } = await supabase
          .from('trips')
          .select('id, title, route_from, route_to, depart_at, return_at, capacity, bus_label, boarding_point, status, notes, created_at')
          .eq('subscriber_id', s.id)
          .order('depart_at', { ascending: true, nullsFirst: false })
        if (tErr) throw tErr
        setTrips(t ?? [])
      } else {
        setTrips([])
      }
    } catch (e) {
      setErr(typeof e?.message === 'string' ? e.message : 'تعذّر تحميل البيانات.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { load() }, [load])

  // فتح نافذة الإنشاء/التعديل
  function openCreate() { setEditingTrip(null); setModalOpen(true) }
  function openEdit(trip) { setEditingTrip(trip); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditingTrip(null) }

  async function deleteTrip(trip) {
    if (!trip?.id) return
    const ok = window.confirm(`هل تريد حذف هذه الرحلة؟\n«${trip.title || 'رحلة'}»`)
    if (!ok) return
    setDeletingId(trip.id)
    setErr('')
    try {
      const { error } = await supabase.from('trips').delete().eq('id', trip.id)
      if (error) throw error
      await load()
    } catch (e) {
      setErr(typeof e?.message === 'string' ? e.message : 'تعذّر حذف الرحلة.')
    } finally {
      setDeletingId(null)
    }
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
            <button
              className="btn btn-gold"
              style={{ width: 'auto', padding: '10px 18px' }}
              onClick={openCreate}
              disabled={!sub || loading}
            >
              ＋ رحلة جديدة
            </button>
          </div>

          {err && <div className="alert err" style={{ marginBottom: 12 }}>{err}</div>}

          {loading ? (
            <div className="empty">جارٍ التحميل…</div>
          ) : trips.length === 0 ? (
            <div className="empty">لا توجد رحلاتٌ بعد — أضف أوّل رحلة.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>الرحلة</th>
                  <th>المسار</th>
                  <th>الذهاب</th>
                  <th>السعة</th>
                  <th>الحالة</th>
                  <th style={{ textAlign: 'end' }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((t) => {
                  const stCls = TRIP_STATUS_CLASS[t.status] || 'muted'
                  const stLbl = TRIP_STATUS_LABEL[t.status] || (t.status || '—')
                  return (
                    <tr key={t.id}>
                      <td>{t.title || '—'}</td>
                      <td>{(t.route_from || '—') + ' ← ' + (t.route_to || '—')}</td>
                      <td>{fmtDate(t.depart_at)}</td>
                      <td>{Number.isFinite(t.capacity) && t.capacity > 0 ? t.capacity : '—'}</td>
                      <td><span className={`st ${stCls}`}>{stLbl}</span></td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => openEdit(t)}
                            disabled={deletingId === t.id}
                          >
                            تعديل
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => deleteTrip(t)}
                            disabled={deletingId === t.id}
                          >
                            {deletingId === t.id ? <span className="spinner" /> : 'حذف'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>

      <TripFormModal
        open={modalOpen}
        trip={editingTrip}
        subscriberId={sub?.id ?? null}
        onClose={closeModal}
        onSaved={async () => { closeModal(); await load() }}
      />
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
