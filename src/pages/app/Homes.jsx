import { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../app/useAuth'
import AppShell from '../../layout/AppShell'
import Icon from '../../components/Icon'
import CompassMark from '../../components/CompassMark'
import TripFormModal from '../../components/TripFormModal'
import BottomSheet from '../../components/BottomSheet'
import Roadmap from '../../components/Roadmap'
import CustomerBooking from '../../components/CustomerBooking'
import FeedbackSheet from '../../components/FeedbackSheet'
import FeedbackInbox from '../../components/FeedbackInbox'
import OnboardingChecklist from '../../components/OnboardingChecklist'
import CampaignAnalytics from '../../components/CampaignAnalytics'
import TripManage from './TripManage'

/* ---------- أدوات عرض مشتركة ---------- */
const STATUS_LABEL = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', done: 'منتهية' }
const STATUS_TAG   = { draft: 'muted', open: 'ok', closed: 'warn', done: 'info' }
const STATUS_FUTURE_LABEL = { draft: 'مسودة', open: 'قادمة', closed: 'نشطة', done: 'منتهية' }

function fmtDate(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return '—' }
}
function fmtShort(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: '2-digit' }) }
  catch { return '—' }
}

/* حالةٌ فارغةٌ أنيقة */
function Empty({ title, hint, mark = true }) {
  return (
    <div className="empty">
      {mark && <div className="em-mark"><CompassMark size={56} /></div>}
      {title && <div className="em-ttl">{title}</div>}
      {hint && <div>{hint}</div>}
    </div>
  )
}

function ComingSoon({ title, desc }) {
  return (
    <section className="panel">
      <Empty title={title} hint={desc} />
    </section>
  )
}

/* ============================================================
   لوحة الإدارة (تبقى بسيطةً للآن)
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

  const tabs = [
    { section: 'الإدارة' },
    { key: 'overview', label: 'الرئيسية', icon: 'dashboard' },
    { key: 'subs', label: 'المشتركون', icon: 'building', badge: subs.length || undefined },
    { key: 'feedback', label: 'التغذية الراجعة', icon: 'message' },
  ]
  const paid = subs.filter((s) => s.plan === 'paid').length

  return (
    <>
      <AppShell title="لوحة الإدارة" subtitle="إشرافٌ عامٌ على منصّة ملبّيك" tabs={tabs} active={view} onTab={setView}>
        {view === 'overview' && (
          <>
            <div className="stats">
              <div className="stat"><div className="top"><span className="ic"><Icon name="building" size={15} /></span>المشتركون</div><div className="v">{subs.length}</div></div>
              <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={15} /></span>الباقات المدفوعة</div><div className="v">{paid}</div></div>
              <div className="stat info"><div className="top"><span className="ic"><Icon name="trips" size={15} /></span>إجمالي الرحلات</div><div className="v">{tripCount}</div></div>
            </div>
            <SubsPanel subs={subs} loading={loading} />
            <FeedbackInbox />
          </>
        )}
        {view === 'subs' && <SubsPanel subs={subs} loading={loading} />}
        {view === 'feedback' && <FeedbackInbox />}
      </AppShell>
      <Roadmap />
    </>
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
                  <td className="ltr" style={{ textAlign: 'right' }}><code style={{ color: 'var(--gd-300)' }}>/j/{s.slug}</code></td>
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
   لوحة المشترك — تجربةٌ موبايل أوّلًا
   ============================================================ */
