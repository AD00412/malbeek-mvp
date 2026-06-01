import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import AppShell from '../../layout/AppShell'
import Icon from '../../components/Icon'
import CompassMark from '../../components/CompassMark'
import TripFormModal from '../../components/TripFormModal'

/* ---------- أدوات عرض مشتركة ---------- */
const TRIP_STATUS_LABEL = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', done: 'منتهية' }
const TRIP_STATUS_CLASS = { draft: 'muted', open: 'ok', closed: 'warn', done: 'done' }

function fmtDate(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return '—' }
}

function StatusPill({ status }) {
  return <span className={`st ${TRIP_STATUS_CLASS[status] || 'muted'}`}>{TRIP_STATUS_LABEL[status] || status || '—'}</span>
}

/* حالةٌ فارغةٌ أنيقة */
function Empty({ title, hint }) {
  return (
    <div className="empty">
      <div className="em-mark"><CompassMark size={56} /></div>
      {title && <div className="em-ttl">{title}</div>}
      {hint && <div>{hint}</div>}
    </div>
  )
}

/* لوحة "قريبًا" لعناصر خارطة الطريق */
function ComingSoon({ title, desc }) {
  return (
    <section className="panel">
      <Empty title={title} hint={desc} />
    </section>
  )
}

/* ============================================================
   لوحة الإدارة
   ============================================================ */
export function AdminHome() {
  const [view, setView] = useState('overview')
  const [subs, setSubs] = useState([])
  const [tripCount, setTripCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: s } = await supabase
        .from('subscribers').select('id, org_name, slug, plan, created_at')
        .order('created_at', { ascending: false })
      const { count } = await supabase.from('trips').select('id', { count: 'exact', head: true })
      if (!active) return
      setSubs(s ?? [])
      setTripCount(count ?? 0)
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  const nav = [
    { section: 'الإدارة' },
    { key: 'overview', label: 'نظرة عامة', icon: 'dashboard' },
    { key: 'subs', label: 'المشتركون', icon: 'building', badge: subs.length || undefined },
  ]
  const paid = subs.filter((s) => s.plan === 'paid').length

  return (
    <AppShell
      title="لوحة الإدارة"
      subtitle="إشرافٌ عامٌ على منصّة ملبّيك"
      nav={nav}
      active={view}
      onNav={setView}
    >
      {view === 'overview' && (
        <>
          <div className="stats">
            <div className="stat"><span className="ic"><Icon name="building" /></span><div className="k">المشتركون</div><div className="v">{subs.length}</div></div>
            <div className="stat"><span className="ic"><Icon name="payments" /></span><div className="k">الباقات المدفوعة</div><div className="v">{paid}</div></div>
            <div className="stat"><span className="ic"><Icon name="trips" /></span><div className="k">إجمالي الرحلات</div><div className="v">{tripCount}</div></div>
          </div>
          <SubsPanel subs={subs} loading={loading} />
        </>
      )}
      {view === 'subs' && <SubsPanel subs={subs} loading={loading} />}
    </AppShell>
  )
}

