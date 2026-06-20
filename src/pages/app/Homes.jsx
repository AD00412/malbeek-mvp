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
import FeedbackFab, { showFeedbackFab } from '../../components/FeedbackFab'
import { getCached, setCached, buildPaxStats, rehydratePaxStats } from '../../lib/dataCache'
import FeedbackInbox from '../../components/FeedbackInbox'
import OnboardingChecklist from '../../components/OnboardingChecklist'
import CampaignAnalytics from '../../components/CampaignAnalytics'
import TrialBanner from '../../components/TrialBanner'
import { useRealtime } from '../../lib/useRealtime'
import { fmtDateTime } from '../../lib/format'
import { tableToDocx } from '../../lib/docx'
import { htmlToPdf } from '../../lib/pdf'
import { useUI } from '../../lib/useUI'
import { translateRpcError } from '../../lib/rpcErrors'
import { tripLifecycle } from '../../lib/tripLifecycle'
import { SkeletonList } from '../../components/Skeleton'
import TeamSheet from '../../components/TeamSheet'
import PendingInviteBanner from '../../components/PendingInviteBanner'
import StatusTimeline from '../../components/StatusTimeline'
import PilgrimSearch from '../../components/PilgrimSearch'
import AdminAllTrips from '../../components/AdminAllTrips'
import AdminPilgrimSearch from '../../components/AdminPilgrimSearch'
import AdminSubDetail from '../../components/AdminSubDetail'
import SettingsSheet from '../../components/SettingsSheet'
import { suggestSlug } from '../../lib/slug'
import useStickyState from '../../lib/useStickyState'
const TripManage = lazy(() => import('./TripManage'))

const LazyScanner = lazy(() => import('../../components/Scanner'))

/** قائمةُ أعمدة المؤسسة المشتركة بين الـ select قراءاتٍ متعدّدة (تفادي الانحراف). */
const SUBSCRIBER_COLS =
  'id, owner_id, org_name, slug, plan, trial_ends_at, license_no, contact_phone, stamp_text, stamp_url, logo_url, store_url, carrier_company'

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

/* ============================================================
   لوحة الإدارة (تبقى بسيطةً للآن)
   ============================================================ */
export function AdminHome() {
  const [view, setView] = useStickyState('admin:view', 'overview')
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [detailSub, setDetailSub] = useState(null)   // الحملة المفتوحة في ورقة التفاصيل
  const [settingsOpen, setSettingsOpen] = useState(false)

  const firstAdminLoad = useRef(true)
  const retryAdminRef = useRef(0)
  const load = useCallback(async () => {
    const cacheKey = 'admin-dash'
    const cached = getCached(cacheKey)
    const hadSubs = (cached?.subs?.length ?? 0) > 0
    if (firstAdminLoad.current) {
      if (cached?.subs) { setSubs(cached.subs); setLoading(false) }
      else setLoading(true)
    }
    const { data, error } = await supabase.rpc('admin_campaign_stats')
    if (error) { setLoading(false); return }
    const newSubs = (data ?? []).map((r) => ({ ...r, id: r.subscriber_id }))
    // حارسُ empty الزائف
    if (newSubs.length === 0 && hadSubs && retryAdminRef.current < 2) {
      retryAdminRef.current += 1
      setTimeout(() => load(), 800)
      return
    }
    retryAdminRef.current = 0
    setSubs(newSubs)
    if (newSubs.length > 0 || !hadSubs) setCached(cacheKey, { subs: newSubs })
    setLoading(false)
    firstAdminLoad.current = false
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => { if (active) await load() })()
    return () => { active = false }
  }, [load])

  // Realtime للإدارة: مشتركون جدد، رحلات/ركّاب/مدفوعات، ملاحظات جديدة.
  useRealtime('admin-home', [
    { table: 'subscribers' }, { table: 'trips' }, { table: 'passengers' }, { table: 'feedback' },
  ], load, 400, [load])

  const tabs = [
    { section: 'الإدارة' },
    { key: 'overview', label: 'الرئيسية', icon: 'dashboard' },
    { key: 'subs', label: 'المشتركون', icon: 'building', badge: subs.length || undefined },
    { key: 'trips', label: 'الرحلات', icon: 'trips' },
    { key: 'search', label: 'البحث', icon: 'search' },
    { key: 'feedback', label: 'التغذية الراجعة', icon: 'message' },
    { section: 'الحساب' },
    { key: 'settings', label: 'الإعدادات', icon: 'settings' },
  ]
  const money = (n) => Number(n || 0).toLocaleString('en-US')
  // إحصاءاتٌ مجمَّعةٌ في useMemo — تُحسَب فقط حين تتغيّر subs، لا مع كلّ rerender
  // (تبديل التبويب، فتح ورقةٍ…). على ١٠٠+ مشتركٍ الفرق ملحوظ.
  const { paid, trips, pax, collected, recent7 } = useMemo(() => {
    const now = Date.now()
    const week = 7 * 86400000
    let p = 0, t = 0, x = 0, c = 0, r7 = 0
    for (const s of subs) {
      if (s.plan === 'paid') p++
      t += s.trips_count || 0
      x += s.pax_count || 0
      c += Number(s.collected) || 0
      if (s.created_at && (now - new Date(s.created_at).getTime()) < week) r7++
    }
    return { paid: p, trips: t, pax: x, collected: c, recent7: r7 }
  }, [subs])

  return (
    <>
      <AppShell title="لوحة الإدارة" subtitle="إشرافٌ عامٌ على منصّة ملبّيك" tabs={tabs} active={view}
        onTab={(k) => { if (k === 'settings') { setSettingsOpen(true); return } setView(k) }}>
        <div key={view} className="view-fade">
        {view === 'overview' && (
          <>
            <div className="stats">
              <div className="stat"><div className="top"><span className="ic"><Icon name="building" size={15} /></span>المشتركون</div><div className="v">{subs.length}{recent7 > 0 && <span style={{ fontSize: 12, color: 'var(--ok-ink)', marginInlineStart: 8 }}>+{recent7} هذا الأسبوع</span>}</div></div>
              <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={15} /></span>الباقات المدفوعة</div><div className="v">{paid}</div></div>
              <div className="stat info"><div className="top"><span className="ic"><Icon name="trips" size={15} /></span>الرحلات</div><div className="v">{trips}</div></div>
              <div className="stat warn"><div className="top"><span className="ic"><Icon name="customers" size={15} /></span>المعتمرون</div><div className="v">{pax}</div></div>
            </div>
            <div className="stats" style={{ marginTop: 12 }}>
              <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={15} /></span>إجمالي المحصّل عبر المنصّة</div><div className="v" style={{ fontSize: 26 }}>{money(collected)} <span style={{ fontSize: 14, color: 'var(--cr-300)' }}>﷼</span></div></div>
            </div>

            {/* الاختصارات منقولةٌ للدرج الجانبيّ (☰) — أبسطُ وأقلُّ تكرار */}
            <div className="actions" style={{ marginTop: 16, display: 'none' }}>
              <div className="sec-label">إجراءاتٌ سريعة</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button className="action" style={{ flex: 1, minWidth: 140 }} onClick={() => setView('subs')}><Icon name="building" size={17} /> كلّ الحملات</button>
                <button className="action info" style={{ flex: 1, minWidth: 140 }} onClick={() => setView('trips')}><Icon name="trips" size={17} /> كلّ الرحلات</button>
                <button className="action warn" style={{ flex: 1, minWidth: 140 }} onClick={() => setView('search')}><Icon name="search" size={17} /> بحث المعتمرين</button>
              </div>
            </div>

            <SubsPanel subs={subs} loading={loading} onReload={load} onOpenDetail={setDetailSub} />
          </>
        )}
        {view === 'subs' && <SubsPanel subs={subs} loading={loading} onReload={load} onOpenDetail={setDetailSub} />}
        {view === 'trips' && <AdminAllTrips />}
        {view === 'search' && <AdminPilgrimSearch />}
        {view === 'feedback' && <FeedbackInbox />}
        </div>
      </AppShell>

      <AdminSubDetail open={!!detailSub} sub={detailSub} onClose={() => setDetailSub(null)} onChanged={() => { load(); setDetailSub(null) }} />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} sub={null} />
    </>
  )
}