export function SubscriberHome() {
  const { user, profile, refreshProfile } = useAuth()
  const [view, setView] = useState('overview')
  const [sub, setSub] = useState(null)
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [filter, setFilter] = useState('all')   // all | upcoming | active | done
  const [search, setSearch] = useState('')
  const [managing, setManaging] = useState(null) // الرحلة قيد الإدارة (شاشة كاملة)
  const [paxStats, setPaxStats] = useState({ byTrip: new Map(), totals: { count: 0, paid: 0, boarded: 0, checked_in: 0 } })
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const creatingRef = useRef(false)

  const load = useCallback(async () => {
    if (!user?.id) return
    setLoading(true); setErr('')

    const { data: rows, error: sErr } = await supabase
      .from('subscribers')
      .select('id, org_name, slug, plan, trial_ends_at, license_no, contact_phone, stamp_text, store_url')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
    if (sErr) { setErr('تعذّر تحميل بيانات الحملة: ' + sErr.message); setLoading(false); return }

    let s = rows?.[0] ?? null

    if (!s && !creatingRef.current) {
      creatingRef.current = true
      const slug = 'hamla-' + Math.random().toString(36).slice(2, 8)
      const orgName = profile?.full_name ? `حملة ${profile.full_name}` : 'حملتي'
      const { data: created, error: insErr } = await supabase
        .from('subscribers')
        .insert({ owner_id: user.id, org_name: orgName, slug, plan: 'trial' })
        .select('id, org_name, slug, plan, trial_ends_at, license_no, contact_phone, stamp_text, store_url')
        .maybeSingle()
      if (insErr) {
        if (insErr.code === '23505') {
          const { data: again } = await supabase
            .from('subscribers').select('id, org_name, slug, plan, trial_ends_at, license_no, contact_phone, stamp_text, store_url')
            .eq('owner_id', user.id).order('created_at', { ascending: true }).limit(1).maybeSingle()
          s = again ?? null
        } else {
          creatingRef.current = false
          setErr('تعذّر إنشاء حملتك تلقائيًّا: ' + insErr.message); setLoading(false); return
        }
      } else {
        s = created
      }
      if (s?.id) {
        const { error: upErr } = await supabase.from('profiles').update({ subscriber_id: s.id }).eq('id', user.id)
        if (!upErr) await refreshProfile?.()
      }
    }
    setSub(s ?? null)

    if (s?.id) {
      const { data: t, error: tErr } = await supabase
        .from('trips')
        .select('id, title, route_from, route_to, depart_at, return_at, capacity, bus_label, boarding_point, status, notes, seating_policy, bus_rows, bus_back_row')
        .eq('subscriber_id', s.id)
        .order('depart_at', { ascending: true })
      if (tErr) { setErr('تعذّر تحميل الرحلات: ' + tErr.message); setTrips([]) }
      else setTrips(t ?? [])

      // إحصاءات المعتمرين الحقيقية لكل رحلة + الإجماليات
      const { data: pax } = await supabase
        .from('passengers').select('trip_id, status').eq('subscriber_id', s.id)
      const byTrip = new Map()
      const totals = { count: 0, paid: 0, boarded: 0, checked_in: 0 }
      for (const p of (pax ?? [])) {
        const e = byTrip.get(p.trip_id) || { count: 0, paid: 0, boarded: 0, checked_in: 0 }
        e.count++; totals.count++
        if (p.status === 'paid' || p.status === 'boarded' || p.status === 'checked_in') { e.paid++; totals.paid++ }
        if (p.status === 'boarded' || p.status === 'checked_in') { e.boarded++; totals.boarded++ }
        if (p.status === 'checked_in') { e.checked_in++; totals.checked_in++ }
        byTrip.set(p.trip_id, e)
      }
      setPaxStats({ byTrip, totals })
    } else { setTrips([]); setPaxStats({ byTrip: new Map(), totals: { count: 0, paid: 0, boarded: 0, checked_in: 0 } }) }
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

  /* تصفيةٌ سريعة + بحث */
  const filteredTrips = useMemo(() => {
    const q = search.trim().toLowerCase()
    return trips.filter((t) => {
      if (filter === 'upcoming' && t.status !== 'draft' && t.status !== 'open') return false
      if (filter === 'active' && t.status !== 'open') return false
      if (filter === 'done' && t.status !== 'done' && t.status !== 'closed') return false
      if (q) {
        const hay = [t.title, t.route_from, t.route_to, t.bus_label].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [trips, filter, search])

  const totalSeats = trips.reduce((s, t) => s + (Number(t.capacity) || 0), 0)
  const planLabel = sub?.plan === 'paid' ? 'باقة ملبّيك' : 'الباقة التجريبية'

  /* الشريط السفلي للجوال — ٥ عناصر مع زرّ مركزيٍّ بارز */
  const tabs = [
    { section: 'حملتي' },
    { key: 'overview', label: 'الرئيسية', icon: 'dashboard' },
    { key: 'trips', label: 'الرحلات', icon: 'trips', badge: trips.length || undefined },
    { key: 'add', label: 'إضافة', icon: 'plus', fab: true },
    { key: 'analytics', label: 'التحليلات', icon: 'chart' },
    { key: 'feedback', label: 'الدعم', icon: 'message' },
  ]

  // فتح إدارة أوّل رحلة (لخطوات التهيئة)؛ أو إنشاء رحلةٍ إن لم توجد
  function manageFirst() {
    if (trips[0]) { setManaging(trips[0]); setView('trips') }
    else openCreate()
  }

  function onTab(k) {
    setManaging(null)
    if (k === 'add') { openCreate(); return }
    if (k === 'feedback') { setFeedbackOpen(true); return }
    setView(k)
  }

  return (
    <>
      <AppShell
        title={managing ? 'إدارة الرحلة' : view === 'overview' ? 'نظرة عامة' : view === 'trips' ? 'رحلات العمرة' : view === 'analytics' ? 'التحليلات' : 'حملتي'}
        subtitle={sub?.plan === 'paid' ? 'باقة ملبّيك — رحلاتٌ غير محدودة' : `الباقة التجريبية — حتى ${fmtDate(sub?.trial_ends_at)}`}
        tabs={tabs}
        active={view}
        onTab={onTab}
      >
        {err && !managing && <div className="alert err" style={{ marginBottom: 12 }}>{err}</div>}

        {managing ? (
          <TripManage
            trip={managing}
            sub={sub}
            onBack={() => setManaging(null)}
            onTripChanged={load}
          />
        ) : (
          <>
            {view === 'overview' && (
              <>
                <Overview
                  sub={sub}
                  profile={profile}
                  trips={trips}
                  totalSeats={totalSeats}
                  planLabel={planLabel}
                  totals={paxStats.totals}
                  onCreate={openCreate}
                  onShare={() => setShareOpen(true)}
                  onAnalytics={() => setView('analytics')}
                />
                <OnboardingChecklist
                  sub={sub}
                  trips={trips}
                  totals={paxStats.totals}
                  onCreateTrip={openCreate}
                  onShare={() => setShareOpen(true)}
                  onManageFirst={manageFirst}
                />
              </>
            )}

            {view === 'analytics' && (
              <CampaignAnalytics trips={trips} byTrip={paxStats.byTrip} totals={paxStats.totals} />
            )}

            {view === 'trips' && (
              <TripsView
                trips={filteredTrips}
                allCount={trips.length}
                sub={sub}
                loading={loading}
                paxByTrip={paxStats.byTrip}
                filter={filter}
                setFilter={setFilter}
                search={search}
                setSearch={setSearch}
                onCreate={openCreate}
                onEdit={openEdit}
                onRemove={remove}
                onManage={(t) => setManaging(t)}
                onShare={() => setShareOpen(true)}
              />
            )}

            {view === 'customers' && <ComingSoon title="تعبئة بيانات المعتمرين" desc="افتح أي رحلةٍ ثم «إدارة الرحلة» لإضافة المعتمرين وإصدار الكشف." />}
            {view === 'settings' && <ComingSoon title="إعدادات المؤسسة" desc="بيانات المؤسسة والختم تُحرّر من «إدارة الرحلة ← الباص والطاقم» حاليًّا." />}
            {view === 'manifest' && <ComingSoon title="الكشف الرسمي للباص" desc="افتح رحلةً ثم «إدارة الرحلة ← الكشف الرسمي» لإصداره وطباعته." />}
            {view === 'payments' && <ComingSoon title="المدفوعات" desc="ربطٌ مع متجرٍ خارجي ثم العودة لإرفاق الإيصال." />}
          </>
        )}

        {modalOpen && sub && (
          <TripFormModal trip={editing} subscriberId={sub.id} onClose={closeModal} onSaved={handleSaved} />
        )}

        <BottomSheet
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          title="مشاركة رابط الحجز"
          actions={
            <button className="btn btn-gold btn-block" onClick={copyLink} disabled={!shareUrl}>
              <Icon name={copied ? 'check' : 'copy'} size={17} />
              {copied ? 'تم النسخ ✓' : 'نسخ الرابط'}
            </button>
          }
        >
          <div className="stats" style={{ marginTop: 0 }}>
            <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={15} /></span>مدفوع</div><div className="v">0</div></div>
            <div className="stat info"><div className="top"><span className="ic"><Icon name="seat" size={15} /></span>مقاعد محجوزة</div><div className="v">0/{totalSeats}</div></div>
          </div>
          <div className="share-box" style={{ marginTop: 14 }}>
            <code>{shareUrl || '—'}</code>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 10, textAlign: 'center' }}>
            شارك هذا الرابط مع العملاء ليملؤوا بياناتهم ويختاروا مقاعدهم مباشرة
          </p>
        </BottomSheet>
      </AppShell>

      <button type="button" className="fab-feedback" onClick={() => setFeedbackOpen(true)} title="تواصل مع إدارة ملبّيك">
        <Icon name="message" size={18} />
      </button>
      <FeedbackSheet open={feedbackOpen} audience="subscriber" onClose={() => setFeedbackOpen(false)} />

      <Roadmap />
    </>
  )
}

/* ---------- نظرة عامة ---------- */
function Overview({ sub, profile, trips, totalSeats, planLabel, totals, onCreate, onShare, onAnalytics }) {
  const upcoming = trips.filter((t) => t.status === 'open' || t.status === 'draft').length
  const tt = totals || { count: 0, paid: 0, boarded: 0, checked_in: 0 }
  return (
    <>
      <section className="hero">
        <span className="tag">منصة عُمرة</span>
        <h2>أهلًا {profile?.full_name ? `· ${profile.full_name.split(' ')[0]}` : ''}</h2>
        <p>{sub?.org_name ? `${sub.org_name} — ` : ''}مركز قيادتك المركزي. كل رحلاتك، المعتمرون، والإشعارات في مكانٍ واحد.</p>
      </section>

      <div className="stats">
        <div className="stat">
          <div className="top"><span className="ic"><Icon name="customers" size={15} /></span>المعتمرون</div>
          <div className="v">{tt.count}</div>
        </div>
        <div className="stat ok">
          <div className="top"><span className="ic"><Icon name="payments" size={15} /></span>مدفوع</div>
          <div className="v">{tt.paid}</div>
        </div>
        <div className="stat info">
          <div className="top"><span className="ic"><Icon name="bus" size={15} /></span>صعود الحافلة</div>
          <div className="v">{tt.boarded}</div>
        </div>
        <div className="stat warn">
          <div className="top"><span className="ic"><Icon name="bed" size={15} /></span>استلام الغرفة</div>
          <div className="v">{tt.checked_in}</div>
        </div>
      </div>

      <div className="actions">
        <button className="action primary" onClick={onCreate}>
          <Icon name="plus" size={18} /> إنشاء رحلة عمرة
        </button>
        <button className="action info" disabled>
          <Icon name="qr" size={18} /> مسح تذكرة <span className="tag muted" style={{ marginInlineStart: 'auto', fontSize: 10 }}>قريبًا</span>
        </button>
        <button className="action ok" onClick={onShare} disabled={!sub?.slug}>
          <Icon name="share" size={18} /> مشاركة رابط الحجز
        </button>
        <button className="action violet" onClick={onAnalytics}>
          <Icon name="chart" size={18} /> التحليلات
        </button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>ملخّص الباقة</h3>
          <span className="sp-grow" style={{ flex: 1 }} />
          <span className="tag gold">{planLabel}</span>
        </div>
        <div className="stats" style={{ marginTop: 0 }}>
          <div className="stat"><div className="top">الرحلات</div><div className="v">{trips.length}</div><div className="sub">{upcoming} قادمة</div></div>
          <div className="stat"><div className="top">إجمالي المقاعد</div><div className="v">{totalSeats}</div></div>
        </div>
      </section>
    </>
  )
}

/* ---------- شاشة الرحلات (بطاقات على الجوال + تصفية) ---------- */
function TripsView({ trips, allCount, sub, loading, paxByTrip, filter, setFilter, search, setSearch, onCreate, onEdit, onRemove, onManage, onShare }) {
  return (
    <>
      <section className="hero" style={{ paddingBottom: 16 }}>
        <span className="tag">مركز الرحلات</span>
        <h2 style={{ marginTop: 6, fontSize: 22 }}>إدارة ومتابعة جميع رحلاتك</h2>
        <p>في مكانٍ واحد — <strong style={{ color: 'var(--gd-300)' }}>{allCount}</strong> {allCount === 1 ? 'رحلة مسجّلة' : 'رحلة'}.</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn btn-gold" onClick={onCreate} disabled={!sub}>
            <Icon name="plus" size={17} /> رحلة جديدة
          </button>
          <button className="btn btn-ghost" onClick={onShare} disabled={!sub?.slug}>
            <Icon name="share" size={17} /> رابط الحجز
          </button>
        </div>
      </section>

      <div className="field search" style={{ marginTop: 14 }}>
        <span className="ic"><Icon name="search" size={17} /></span>
        <input type="text" placeholder="بحث باسم الرحلة أو المدينة…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="chips">
        {[
          { k: 'all', t: 'الكل' },
          { k: 'upcoming', t: 'قادمة' },
          { k: 'active', t: 'نشطة' },
          { k: 'done', t: 'منتهية' },
        ].map((c) => (
          <button key={c.k} type="button" className={`chip ${filter === c.k ? 'active' : ''}`} onClick={() => setFilter(c.k)}>
            {c.t}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        {loading ? (
          <Empty title="جارٍ التحميل…" />
        ) : !sub ? (
          <Empty title="لم يتم العثور على حملتك" hint="حدّث الصفحة، أو تواصل مع الدعم إن استمرّ." />
        ) : trips.length === 0 ? (
          <Empty title="لا توجد رحلاتٌ تطابق التصفية" hint="جرّب تغيير التصفية أو ابحث بكلمةٍ أخرى." />
        ) : (
          trips.map((t) => (
            <TripCard key={t.id} trip={t} booked={paxByTrip?.get(t.id)?.count || 0} stats={paxByTrip?.get(t.id)}
              onManage={() => onManage(t)} onEdit={() => onEdit(t)} onRemove={() => onRemove(t)} />
          ))
        )}
      </div>
    </>
  )
}

function TripCard({ trip, booked = 0, stats, onManage, onEdit, onRemove }) {
  const cap = Number(trip.capacity) || 0
  const pct = cap > 0 ? Math.min(100, Math.round((booked / cap) * 100)) : 0
  const status = trip.status || 'draft'
  const tagCls = STATUS_TAG[status] || 'muted'
  const tagLbl = STATUS_FUTURE_LABEL[status] || STATUS_LABEL[status]

  return (
    <article className="trip-card">
      <div className="tags">
        <span className="tag gold">عمرة</span>
        <span className={`tag ${tagCls}`}>{tagLbl}</span>
      </div>

      <h3>{trip.title || 'رحلة'}</h3>

      <div className="meta">
        <div className="row">
          <span className="ic"><Icon name="calendar" size={16} /></span>
          <span>{fmtShort(trip.depart_at)}</span>
          {trip.return_at && <><Icon name="arrowLeft" size={13} /><span>{fmtShort(trip.return_at)}</span></>}
        </div>
        <div className="row">
          <span className="ic"><Icon name="location" size={16} /></span>
          <span>{(trip.route_from || '—') + ' ← ' + (trip.route_to || '—')}</span>
        </div>
        {trip.bus_label && (
          <div className="row">
            <span className="ic"><Icon name="bus" size={16} /></span>
            <span>{trip.bus_label}</span>
          </div>
        )}
      </div>

      <div className="occupancy">
        <div className="lbl">إشغال الحافلة <span className="pct">{booked}/{cap || '—'}</span></div>
        <div className="bar"><span style={{ width: pct + '%' }} /></div>
      </div>

      <div className="ministats">
        <div className="ministat"><div className="top">حجوزات</div><div className="v">{booked}</div></div>
        <div className="ministat"><div className="top">مدفوع</div><div className="v ok">{stats?.paid || 0}</div></div>
        <div className="ministat"><div className="top">صعد</div><div className="v info">{stats?.boarded || 0}</div></div>
      </div>

      {(onManage || onEdit || onRemove) && (
        <div className="actions-row">
          {onManage && (
            <button className="btn btn-gold" onClick={onManage}>
              <Icon name="chevron" size={16} /> إدارة الرحلة
            </button>
          )}
          {onEdit && <button className="icon-btn" onClick={onEdit} aria-label="تعديل"><Icon name="edit" size={16} /></button>}
          {onRemove && <button className="icon-btn danger" onClick={onRemove} aria-label="حذف"><Icon name="trash" size={16} /></button>}
        </div>
      )}
    </article>
  )
}

/* ============================================================
   لوحة العميل (المعتمر)
   ============================================================ */
export function CustomerHome() {
  const { user, subscriberId } = useAuth()
  const [view, setView] = useState('trips')
  const [orgName, setOrgName] = useState('')
  const [sub, setSub] = useState(null)
  const [trips, setTrips] = useState([])
  const [myBookings, setMyBookings] = useState([])   // ركّابي (passengers بـ profile_id = أنا)
  const [loading, setLoading] = useState(true)
  const [booking, setBooking] = useState(null)        // الرحلة قيد الحجز (شاشة كاملة)
  const [ticketFor, setTicketFor] = useState(null)    // حجزٌ لعرض تذكرته
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    let sq = supabase.from('subscribers').select('id, org_name, store_url')
    sq = subscriberId ? sq.eq('id', subscriberId) : sq.limit(1)
    const { data: s } = await sq.maybeSingle()
    if (s) { setSub(s); setOrgName(s.org_name) }

    let tq = supabase
      .from('trips')
      .select('id, title, route_from, route_to, depart_at, return_at, capacity, bus_label, boarding_point, status, seating_policy, bus_rows, bus_back_row')
      .order('depart_at', { ascending: true })
    if (subscriberId) tq = tq.eq('subscriber_id', subscriberId)
    const { data: t } = await tq
    setTrips(t ?? [])

    if (user?.id) {
      const { data: b } = await supabase
        .from('passengers')
        .select('id, trip_id, full_name, seat_no, status, ticket_code, boarded_at, boarding_point, national_id, phone, gender, is_family, payment_ref')
        .eq('profile_id', user.id)
      setMyBookings(b ?? [])
    }
    setLoading(false)
  }, [subscriberId, user])

  useEffect(() => { load() }, [load])

  const bookingByTrip = useMemo(() => {
    const m = new Map()
    for (const b of myBookings) m.set(b.trip_id, b)
    return m
  }, [myBookings])

  const tabs = [
    { section: 'رحلاتي' },
    { key: 'trips', label: 'الرحلات', icon: 'trips', badge: trips.length || undefined },
    { key: 'tickets', label: 'تذاكري', icon: 'barcode', badge: myBookings.length || undefined },
  ]

  function onTab(k) { setBooking(null); setTicketFor(null); setView(k) }

  // شاشة الحجز الكاملة
  if (booking) {
    return (
      <AppShell title="حجز مقعد" subtitle={orgName} tabs={tabs} active="trips" onTab={onTab}>
        <CustomerBooking
          trip={booking}
          sub={sub}
          onClose={() => { setBooking(null); load() }}
          onBooked={load}
        />
      </AppShell>
    )
  }
  if (ticketFor) {
    const t = trips.find((x) => x.id === ticketFor.trip_id)
    return (
      <Suspense fallback={<div className="manifest-overlay" style={{ display: 'grid', placeItems: 'center' }}><CompassMark size={64} /></div>}>
        <CustomerTicket passenger={ticketFor} trip={t} sub={sub} onClose={() => setTicketFor(null)} />
      </Suspense>
    )
  }

  return (
    <>
      <AppShell
        title="أهلًا بك"
        subtitle={orgName ? `رحلات حملة ${orgName}` : 'رحلاتك المتاحة'}
        tabs={tabs}
        active={view}
        onTab={onTab}
      >
        {view === 'trips' && (
          <>
            <section className="hero">
              <span className="tag">حملتي</span>
              <h2>{orgName || 'رحلاتي المتاحة'}</h2>
              <p>اختر رحلتك المناسبة، أكمل بياناتك، واحجز مقعدك مباشرةً — تُعرض لك رحلات حملتك فقط.</p>
            </section>

            <div style={{ marginTop: 14 }}>
              {loading ? (
                <Empty title="جارٍ التحميل…" />
              ) : trips.length === 0 ? (
                <Empty title="لا توجد رحلاتٌ متاحةٌ حاليًا" hint="ستظهر رحلات حملتك هنا فور إتاحتها." />
              ) : (
                trips.map((t) => (
                  <CustomerTripCard
                    key={t.id}
                    trip={t}
                    booking={bookingByTrip.get(t.id)}
                    onBook={() => setBooking(t)}
                    onTicket={(b) => setTicketFor(b)}
                  />
                ))
              )}
            </div>
          </>
        )}

        {view === 'tickets' && (
          <>
            <section className="hero">
              <span className="tag">تذاكري</span>
              <h2>حجوزاتي</h2>
              <p>تذاكر صعودك بالباركود — اعرضها عند الصعود أو احفظها على جوالك.</p>
            </section>
            <div style={{ marginTop: 14 }}>
              {loading ? (
                <Empty title="جارٍ التحميل…" />
              ) : myBookings.length === 0 ? (
                <Empty title="لا حجوزات بعد" hint="احجز مقعدك من تبويب الرحلات لتظهر تذكرتك هنا." />
              ) : (
                myBookings.map((b) => {
                  const t = trips.find((x) => x.id === b.trip_id)
                  return (
                    <div className="trip-card" key={b.id}>
                      <div className="tags">
                        <span className="tag gold">عمرة</span>
                        <span className={`tag ${b.status === 'paid' || b.status === 'boarded' || b.status === 'checked_in' ? 'ok' : 'muted'}`}>
                          {b.status === 'paid' ? 'مدفوع' : b.status === 'boarded' ? 'صعد' : b.status === 'checked_in' ? 'مُسكّن' : 'محجوز'}
                        </span>
                      </div>
                      <h3>{t?.title || 'رحلة'}</h3>
                      <div className="meta">
                        <div className="row"><span className="ic"><Icon name="calendar" size={16} /></span><span>{fmtShort(t?.depart_at)}</span></div>
                        <div className="row"><span className="ic"><Icon name="seat" size={16} /></span><span>مقعد {b.seat_no || '—'}</span></div>
                      </div>
                      <div className="actions-row">
                        <button className="btn btn-gold" onClick={() => setTicketFor(b)}><Icon name="qr" size={16} /> تذكرتي</button>
                        {t && <button className="icon-btn" onClick={() => setBooking(t)}><Icon name="edit" size={15} /> تعديل</button>}
                        <button className="icon-btn danger" onClick={async () => {
                          if (!window.confirm(`إلغاء حجزك في «${t?.title || 'هذه الرحلة'}»؟`)) return
                          const { error } = await supabase.from('passengers').delete().eq('id', b.id)
                          if (error) alert('تعذّر الإلغاء: ' + error.message)
                          else load()
                        }}><Icon name="trash" size={15} /> إلغاء</button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </AppShell>

      <button type="button" className="fab-feedback" onClick={() => setFeedbackOpen(true)} title="تواصل مع إدارة ملبّيك">
        <Icon name="message" size={18} />
      </button>
      <FeedbackSheet open={feedbackOpen} audience="customer" onClose={() => setFeedbackOpen(false)} />

      <Roadmap />
    </>
  )
}

/* تذكرة العميل — غلافٌ كسولٌ لمكوّن Ticket */
const CustomerTicket = lazy(() => import('../../components/Ticket'))

/* بطاقة رحلةٍ للعميل: تعرض زرّ الحجز أو التذكرة حسب حالته */
function CustomerTripCard({ trip, booking, onBook, onTicket }) {
  return (
    <article className="trip-card">
      <div className="tags">
        <span className="tag gold">عمرة</span>
        <span className={`tag ${STATUS_TAG[trip.status] || 'muted'}`}>{STATUS_FUTURE_LABEL[trip.status] || STATUS_LABEL[trip.status]}</span>
        {booking && <span className="tag ok">محجوز · مقعد {booking.seat_no || '—'}</span>}
      </div>
      <h3>{trip.title || 'رحلة'}</h3>
      <div className="meta">
        <div className="row"><span className="ic"><Icon name="calendar" size={16} /></span><span>{fmtShort(trip.depart_at)}</span></div>
        <div className="row"><span className="ic"><Icon name="location" size={16} /></span><span>{(trip.route_from || '—') + ' ← ' + (trip.route_to || '—')}</span></div>
      </div>
      <div className="actions-row">
        {booking ? (
          <>
            <button className="btn btn-gold" onClick={() => onTicket(booking)}><Icon name="qr" size={16} /> تذكرتي</button>
            <button className="icon-btn" onClick={onBook}><Icon name="edit" size={15} /> تعديل الحجز</button>
          </>
        ) : (
          <button className="btn btn-gold" onClick={onBook}><Icon name="seat" size={16} /> احجز مقعدي</button>
        )}
      </div>
    </article>
  )
}
