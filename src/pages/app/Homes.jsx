import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import CompassMark from '../../components/CompassMark'
import TripFormModal from '../../components/TripFormModal'

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

const STATUS_LABEL = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', done: 'منتهية' }
function statusClass(s) { return s === 'open' ? 'ok' : 'warn' }

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
  const { user, profile, refreshProfile } = useAuth()
  const [sub, setSub] = useState(null)
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    if (!user?.id) return
    setLoading(true); setErr('')

    let { data: s, error: sErr } = await supabase
      .from('subscribers')
      .select('id, org_name, slug, plan, trial_ends_at')
      .eq('owner_id', user.id)
      .maybeSingle()

    if (sErr) { setErr('تعذّر تحميل بيانات الحملة: ' + sErr.message); setLoading(false); return }

    // self-heal: إن كان المستخدم مشتركًا بلا صفّ subscribers (مثلًا سجّل و«Confirm Email»
    // مفعَّل فعاد بعد التأكيد ولم يُنشئ سجلّ الحملة)، أنشئه تلقائيًّا واربطه بالملف الشخصي.
    if (!s) {
      const slug = 'hamla-' + Math.random().toString(36).slice(2, 8)
      const orgName = profile?.full_name ? `حملة ${profile.full_name}` : 'حملتي'
      const { data: created, error: insErr } = await supabase
        .from('subscribers')
        .insert({ owner_id: user.id, org_name: orgName, slug, plan: 'trial' })
        .select('id, org_name, slug, plan, trial_ends_at')
        .maybeSingle()
      if (insErr) {
        setErr('تعذّر إنشاء حملتك تلقائيًّا: ' + insErr.message)
        setLoading(false); return
      }
      s = created
      // اربط الحملة بالملف الشخصي ثم حدّث AuthProvider ليلتقط subscriber_id الجديد
      if (s?.id) {
        const { error: upErr } = await supabase
          .from('profiles').update({ subscriber_id: s.id }).eq('id', user.id)
        if (upErr) {
          // eslint-disable-next-line no-console
          console.warn('تعذّر ربط الحملة بالملف الشخصي:', upErr.message)
        } else {
          await refreshProfile?.()
        }
      }
    }
    setSub(s ?? null)

    if (s?.id) {
      const { data: t, error: tErr } = await supabase
        .from('trips')
        .select('id, title, route_from, route_to, depart_at, return_at, capacity, bus_label, boarding_point, status, notes')
        .eq('subscriber_id', s.id)
        .order('depart_at', { ascending: true })
      if (tErr) { setErr('تعذّر تحميل الرحلات: ' + tErr.message); setTrips([]) }
      else setTrips(t ?? [])
    } else {
      setTrips([])
    }
    setLoading(false)
  }, [user, profile, refreshProfile])

  useEffect(() => { load() }, [load])

  function openCreate() { setEditing(null); setModalOpen(true) }
  function openEdit(t) { setEditing(t); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(null) }
  function handleSaved() { closeModal(); load() }

  async function remove(t) {
    if (!t?.id) return
    if (!window.confirm(`هل تريد حذف رحلة «${t.title}»؟ لا يمكن التراجع.`)) return
    const { error } = await supabase.from('trips').delete().eq('id', t.id)
    if (error) { setErr('تعذّر حذف الرحلة: ' + error.message); return }
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

        {err && <div className="alert err" style={{ marginTop: 18 }}>{err}</div>}

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
            <button className="btn btn-gold" style={{ width: 'auto', padding: '10px 18px' }} onClick={openCreate} disabled={!sub}>
              ＋ رحلة جديدة
            </button>
          </div>

          {loading ? (
            <div className="empty">جارٍ التحميل…</div>
          ) : !sub ? (
            <div className="empty">لم يتم العثور على حملتك. تواصل مع الدعم.</div>
          ) : trips.length === 0 ? (
            <div className="empty">لا توجد رحلاتٌ بعد — أضف أول رحلة.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>الرحلة</th><th>المسار</th><th>الذهاب</th><th>السعة</th><th>الحالة</th><th>إجراءات</th></tr>
              </thead>
              <tbody>
                {trips.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.title}
                      {t.bus_label && <div className="muted">باص: {t.bus_label}</div>}
                    </td>
                    <td>{(t.route_from || '—') + ' ← ' + (t.route_to || '—')}</td>
                    <td>{fmtDate(t.depart_at)}</td>
                    <td>{t.capacity ?? 0}</td>
                    <td><span className={`st ${statusClass(t.status)}`}>{STATUS_LABEL[t.status] || t.status}</span></td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-btn" onClick={() => openEdit(t)}>تعديل</button>
                        <button className="icon-btn danger" onClick={() => remove(t)}>حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>

      {modalOpen && sub && (
        <TripFormModal
          trip={editing}
          subscriberId={sub.id}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
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
                    <td><span className={`st ${t.status === 'open' ? 'ok' : 'warn'}`}>{STATUS_LABEL[t.status] || t.status}</span></td>
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