function SubsPanel({ subs, loading, onReload, onOpenDetail }) {
  const [busyId, setBusyId] = useState(null)
  const [q, setQ] = useState('')
  const [planFilter, setPlanFilter] = useState('all')   // all | paid | trial
  const [sortBy, setSortBy] = useState('recent')        // recent | name | pax | collected
  const { toast } = useUI()
  const money = (n) => Number(n || 0).toLocaleString('en-US')

  async function togglePlan(s, ev) {
    ev?.stopPropagation?.()
    setBusyId(s.id)
    const next = s.plan === 'paid' ? 'trial' : 'paid'
    const { error } = await supabase.from('subscribers').update({ plan: next }).eq('id', s.id)
    setBusyId(null)
    if (error) toast(translateRpcError(error, 'تعذّر تحديث الباقة.'), { type: 'error' })
    else { toast(next === 'paid' ? 'تمت ترقية الحملة لمدفوعة' : 'أُعيدت الحملة لتجريبية', { type: 'success' }); onReload?.() }
  }

  const filtered = useMemo(() => {
    const safe = q.trim().toLowerCase()
    let arr = subs.filter((s) => {
      if (planFilter !== 'all' && s.plan !== planFilter) return false
      if (!safe) return true
      return (s.org_name || '').toLowerCase().includes(safe) || (s.slug || '').toLowerCase().includes(safe)
    })
    const by = {
      recent: (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
      name: (a, b) => (a.org_name || '').localeCompare(b.org_name || '', 'ar'),
      pax: (a, b) => (b.pax_count || 0) - (a.pax_count || 0),
      collected: (a, b) => (Number(b.collected) || 0) - (Number(a.collected) || 0),
    }[sortBy]
    if (by) arr = [...arr].sort(by)
    return arr
  }, [subs, q, planFilter, sortBy])

  const reportHeaders = ['الحملة','الرابط','الباقة','الرحلات','المعتمرون','المدفوع','المحصّل (﷼)','تاريخ الاشتراك']
  function reportRows() {
    return filtered.map((s) => [
      s.org_name || '', `/${s.slug}`, s.plan === 'paid' ? 'مدفوعة' : 'تجريبية',
      s.trips_count || 0, s.pax_count || 0, s.paid_count || 0,
      Number(s.collected) || 0, fmtDateTime(s.created_at),
    ])
  }
  async function exportReportDocx() {
    toast('جارٍ تجهيز ملفّ Word…', { type: 'info' })
    try {
      await tableToDocx({
        title: 'تقرير حملات منصّة ملبّيك',
        subtitle: `إجمالي الحملات: ${subs.length}`,
        meta: [`صُدر بتاريخ ${new Date().toLocaleDateString('ar-SA')}`],
        headers: reportHeaders,
        rows: reportRows(),
        filename: 'تقرير-الحملات',
      })
      toast('تم تنزيل تقرير Word', { type: 'success' })
    } catch (e) { console.error(e); toast('تعذّر إنشاء ملفّ Word — حاول مجدّدًا.', { type: 'error' }) }
  }
  const reportRef = useRef(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  async function exportReportPdf() {
    if (pdfBusy || !reportRef.current) return
    setPdfBusy(true)
    toast('جارٍ تجهيز ملفّ PDF…', { type: 'info' })
    try { await htmlToPdf(reportRef.current, 'تقرير-الحملات'); toast('تم تنزيل تقرير PDF', { type: 'success' }) }
    catch (e) { console.error(e); toast('تعذّر إنشاء ملفّ PDF — حاول مجدّدًا.', { type: 'error' }) }
    finally { setPdfBusy(false) }
  }
  return (
    <section className="panel" ref={reportRef}>
      <div className="panel-head">
        <h3>المشتركون</h3><span className="sub">({subs.length})</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={exportReportPdf} disabled={subs.length === 0 || pdfBusy}>
          {pdfBusy ? <span className="spinner" /> : <><Icon name="download" size={15} /> PDF</>}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={exportReportDocx} disabled={subs.length === 0}>
          <Icon name="edit" size={15} /> Word
        </button>
      </div>
      {!loading && subs.length > 0 && (
        <>
          <div className="field search" style={{ marginBottom: 8 }}>
            <span className="ic"><Icon name="search" size={16} /></span>
            <input type="text" placeholder="ابحث باسم الحملة أو الرابط…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="bus-tabs" style={{ marginBottom: 8 }}>
            {[
              { k: 'all', l: 'الكل' },
              { k: 'paid', l: 'مدفوعة' },
              { k: 'trial', l: 'تجريبية' },
            ].map((x) => (
              <button key={x.k} className={`bus-tab ${planFilter === x.k ? 'active' : ''}`} onClick={() => setPlanFilter(x.k)}>{x.l}</button>
            ))}
            <span style={{ flex: 1 }} />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ width: 'auto', padding: '6px 10px', fontSize: 12 }}>
              <option value="recent">الأحدث</option>
              <option value="name">بالاسم</option>
              <option value="pax">الأكثر معتمرين</option>
              <option value="collected">الأعلى تحصيلًا</option>
            </select>
          </div>
        </>
      )}

      {loading ? (
        <SkeletonList count={4} />
      ) : subs.length === 0 ? (
        <Empty title="لا يوجد مشتركون بعد" hint="ستظهر الحملات هنا فور تسجيلها." />
      ) : filtered.length === 0 ? (
        <div className="empty"><div className="em-ttl">لا نتائج</div><div>غيّر البحث أو الفلتر.</div></div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl tbl-cards">
            <thead><tr><th>الحملة</th><th>الباقة</th><th>رحلات</th><th>معتمرون</th><th>مدفوع</th><th>المحصّل (﷼)</th><th>إجراء</th></tr></thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="sub-row" onClick={() => onOpenDetail?.(s)} style={{ cursor: 'pointer' }}>
                  <td data-label="الحملة">
                    {s.org_name}
                    <div className="ltr" style={{ textAlign: 'right' }}><code className="link-chip">/{s.slug}</code></div>
                  </td>
                  <td data-label="الباقة"><span className={`st ${s.plan === 'paid' ? 'ok' : 'warn'}`}>{s.plan === 'paid' ? 'مدفوعة' : 'تجريبية'}</span></td>
                  <td data-label="رحلات">{s.trips_count || 0}</td>
                  <td data-label="معتمرون">{s.pax_count || 0}</td>
                  <td data-label="مدفوع">{s.paid_count || 0}</td>
                  <td data-label="المحصّل (﷼)" style={{ fontFamily: 'var(--font-display)', color: 'var(--gd-300)' }}>{money(s.collected)}</td>
                  <td data-label="إجراء">
                    <button className="icon-btn" onClick={(e) => togglePlan(s, e)} disabled={busyId === s.id}>
                      {busyId === s.id ? <span className="spinner" /> : (s.plan === 'paid' ? 'إرجاع لتجريبية' : 'ترقية لمدفوعة')}
                    </button>
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
   لوحة المشترك — تجربةٌ موبايل أوّلًا
   ============================================================ */
export function SubscriberHome() {
  const { user, profile, refreshProfile } = useAuth()
  const [view, setView] = useStickyState('sub:view', 'overview')
  const [sub, setSub] = useState(null)
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { confirm, toast } = useUI()
  const [scanMode, setScanMode] = useState(null)    // null | 'pick' | 'board' | 'checkin'
  const [copied, setCopied] = useState(false)
  const [filter, setFilter] = useState('all')   // all | upcoming | active | done
  const [search, setSearch] = useState('')
  const [managing, setManaging] = useState(null) // الرحلة قيد الإدارة (شاشة كاملة)
  const [manageInitial, setManageInitial] = useState(null) // نموذجٌ يُفتح مباشرةً عند دخول الإدارة
  const [paxStats, setPaxStats] = useState({ byTrip: new Map(), totals: { count: 0, paid: 0, boarded: 0, checked_in: 0 } })
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const creatingRef = useRef(false)

  const firstLoadRef = useRef(true)
  const retryRef = useRef(0)
  const load = useCallback(async () => {
    if (!user?.id) return
    const cacheKey = `sub-dash:${user.id}`
    const cached = getCached(cacheKey)
    const hadTrips = (cached?.trips?.length ?? 0) > 0
    const hadPax   = (cached?.paxStats?.byTripEntries?.length ?? 0) > 0
    const hadSub   = !!cached?.sub

    // SWR: snapshot سابق يُعرض فورًا (لا skeleton)
    if (firstLoadRef.current && cached) {
      if (cached.sub) setSub(cached.sub)
      if (cached.trips) setTrips(cached.trips)
      if (cached.paxStats) setPaxStats(rehydratePaxStats(cached.paxStats))
      setLoading(false)
    } else if (firstLoadRef.current) {
      setLoading(true)
    }
    setErr('')

    // الحملة التي يديرها المستخدم: يملكها أو عضوُ فريقٍ فيها (RPC موثوق).
    const { data: managedId } = await supabase.rpc('my_managed_subscriber_id')
    // ★ حارسُ empty الزائف: لو كان عندنا حملةٌ مخزّنةٌ ثمّ رجع managedId=null،
    //    قد يكون التوكِنُ لم يَنشر بعد. نُعيد المحاولة قبل المسح.
    if (!managedId && hadSub && retryRef.current < 2) {
      retryRef.current += 1
      setTimeout(() => load(), 800)
      return
    }
    let s = null
    if (managedId) {
      const { data: row, error: sErr } = await supabase
        .from('subscribers').select(SUBSCRIBER_COLS).eq('id', managedId).maybeSingle()
      if (sErr) { setErr('تعذّر تحميل بيانات الحملة: ' + sErr.message); setLoading(false); return }
      s = row
    }

    // لا حملةَ مُدارة ⇒ مالكٌ جديدٌ بلا حملة ⇒ ننشئ له واحدةً تلقائيًّا.
    // نشترط !managedId (لا !s) كي لا يُنشئ عضوُ فريقٍ حملةً ثانيةً لو تعثّرت قراءة صفّه لحظيًّا.
    if (!managedId && !creatingRef.current) {
      creatingRef.current = true
      // اشتقاقُ slug مقروءٍ من اسم المالك بدل سلسلةٍ عشوائيّةٍ بحتة.
      const orgName = profile?.full_name ? `حملة ${profile.full_name}` : 'حملتي'
      const slug = suggestSlug(orgName)
      const { data: created, error: insErr } = await supabase
        .from('subscribers')
        .insert({ owner_id: user.id, org_name: orgName, slug, plan: 'trial' })
        .select(SUBSCRIBER_COLS)
        .maybeSingle()
      if (insErr) {
        if (insErr.code === '23505') {
          const { data: again } = await supabase
            .from('subscribers').select(SUBSCRIBER_COLS)
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
      // الرحلات والركّاب مستقلّتان (لا تعتمد إحداهما على الأخرى) → تشغيلٌ متوازٍ
      const [tripsRes, paxRes] = await Promise.all([
        supabase
          .from('trips')
          .select('id, title, route_from, route_to, depart_at, return_at, capacity, bus_label, boarding_point, status, notes, seating_policy, bus_rows, bus_back_row, price')
          .eq('subscriber_id', s.id)
          .order('depart_at', { ascending: true }),
        supabase
          .from('passengers').select('trip_id, status').eq('subscriber_id', s.id),
      ])
      if (tripsRes.error) {
        setErr('تعذّر تحميل الرحلات: ' + tripsRes.error.message)
        // لا تَمسح الواجهةَ على خطأ — أبقِ المخزَّن
      } else {
        const newTrips = tripsRes.data ?? []
        const newPaxRows = paxRes.data ?? []
        // ★ حارسُ empty الزائف: لو كانت ٢ نتائج فارغةً ومخزَّنُنا فيه بياناتٌ، أعِد المحاولة
        if (newTrips.length === 0 && newPaxRows.length === 0 && (hadTrips || hadPax) && retryRef.current < 2) {
          retryRef.current += 1
          setTimeout(() => load(), 800)
          setLoading(false)
          return
        }
        retryRef.current = 0
        setTrips(newTrips)
        const paxStats = buildPaxStats(newPaxRows)
        setPaxStats(paxStats)
        // خزِّن snapshot — فقط لو كانت النتيجةُ ذاتَ معنًى (لا نَكتب فارغًا فوقَ مَملوء)
        const safeToWrite = (newTrips.length > 0 || !hadTrips) && (newPaxRows.length > 0 || !hadPax)
        if (safeToWrite) {
          setCached(cacheKey, { sub: s, trips: newTrips, paxStats })
        } else {
          // اكتب المُحدَّث للحملة فقط مع الإبقاء على المخزَّن الباقي
          setCached(cacheKey, { sub: s, trips: cached?.trips ?? [], paxStats: cached?.paxStats ?? buildPaxStats([]) })
        }
      }
    } else {
      setTrips([])
      setPaxStats({ byTrip: new Map(), totals: { count: 0, paid: 0, boarded: 0, checked_in: 0 } })
      setCached(cacheKey, { sub: null, trips: [], paxStats: buildPaxStats([]) })
    }
    setLoading(false)
    firstLoadRef.current = false
  }, [user, profile, refreshProfile])

  useEffect(() => { load() }, [load])

  // Prefetch لحزمة TripManage فور تحميل الرحلات — أوّلُ نقرةٍ تكون فوريّةً.
  useEffect(() => {
    if (trips.length > 0) { import('./TripManage').catch(() => {}) }
  }, [trips.length])

  // Realtime للمشترك: رحلات/ركّاب/حملةٌ معدَّلة (ترقية الباقة، ردّ الإدارة على ملاحظاتي)
  useRealtime('subscriber-home', sub?.id ? [
    { table: 'passengers', filter: `subscriber_id=eq.${sub.id}` },
    { table: 'trips',      filter: `subscriber_id=eq.${sub.id}` },
    { table: 'subscribers', filter: `id=eq.${sub.id}` },
  ] : [], load, 350, [sub?.id, load])

  function openCreate() { setEditing(null); setModalOpen(true) }
  function openEdit(t) { setEditing(t); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(null) }
  function handleSaved() { closeModal(); load() }

  async function remove(t) {
    if (!t?.id) return
    if (!(await confirm({ title: 'حذف رحلة', message: `هل تريد حذف رحلة «${t.title}»؟ لا يمكن التراجع.`, confirmText: 'حذف', danger: true }))) return
    const { error } = await supabase.from('trips').delete().eq('id', t.id)
    if (error) { setErr(translateRpcError(error, 'تعذّر حذف الرحلة.')); return }
    toast('تم حذف الرحلة', { type: 'success' })
    load()
  }

  const shareUrl = sub?.slug ? `${window.location.origin}/${sub.slug}` : ''
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
  // العناصر الخمسة الأولى تظهر في الشريط السفليّ على الجوال.
  // البقيّة (بعد section: 'اختصارات') تظهر في الدرج الجانبيّ فقط.
  const tabs = [
    { section: 'حملتي' },
    { key: 'overview', label: 'الرئيسية', icon: 'dashboard' },
    { key: 'trips', label: 'الرحلات', icon: 'trips', badge: trips.length || undefined },
    { key: 'add', label: 'إضافة', icon: 'plus', fab: true },
    { key: 'analytics', label: 'التحليلات', icon: 'chart' },
    { key: 'feedback', label: 'الدعم', icon: 'message' },
    { section: 'اختصارات' },
    { key: 'scan', label: 'مسح تذكرة', icon: 'qr', disabled: !trips.length },
    { key: 'search', label: 'بحث عن معتمر', icon: 'search', disabled: !trips.length },
    { key: 'share', label: 'مشاركة رابط الحجز', icon: 'share', disabled: !sub?.slug },
    ...(sub?.owner_id === user?.id ? [{ key: 'team', label: 'الفريق والصلاحيّات', icon: 'customers' }] : []),
    { section: 'الحساب' },
    { key: 'settings', label: 'الإعدادات', icon: 'settings' },
  ]

  // فتح إدارة أوّل رحلة (لخطوات التهيئة)؛ أو إنشاء رحلةٍ إن لم توجد
  function manageFirst() {
    if (trips[0]) { setManaging(trips[0]); setView('trips') }
    else openCreate()
  }
  // فتحٌ مباشرٌ لنموذج بيانات المؤسسة/الباص (الكشف) عند الضغط على خطوة «بيانات المؤسسة»
  function manageFirstCrew() {
    if (trips[0]) { setManageInitial('crew'); setManaging(trips[0]); setView('trips') }
    else openCreate()
  }

  function onTab(k) {
    setManaging(null)
    if (k === 'add') { openCreate(); return }
    if (k === 'feedback') { setFeedbackOpen(true); showFeedbackFab(); return }
    if (k === 'scan') { setScanMode('pick'); return }
    if (k === 'search') { setSearchOpen(true); return }
    if (k === 'share') { setShareOpen(true); return }
    if (k === 'team') { setTeamOpen(true); return }
    if (k === 'settings') { setSettingsOpen(true); return }
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
        onNotifNavigate={(n) => { const t = trips.find((x) => x.id === n.ref_trip); if (t) setManaging(t) }}
        planLabel={sub?.plan === 'paid' ? 'باقة ملبّيك' : 'الباقة التجريبية'}
        planUsage={sub?.plan === 'paid' ? null : { used: trips.length, limit: 1 }}
      >
        {err && !managing && <div className="alert err" style={{ marginBottom: 12 }}>{err}</div>}

        {managing ? (
          <Suspense fallback={<SkeletonList count={6} />}>
            <TripManage
              trip={managing}
              sub={sub}
              onBack={() => setManaging(null)}
              onOpenTrip={(newTrip) => { if (newTrip) setManaging(newTrip) }}
              initialOpen={manageInitial}
              onInitialConsumed={() => setManageInitial(null)}
              onTripChanged={load}
            />
          </Suspense>
        ) : (
          <div key={view} className="view-fade">
            {view === 'overview' && (
              <>
                <PendingInviteBanner />
                <TrialBanner sub={sub} />
                {/* ★ لا نَرسم Overview قبل وصول sub فعلًا — يَمنع ومضةَ ٠/٠
                    قبل ظهور الأرقام الحقيقيّة. SWR cache يَحلّ هذا للزائر
                    العائد، لكنّ الزائر الجديد (بلا cache) كان يَرى أصفارًا
                    ثوانٍ قبل الأرقام الفعليّة. */}
                {(!loading || sub) ? (
                  <Overview
                    sub={sub}
                    profile={profile}
                    trips={trips}
                    totalSeats={totalSeats}
                    planLabel={planLabel}
                    totals={paxStats.totals}
                    paxByTrip={paxStats.byTrip}
                    onCreate={openCreate}
                    onShare={() => setShareOpen(true)}
                    onAnalytics={() => setView('analytics')}
                    onScan={() => setScanMode('pick')}
                    onManage={(t) => setManaging(t)}
                    onSearch={() => setSearchOpen(true)}
                  />
                ) : (
                  <OverviewSkeleton />
                )}
                <OnboardingChecklist
                  sub={sub}
                  trips={trips}
                  totals={paxStats.totals}
                  loading={loading}
                  onCreateTrip={openCreate}
                  onShare={() => setShareOpen(true)}
                  onManageFirst={manageFirst}
                  onOrgData={manageFirstCrew}
                />
              </>
            )}

            {view === 'analytics' && (
              <CampaignAnalytics trips={trips} byTrip={paxStats.byTrip} totals={paxStats.totals} subscriberId={sub?.id} org={sub?.org_name} />
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
          </div>
        )}

        {modalOpen && sub && (
          <TripFormModal trip={editing} subscriberId={sub.id} onClose={closeModal} onSaved={handleSaved} />
        )}

        {sub?.id && <TeamSheet open={teamOpen} subscriberId={sub.id} onClose={() => setTeamOpen(false)} />}
        {sub?.id && (
          <PilgrimSearch
            open={searchOpen}
            subscriberId={sub.id}
            onClose={() => setSearchOpen(false)}
            onOpenTrip={(tripId) => { const t = trips.find((x) => x.id === tripId); if (t) setManaging(t) }}
          />
        )}

        <BottomSheet
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          title="مشاركة رابط الحجز"
          actions={
            <button className="btn btn-em btn-block" onClick={copyLink} disabled={!shareUrl}>
              <Icon name={copied ? 'check' : 'copy'} size={17} />
              {copied ? 'تم النسخ ✓' : 'نسخ الرابط'}
            </button>
          }
        >
          <div className="stats" style={{ marginTop: 0 }}>
            <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={15} /></span>مدفوع</div><div className="v">{paxStats.totals.paid}</div></div>
            <div className="stat info"><div className="top"><span className="ic"><Icon name="seat" size={15} /></span>مقاعد محجوزة</div><div className="v">{paxStats.totals.count}/{totalSeats}</div></div>
          </div>
          <div className="share-box" style={{ marginTop: 14 }}>
            <code>{shareUrl || '—'}</code>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 10, textAlign: 'center' }}>
            شارك هذا الرابط مع العملاء ليملؤوا بياناتهم ويختاروا مقاعدهم مباشرة
          </p>
        </BottomSheet>
      </AppShell>

      <FeedbackFab onOpen={() => setFeedbackOpen(true)} />
      <FeedbackSheet open={feedbackOpen} audience="subscriber" onClose={() => setFeedbackOpen(false)} />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} sub={sub} onSubChanged={load} />

      {/* اختيارُ نوع المسح */}
      <BottomSheet
        open={scanMode === 'pick'}
        onClose={() => setScanMode(null)}
        title="مسح تذكرة"
        actions={<button className="btn btn-ghost btn-block" onClick={() => setScanMode(null)}>إلغاء</button>}
      >
        <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
          اختر ما تريد تسجيله للمعتمر بعد مسح باركود تذكرته:
        </p>
        <div className="actions" style={{ marginTop: 6 }}>
          <button className="action info" onClick={() => setScanMode('board')}>
            <Icon name="bus" size={18} /> تأكيد صعود الحافلة
          </button>
          <button className="action warn" onClick={() => setScanMode('checkin')}>
            <Icon name="bed" size={18} /> تأكيد استلام الغرفة
          </button>
        </div>
      </BottomSheet>

      {/* الماسح الحيّ — يفحص أيّ تذكرةٍ في حملتك */}
      {(scanMode === 'board' || scanMode === 'checkin') && (
        <Suspense fallback={<div className="muted" style={{ padding: 16 }}>تحميل الماسح…</div>}>
          <LazyScanner
            trip={null}
            mode={scanMode}
            onClose={() => setScanMode(null)}
            onUpdated={load}
          />
        </Suspense>
      )}

      <Roadmap />
    </>
  )
}

/* تسميةُ العدّ التنازليّ لموعد الرحلة */
function daysLabel(depart) {
  const d = Math.ceil((new Date(depart).getTime() - Date.now()) / 86400000)
  if (d <= 0) return 'اليوم'
  if (d === 1) return 'غدًا'
  if (d === 2) return 'بعد يومين'
  if (d <= 10) return `بعد ${d} أيّام`
  return `بعد ${d} يومًا`
}

/* ---------- هيكلٌ عظميٌّ للنظرة العامّة قبل وصول البيانات ----------
   يَمنع وميضَ «٠ معتمر · ٠٪» قبل ظهور القيم الحقيقيّة. النَّسجُ بسيطٌ
   لا يَستهلك طاقةً — مجرّدُ صناديقَ رماديّةٍ بنبضةٍ خفيفة. */
function OverviewSkeleton() {
  return (
    <>
      <section className="hero" style={{ opacity: .6 }}>
        <span className="tag" style={{ background: 'rgba(255,255,255,.06)', color: 'transparent' }}>منصّة عُمرة</span>
        <h2 style={{ background: 'rgba(255,255,255,.05)', color: 'transparent', borderRadius: 6, width: '60%' }}>—</h2>
        <p style={{ background: 'rgba(255,255,255,.04)', color: 'transparent', borderRadius: 6, width: '85%' }}>—</p>
      </section>
      <div className="stats" style={{ opacity: .55 }}>
        {[0,1,2,3].map((i) => (
          <div className="stat" key={i}>
            <div className="top" style={{ color: 'transparent' }}>—</div>
            <div className="v" style={{ color: 'transparent' }}>—</div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ---------- نظرة عامة ---------- */
function Overview({ sub, profile, trips, totalSeats, planLabel, totals, paxByTrip, onCreate, onShare, onAnalytics, onScan, onManage, onSearch }) {
  const tt = totals || { count: 0, paid: 0, boarded: 0, checked_in: 0 }
  const upcoming = trips.filter((t) => t.status === 'open' || t.status === 'draft').length
  // الرحلة القادمة: أقرب رحلةٍ مفتوحةٍ/نشطةٍ لم يفت موعدها بعد
  const now = Date.now()
  const nextTrip = trips
    .filter((t) => t.depart_at && new Date(t.depart_at).getTime() > now && t.status !== 'done' && t.status !== 'draft')
    .sort((a, b) => new Date(a.depart_at) - new Date(b.depart_at))[0]
  const ne = nextTrip ? (paxByTrip?.get(nextTrip.id) || { count: 0, paid: 0 }) : null
  const neCap = Number(nextTrip?.capacity) || 0
  const nePct = neCap > 0 ? Math.min(100, Math.round((ne.count / neCap) * 100)) : 0

  // تفادي تكرار الاسم في الهيرو حين يكون اسم الحملة هو نفسه اسم المستخدم.
  const firstName = profile?.full_name ? profile.full_name.split(' ')[0] : ''
  const orgName = sub?.org_name || ''
  const showOrgInHero = orgName && orgName !== firstName && !orgName.startsWith(firstName) && !firstName.startsWith(orgName)

  return (
    <>
      <section className="hero">
        <span className="tag">منصّة عُمرة</span>
        <h2>أهلًا{firstName ? ` · ${firstName}` : ''}</h2>
        <p>{showOrgInHero ? `${orgName} — ` : ''}مركز قيادتك المركزيّ: كلّ رحلاتك والمعتمرون والإشعارات في مكانٍ واحد.</p>
      </section>

      {nextTrip && (
        <section className="panel" style={{ borderColor: 'rgba(196,154,69,.35)' }}>
          <div className="panel-head">
            <span className="ic-badge"><Icon name="trips" size={18} /></span>
            <div>
              <h3 style={{ margin: 0 }}>الرحلة القادمة</h3>
              <span className="sub">{daysLabel(nextTrip.depart_at)} · {fmtShort(nextTrip.depart_at)}</span>
            </div>
            <span style={{ flex: 1 }} />
            <button className="btn btn-em btn-sm" onClick={() => onManage?.(nextTrip)}>
              <Icon name="arrowLeft" size={15} /> فتح
            </button>
          </div>
          <div style={{ fontWeight: 700, color: 'var(--cr-50)', margin: '2px 0 8px' }}>{nextTrip.title || 'رحلة'}</div>
          <div className="bar"><span style={{ width: nePct + '%' }} /></div>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {ne.count}/{neCap || '—'} مقعد ({nePct}%) · {ne.paid} مدفوع
          </div>
        </section>
      )}

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
          <button className="btn btn-em" onClick={onCreate} disabled={!sub}>
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
          <SkeletonList count={4} />
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
            <button className="btn btn-em" onClick={onManage}>
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
  const [view, setView] = useStickyState('cust:view', 'trips')
  const [orgName, setOrgName] = useState('')
  const [sub, setSub] = useState(null)
  const [trips, setTrips] = useState([])
  const [myBookings, setMyBookings] = useState([])   // ركّابي (passengers بـ profile_id = أنا)
  const [loading, setLoading] = useState(true)
  const [booking, setBooking] = useState(null)        // الرحلة قيد الحجز (شاشة كاملة)
  const [ticketFor, setTicketFor] = useState(null)    // حجزٌ لعرض تذكرته
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { confirm, toast } = useUI()
  const firstLoadRef = useRef(true)
  const retryCustRef = useRef(0)

  const load = useCallback(async () => {
    const cacheKey = user?.id ? `cust-dash:${user.id}` : null
    const cached = cacheKey ? getCached(cacheKey) : null
    const hadTrips    = (cached?.trips?.length ?? 0) > 0
    const hadBookings = (cached?.bookings?.length ?? 0) > 0
    const hadSub      = !!cached?.sub

    // SWR: snapshot سابق يُعرض فورًا
    if (firstLoadRef.current && cached) {
      if (cached.sub) { setSub(cached.sub); setOrgName(cached.sub.org_name) }
      if (cached.trips) setTrips(cached.trips)
      if (cached.bookings) setMyBookings(cached.bookings)
      setLoading(false)
    } else if (firstLoadRef.current) {
      setLoading(true)
    }

    let sq = supabase.from('subscribers').select('id, org_name, store_url, logo_url')
    sq = subscriberId ? sq.eq('id', subscriberId) : sq.limit(1)
    let tq = supabase
      .from('trips')
      .select('id, title, route_from, route_to, depart_at, return_at, capacity, bus_label, boarding_point, status, seating_policy, bus_rows, bus_back_row, price, notes')
      .order('depart_at', { ascending: true })
    if (subscriberId) tq = tq.eq('subscriber_id', subscriberId)
    const bq = user?.id
      ? supabase.from('passengers')
          .select('id, trip_id, full_name, seat_no, status, ticket_code, boarded_at, boarding_point, national_id, phone, gender, is_family, payment_ref')
          .eq('profile_id', user.id)
      : Promise.resolve({ data: [] })

    const [subRes, tripsRes, bRes] = await Promise.all([sq.maybeSingle(), tq, bq])

    const s = subRes.data
    const newTrips    = tripsRes.data ?? []
    const newBookings = bRes.data ?? []

    // ★ حارسُ empty الزائف
    const everythingEmpty = !s && newTrips.length === 0 && newBookings.length === 0
    if (everythingEmpty && (hadSub || hadTrips || hadBookings) && retryCustRef.current < 2) {
      retryCustRef.current += 1
      setTimeout(() => load(), 800)
      return
    }
    retryCustRef.current = 0

    if (s) { setSub(s); setOrgName(s.org_name) }
    // لا تَكتب فارغًا فوق مَملوء
    if (newTrips.length > 0 || !hadTrips)       setTrips(newTrips)
    if (newBookings.length > 0 || !hadBookings) setMyBookings(newBookings)

    if (cacheKey) {
      const safeTrips    = (newTrips.length > 0 || !hadTrips)       ? newTrips    : (cached?.trips ?? [])
      const safeBookings = (newBookings.length > 0 || !hadBookings) ? newBookings : (cached?.bookings ?? [])
      setCached(cacheKey, { sub: s ?? cached?.sub ?? null, trips: safeTrips, bookings: safeBookings })
    }

    setLoading(false)
    firstLoadRef.current = false
  }, [subscriberId, user])

  useEffect(() => { load() }, [load])

  // Realtime للعميل: تغيّر حالة حجزه (تأكيد الدفع/الصعود)، رحلاتٌ جديدة في حملته،
  // وردّ الإدارة على ملاحظاته (يلتقطه FeedbackSheet عند الفتح أيضًا).
  useRealtime('customer-home', user?.id ? [
    { table: 'passengers', filter: `profile_id=eq.${user.id}` },
    ...(subscriberId ? [{ table: 'trips', filter: `subscriber_id=eq.${subscriberId}` }] : []),
  ] : [], load, 350, [user?.id, subscriberId, load])

  const bookingByTrip = useMemo(() => {
    const m = new Map()
    for (const b of myBookings) m.set(b.trip_id, b)
    return m
  }, [myBookings])

  const tabs = [
    { section: 'رحلاتي' },
    { key: 'trips', label: 'الرحلات', icon: 'trips', badge: trips.length || undefined },
    { key: 'tickets', label: 'تذاكري', icon: 'barcode', badge: myBookings.length || undefined },
    { section: 'الحساب' },
    { key: 'feedback', label: 'تواصل مع الإدارة', icon: 'message' },
    { key: 'settings', label: 'الإعدادات', icon: 'settings' },
  ]

  function onTab(k) {
    setBooking(null); setTicketFor(null)
    if (k === 'feedback') { setFeedbackOpen(true); showFeedbackFab(); return }
    if (k === 'settings') { setSettingsOpen(true); return }
    setView(k)
  }

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
        onNotifNavigate={() => setView('tickets')}
      >
        <div key={view} className="view-fade">
        {view === 'trips' && (
          <>
            <PendingInviteBanner />
            <section className="hero">
              <span className="tag">حملتي</span>
              <h2>{orgName || 'رحلاتي المتاحة'}</h2>
              <p>اختر رحلتك المناسبة، أكمل بياناتك، واحجز مقعدك مباشرةً — تُعرض لك رحلات حملتك فقط.</p>
            </section>

            <div style={{ marginTop: 14 }}>
              {loading ? (
                <SkeletonList count={4} />
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
                <SkeletonList count={4} />
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
                      <StatusTimeline status={b.status} />
                      <div className="actions-row">
                        <button className="btn btn-em" onClick={() => setTicketFor(b)}><Icon name="qr" size={16} /> تذكرتي</button>
                        {b.status === 'registered' && t && (() => {
                          const payable = !!(sub?.store_url || t?.price != null)
                          return (
                            <button className="icon-btn" onClick={() => setBooking(t)} style={payable ? { color: 'var(--gd-300)' } : undefined}>
                              <Icon name={payable ? 'payments' : 'edit'} size={15} /> {payable ? 'الدفع وإرفاق الإيصال' : 'تعديل الحجز'}
                            </button>
                          )
                        })()}
                        {(b.status === 'registered' || b.status === 'paid') ? (
                          <button className="icon-btn danger" onClick={async () => {
                            const paid = b.status === 'paid'
                            const ok = await confirm({
                              title: 'إلغاء الحجز',
                              message: paid
                                ? `سيُلغى حجزك في «${t?.title || 'هذه الرحلة'}» ويُسجَّل طلبُ استردادٍ لمبلغك يعالجه صاحب الحملة. متابعة؟`
                                : `إلغاء حجزك في «${t?.title || 'هذه الرحلة'}»؟`,
                              confirmText: 'إلغاء الحجز', cancelText: 'تراجع', danger: true,
                            })
                            if (!ok) return
                            const { data, error } = await supabase.rpc('cancel_booking', { p_passenger: b.id })
                            if (error) toast(translateRpcError(error, 'تعذّر إلغاء الحجز.'), { type: 'error' })
                            else { toast(data?.refund_requested ? 'أُلغي الحجز وسُجّل طلب الاسترداد ✓' : 'تم إلغاء الحجز', { type: 'info' }); load() }
                          }}><Icon name="trash" size={15} /> إلغاء</button>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>للتعديل أو الإلغاء تواصل مع الحملة</span>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
        </div>
      </AppShell>

      <FeedbackFab onOpen={() => setFeedbackOpen(true)} />
      <FeedbackSheet open={feedbackOpen} audience="customer" onClose={() => setFeedbackOpen(false)} />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} sub={null} />
    </>
  )
}

/* تذكرة العميل — غلافٌ كسولٌ لمكوّن Ticket */
const CustomerTicket = lazy(() => import('../../components/Ticket'))

/* بطاقة رحلةٍ للعميل: تعرض زرّ الحجز أو التذكرة حسب حالته ودورة حياة الرحلة */
function CustomerTripCard({ trip, booking, onBook, onTicket }) {
  const lc = tripLifecycle(trip)
  return (
    <article className="trip-card">
      <div className="tags">
        <span className="tag gold">عمرة</span>
        <span className={`tag ${lc.cls}`}>{lc.label}</span>
        {lc.soon && <span className="tag warn">قريبًا</span>}
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
            <button className="btn btn-em" onClick={() => onTicket(booking)}><Icon name="qr" size={16} /> تذكرتي</button>
            <button className="icon-btn" onClick={onBook}><Icon name="edit" size={15} /> تعديل الحجز</button>
          </>
        ) : lc.bookable ? (
          <button className="btn btn-em" onClick={onBook}><Icon name="seat" size={16} /> احجز مقعدي</button>
        ) : (
          <span className="muted" style={{ fontSize: 13 }}><Icon name="lock" size={14} /> {lc.reason}</span>
        )}
      </div>
    </article>
  )
}