function SubsPanel({ subs, loading }) {
  return (
    <section className="panel">
      <div className="panel-head"><h3>المشتركون</h3><span className="sub">({subs.length})</span></div>
      {loading ? (
        <Empty title="جارٍ التحميل…" />
      ) : subs.length === 0 ? (
        <Empty title="لا يوجد مشتركون بعد" hint="ستظهر الحملات هنا فور تسجيلها." />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>الحملة</th><th>الرابط</th><th>الباقة</th><th>تاريخ الاشتراك</th></tr></thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td>{s.org_name}</td>
                  <td className="ltr" style={{ textAlign: 'right' }}><code className="gold">/j/{s.slug}</code></td>
                  <td><span className={`st ${s.plan === 'paid' ? 'ok' : 'warn'}`}>{s.plan === 'paid' ? 'مدفوعة' : 'تجريبية'}</span></td>
                  <td>{fmtDate(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* ============================================================
   لوحة المشترك (صاحب الحملة)
   ============================================================ */
export function SubscriberHome() {
  const { user, profile, refreshProfile } = useAuth()
  const [view, setView] = useState('overview')
  const [sub, setSub] = useState(null)
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const creatingRef = useRef(false)

  const load = useCallback(async () => {
    if (!user?.id) return
    setLoading(true); setErr('')

    // أقدم حملةٍ للمالك (limit 1) — مرنٌ تجاه أي تكرارٍ سابق
    const { data: rows, error: sErr } = await supabase
      .from('subscribers')
      .select('id, org_name, slug, plan, trial_ends_at')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
    if (sErr) { setErr('تعذّر تحميل بيانات الحملة: ' + sErr.message); setLoading(false); return }

    let s = rows?.[0] ?? null

    // self-heal: إنشاء الحملة تلقائيًّا إن غابت (تسجيلٌ بتأكيد بريدٍ مفعّل)
    if (!s && !creatingRef.current) {
      creatingRef.current = true
      const slug = 'hamla-' + Math.random().toString(36).slice(2, 8)
      const orgName = profile?.full_name ? `حملة ${profile.full_name}` : 'حملتي'
      const { data: created, error: insErr } = await supabase
        .from('subscribers')
        .insert({ owner_id: user.id, org_name: orgName, slug, plan: 'trial' })
        .select('id, org_name, slug, plan, trial_ends_at')
        .maybeSingle()
      if (insErr) { creatingRef.current = false; setErr('تعذّر إنشاء حملتك تلقائيًّا: ' + insErr.message); setLoading(false); return }
      s = created
      if (s?.id) {
        const { error: upErr } = await supabase.from('profiles').update({ subscriber_id: s.id }).eq('id', user.id)
        if (!upErr) await refreshProfile?.()
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
    } else setTrips([])
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
    navigator.clipboard?.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) })
  }

  const totalSeats = trips.reduce((sum, t) => sum + (Number(t.capacity) || 0), 0)
  const planLabel = sub?.plan === 'paid' ? 'مدفوعة' : 'تجريبية'

  const nav = [
    { section: 'حملتي' },
    { key: 'overview', label: 'نظرة عامة', icon: 'dashboard' },
    { key: 'trips', label: 'الرحلات', icon: 'trips', badge: trips.length || undefined },
    { key: 'share', label: 'رابط التسجيل', icon: 'share' },
    { section: 'قريبًا' },
    { key: 'customers', label: 'المعتمرون', icon: 'customers', disabled: true },
    { key: 'manifest', label: 'الكشف الرسمي', icon: 'manifest', disabled: true },
    { key: 'settings', label: 'إعدادات المؤسسة', icon: 'settings', disabled: true },
  ]

  const addBtn = (
    <button className="btn btn-gold btn-sm" onClick={openCreate} disabled={!sub || loading}>
      <Icon name="plus" size={17} /> رحلة جديدة
    </button>
  )

  return (
    <AppShell
      title={sub?.org_name || 'حملتي'}
      subtitle={sub?.plan === 'paid' ? 'باقة ملبّيك — رحلاتٌ غير محدودة' : `الباقة التجريبية — حتى ${fmtDate(sub?.trial_ends_at)}`}
      nav={nav}
      active={view}
      onNav={setView}
      actions={view === 'trips' ? addBtn : null}
    >
      {err && <div className="alert err" style={{ marginBottom: 4 }}>{err}</div>}

      {view === 'overview' && (
        <>
          <div className="stats">
            <div className="stat"><span className="ic"><Icon name="trips" /></span><div className="k">الرحلات</div><div className="v">{trips.length}</div></div>
            <div className="stat"><span className="ic"><Icon name="seat" /></span><div className="k">إجمالي المقاعد</div><div className="v">{totalSeats}</div></div>
            <div className="stat"><span className="ic"><Icon name="payments" /></span><div className="k">الباقة</div><div className="v" style={{ fontSize: 22 }}>{planLabel}</div></div>
          </div>
          <SharePanel shareUrl={shareUrl} copied={copied} copyLink={copyLink} />
          <TripsPanel trips={trips} loading={loading} sub={sub} onCreate={openCreate} onEdit={openEdit} onRemove={remove} compact />
        </>
      )}

      {view === 'trips' && (
        <TripsPanel trips={trips} loading={loading} sub={sub} onCreate={openCreate} onEdit={openEdit} onRemove={remove} />
      )}

      {view === 'share' && <SharePanel shareUrl={shareUrl} copied={copied} copyLink={copyLink} expanded />}

      {view === 'customers' && <ComingSoon title="تعبئة بيانات المعتمرين" desc="ضمن خارطة الطريق — المرحلة التالية بعد الكشف الرسمي." />}
      {view === 'manifest' && <ComingSoon title="الكشف الرسمي للباص" desc="٩ أعمدة بترويسة المؤسسة والختم وإصدار PDF/طباعة — قيد البناء التالي." />}
      {view === 'settings' && <ComingSoon title="إعدادات المؤسسة" desc="شعار وختم المؤسسة، بيانات السائق والمشرف، خيارات الكشف — قريبًا." />}

      {modalOpen && sub && (
        <TripFormModal trip={editing} subscriberId={sub.id} onClose={closeModal} onSaved={handleSaved} />
      )}
    </AppShell>
  )
}

function SharePanel({ shareUrl, copied, copyLink, expanded }) {
  return (
    <section className="panel">
      <div className="panel-head"><h3>رابط تسجيل العملاء</h3></div>
      <p className="muted" style={{ fontSize: 14, marginBottom: 10 }}>
        شارك هذا الرابط مع معتمري حملتك — كلٌّ يسجّل بياناته ويرى رحلاتك فقط.
      </p>
      <div className="share-box">
        <code>{shareUrl || '—'}</code>
        <span className="sp-grow" />
        <button className="btn btn-em btn-sm" onClick={copyLink} disabled={!shareUrl}>
          <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'تم النسخ' : 'نسخ الرابط'}
        </button>
      </div>
      {expanded && (
        <p className="dim" style={{ fontSize: 13, marginTop: 14 }}>
          🔒 كل من يسجّل عبر هذا الرابط يُربط بحملتك تلقائيًّا، ولا يرى رحلات أي حملةٍ أخرى.
        </p>
      )}
    </section>
  )
}

function TripsPanel({ trips, loading, sub, onCreate, onEdit, onRemove, compact }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>الرحلات</h3><span className="sub">({trips.length})</span>
        <span className="sp-grow" />
        {!compact && (
          <button className="btn btn-gold btn-sm" onClick={onCreate} disabled={!sub}>
            <Icon name="plus" size={17} /> رحلة جديدة
          </button>
        )}
      </div>

      {loading ? (
        <Empty title="جارٍ التحميل…" />
      ) : !sub ? (
        <Empty title="لم يتم العثور على حملتك" hint="حدّث الصفحة، أو تواصل مع الدعم إن استمرّ." />
      ) : trips.length === 0 ? (
        <Empty title="لا توجد رحلاتٌ بعد" hint="أضف أوّل رحلةٍ لتبدأ تنظيم حملتك." />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>الرحلة</th><th>المسار</th><th>الذهاب</th><th>السعة</th><th>الحالة</th><th>إجراءات</th></tr>
            </thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.title || '—'}
                    {t.bus_label && <div className="cell-sub">باص: {t.bus_label}</div>}
                  </td>
                  <td>{(t.route_from || '—') + ' ← ' + (t.route_to || '—')}</td>
                  <td>{fmtDate(t.depart_at)}</td>
                  <td>{Number(t.capacity) > 0 ? t.capacity : '—'}</td>
                  <td><StatusPill status={t.status} /></td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" onClick={() => onEdit(t)}><Icon name="edit" size={15} /> تعديل</button>
                      <button className="icon-btn danger" onClick={() => onRemove(t)}><Icon name="trash" size={15} /> حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* ============================================================
   لوحة العميل (المعتمر) — يرى رحلات حملته فقط عبر RLS
   ============================================================ */
export function CustomerHome() {
  const { subscriberId } = useAuth()
  const [view, setView] = useState('trips')
  const [orgName, setOrgName] = useState('')
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: s } = await supabase.from('subscribers').select('org_name').limit(1).maybeSingle()
      if (active && s) setOrgName(s.org_name)
      const { data: t } = await supabase
        .from('trips')
        .select('id, title, route_from, route_to, depart_at, status')
        .order('depart_at', { ascending: true })
      if (active) { setTrips(t ?? []); setLoading(false) }
    })()
    return () => { active = false }
  }, [subscriberId])

  const nav = [
    { section: 'رحلاتي' },
    { key: 'trips', label: 'الرحلات المتاحة', icon: 'trips', badge: trips.length || undefined },
    { section: 'قريبًا' },
    { key: 'ticket', label: 'تذكرتي والباركود', icon: 'barcode', disabled: true },
    { key: 'profile', label: 'بياناتي', icon: 'customers', disabled: true },
  ]

  return (
    <AppShell
      title="أهلًا بك"
      subtitle={orgName ? `رحلات حملة ${orgName} المتاحة لك` : 'رحلاتك المتاحة'}
      nav={nav}
      active={view}
      onNav={setView}
    >
      {view === 'trips' && (
        <section className="panel">
          <div className="panel-head"><h3>الرحلات المتاحة</h3><span className="sub">({trips.length})</span></div>
          {loading ? (
            <Empty title="جارٍ التحميل…" />
          ) : trips.length === 0 ? (
            <Empty title="لا توجد رحلاتٌ متاحةٌ حاليًا" hint="ستظهر رحلات حملتك هنا فور إتاحتها." />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>الرحلة</th><th>المسار</th><th>الذهاب</th><th>الحالة</th></tr></thead>
                <tbody>
                  {trips.map((t) => (
                    <tr key={t.id}>
                      <td>{t.title || '—'}</td>
                      <td>{(t.route_from || '—') + ' ← ' + (t.route_to || '—')}</td>
                      <td>{fmtDate(t.depart_at)}</td>
                      <td><StatusPill status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="dim" style={{ fontSize: 13, marginTop: 18, textAlign: 'center' }}>
            🔒 تُعرض لك رحلات حملتك فقط — بياناتك معزولةٌ تمامًا عن بقية الحملات.
          </p>
        </section>
      )}

      {view === 'ticket' && <ComingSoon title="تذكرتي والباركود" desc="تذكرة الصعود بالباركود وحفظها في محفظة الجوال — ضمن خارطة الطريق." />}
      {view === 'profile' && <ComingSoon title="بياناتي المحفوظة" desc="بياناتك تُحفظ دائمًا لتعيد الطلب بلا تعبئة — قريبًا." />}
    </AppShell>
  )
}
