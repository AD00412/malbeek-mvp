import { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { onWake } from '../../lib/wake'
import { getCached, setCached } from '../../lib/dataCache'
import useStickyState from '../../lib/useStickyState'
import Icon from '../../components/Icon'
import CompassMark from '../../components/CompassMark'
import PassengerFormModal from '../../components/PassengerFormModal'
import { PASSENGER_STATUS } from '../../lib/passengerStatus'
import ImportPassengers from '../../components/ImportPassengers'
import CrewFormModal from '../../components/CrewFormModal'
import Manifest from '../../components/Manifest'
import SeatMap from '../../components/SeatMap'
import BusEditor from '../../components/BusEditor'
import HotelsManager from '../../components/HotelsManager'
import AuditLogSheet from '../../components/AuditLogSheet'
import RefundsSheet from '../../components/RefundsSheet'
import { SkeletonList } from '../../components/Skeleton'
import BottomSheet from '../../components/BottomSheet'
import SignedImage from '../../components/SignedImage'
import { policyLabel } from '../../lib/busLayout'
import { loadTripBuses, busLayout, busName } from '../../lib/buses'
import { tableToDocx } from '../../lib/docx'
import { translateRpcError } from '../../lib/rpcErrors'
import { useUI } from '../../lib/useUI'
import { waMeLink, fmtDateTime } from '../../lib/format'

// تحميلٌ كسولٌ — الماسح والتذكرة خارج الحزمة الأساسية (والتذكرة تُحمّل qrcode عند الحاجة)
const Ticket = lazy(() => import('../../components/Ticket'))
const Scanner = lazy(() => import('../../components/Scanner'))

/* غلافٌ بسيطٌ بانتظار تحميل المكوّن الكسول */
function LazyLoading() {
  return (
    <div className="manifest-overlay" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="sl-mark"><CompassMark size={64} /></div>
    </div>
  )
}

const STATUS_AR = { registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة' }
const STATUS_CLS = { registered: 'muted', paid: 'ok', boarded: 'info', checked_in: 'warn' }

function fmt(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return '—' }
}

/** يبني رسالة واتساب موحّدة للمعتمر (تذكيرٌ بحجزه ضمن الرحلة). */
function waMessage(p, trip, sub) {
  const greet = p.gender === 'female' ? 'الأخت الكريمة' : 'الأخ الكريم'
  const lines = [
    `السلام عليكم ورحمة الله،`,
    ``,
    `${greet} ${p.full_name || ''}،`,
    `تذكيرٌ بحجزك في رحلة العمرة «${trip?.title || ''}»:`,
    trip?.depart_at ? `• الذهاب: ${fmt(trip.depart_at)}` : null,
    p.seat_no ? `• المقعد: ${p.seat_no}` : null,
    p.boarding_point ? `• مكان الركوب: ${p.boarding_point}` : (trip?.boarding_point ? `• مكان الركوب: ${trip.boarding_point}` : null),
    p.status === 'paid' ? `• الحالة: مدفوع ✓` : `• الحالة: بانتظار تأكيد الدفع`,
    p.ticket_code ? `• رمز التذكرة: ${p.ticket_code}` : null,
    ``,
    `بالتوفيق وتقبّل الله طاعتكم.`,
    sub?.org_name ? `— ${sub.org_name}` : null,
  ].filter(Boolean)
  return lines.join('\n')
}

/**
 * شاشة إدارة رحلةٍ واحدة: المعتمرون + المقاعد + الطاقم + الكشف الرسمي.
 * @param {object} trip
 * @param {object} sub      بيانات المؤسسة
 * @param {Function} onBack         إغلاق الشاشة والعودة للقائمة
 * @param {Function} onTripChanged  لإعادة تحميل قائمة الرحلات في الأب عند تغيّر الطاقم
 * @param {Function} onOpenTrip     لفتح رحلةٍ أخرى مباشرةً (مثل النسخة الجديدة بعد الاستنساخ)
 */
export default function TripManage({ trip: initialTrip, sub, onBack, onTripChanged, onOpenTrip, initialOpen, onInitialConsumed }) {
  const [trip, setTrip] = useState(initialTrip)
  const [passengers, setPassengers] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  // فلاتر/فرز/بحث محفوظةٌ لكلّ رحلةٍ على حدةٍ في sessionStorage — تعود بعد التنقّل سليمة.
  const tk = (k) => `tm:${initialTrip?.id || 'unknown'}:${k}`
  const [search, setSearch] = useStickyState(tk('search'), '')
  const [paxFilter, setPaxFilter] = useStickyState(tk('filter'), 'all') // all | unpaid | paid
  const [paxSort, setPaxSort] = useStickyState(tk('sort'), 'default')   // default | name | boarding | seat
  const [proofFor, setProofFor] = useState(null)   // المعتمر لعرض إيصال دفعه
  const { confirm, toast } = useUI()

  const [paxOpen, setPaxOpen] = useState(false)
  const [editingPax, setEditingPax] = useState(null)
  const [crewOpen, setCrewOpen] = useState(false)
  const [manifestOpen, setManifestOpen] = useState(false)
  const [ticketFor, setTicketFor] = useState(null)   // المعتمر لعرض تذكرته
  const [scanMode, setScanMode] = useState(null)     // 'board' | 'checkin' | null
  const [seatMapOpen, setSeatMapOpen] = useState(false)
  const [busEditOpen, setBusEditOpen] = useState(false)
  const [hotelsOpen, setHotelsOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [refundsOpen, setRefundsOpen] = useState(false)
  const [offersOpen, setOffersOpen] = useState(false)
  const [offerMsg, setOfferMsg] = useState('')
  const [remindOpen, setRemindOpen] = useState(false)
  const [waitlist, setWaitlist] = useState([])
  const [buses, setBuses] = useState([])
  const [mapBusId, setMapBusId] = useState(null)   // الباص المعروض في خريطة المقاعد
  const [importOpen, setImportOpen] = useState(false)
  const [dupOpen, setDupOpen] = useState(false)
  const [payments, setPayments] = useState([])

  // فتحٌ مباشرٌ لنموذجٍ معيّنٍ عند الدخول (مثلًا من جولة التهيئة: «بيانات المؤسسة»).
  useEffect(() => {
    if (initialOpen === 'crew') setCrewOpen(true)
    onInitialConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // SWR cache key لهذه الرحلة (يَنجو من re-mount عند التنقّل بين الصفحات)
  const cacheKey = trip?.id ? `trip-mgr:${trip.id}` : null

  // ★ تحميلٌ فوريٌّ من sessionCache عند mount — يُلغي «الأصفار» بعد التنقّل
  useEffect(() => {
    if (!cacheKey) return
    const snap = getCached(cacheKey)
    if (snap) {
      if (snap.passengers) setPassengers(snap.passengers)
      if (snap.waitlist)   setWaitlist(snap.waitlist)
      if (snap.buses)      setBuses(snap.buses)
      if (snap.payments)   setPayments(snap.payments)
      if (snap.mapBusId)   setMapBusId(snap.mapBusId)
      setLoading(false) // نَعرضُ المخزَّنَ فورًا — لا skeleton
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey])

  const firstLoad = useRef(true)
  // ★ حارسٌ ضدّ السباق: لو المستخدم بدّل الرحلةَ أثناء التحميل، نُلغي
  //   استدعاءَ setState لاحقًا فلا تُكتب بياناتُ الرحلة A على الرحلة B.
  const loadedTripIdRef = useRef(null)
  const loadPassengers = useCallback(async (retry = 0) => {
    if (!trip?.id) return
    const currentTripId = trip.id  // التَقَطه في الإغلاق
    loadedTripIdRef.current = currentTripId
    const cached = cacheKey ? getCached(cacheKey) : null
    const hadData = (cached?.passengers?.length ?? 0) > 0
    if (firstLoad.current && !cached) setLoading(true)
    setErr('')

    // مساعدٌ: لا نُحدّث state لو الرحلةُ المعروضةُ تَغيّرت
    const safeSet = (setter) => (v) => {
      if (loadedTripIdRef.current === currentTripId) setter(v)
    }

    const { data, error } = await supabase
      .from('passengers')
      .select('id, full_name, national_id, phone, nationality, seat_no, boarding_point, status, notes, gender, is_family, ticket_code, boarded_at, checked_in_at, payment_ref, payment_proof_url, profile_id, bus_id, room_id, amount, paid_at, payment_provider, created_at')
      .eq('trip_id', trip.id)
      .order('seat_no', { ascending: true, nullsFirst: false })

    if (error) {
      if (loadedTripIdRef.current === currentTripId) setErr('تعذّر تحميل المعتمرين: ' + error.message)
      setLoading(false); firstLoad.current = false
      return
    }

    // ★ تحقّقٌ من سباق: لو المستخدم بدّل الرحلةَ، نَتجاهل النتائج
    if (loadedTripIdRef.current !== currentTripId) return

    const rows = data ?? []
    if (rows.length === 0 && (hadData || passengers.length > 0) && retry < 2) {
      setTimeout(() => loadPassengers(retry + 1), 800)
      setLoading(false); firstLoad.current = false
      return
    }

    safeSet(setPassengers)(rows)
    setLoading(false); firstLoad.current = false

    // قائمة الانتظار
    const { data: w } = await supabase
      .from('waitlist').select('id, profile_id, full_name, phone, notified_at, created_at')
      .eq('trip_id', currentTripId).order('created_at', { ascending: true })
    if (loadedTripIdRef.current !== currentTripId) return  // الرحلةُ تغيّرت
    const wRows = w ?? []
    const cachedWait = cached?.waitlist?.length ?? 0
    if (wRows.length > 0 || cachedWait === 0) safeSet(setWaitlist)(wRows)

    // باصات الرحلة
    const bs = await loadTripBuses(currentTripId)
    if (loadedTripIdRef.current !== currentTripId) return
    const cachedBuses = cached?.buses?.length ?? 0
    let nextMapBusId = mapBusId
    if ((bs?.length ?? 0) > 0 || cachedBuses === 0) {
      safeSet(setBuses)(bs)
      if (loadedTripIdRef.current === currentTripId) {
        setMapBusId((cur) => {
          const next = (cur && bs.some((b) => b.id === cur)) ? cur : bs[0]?.id ?? null
          nextMapBusId = next
          return next
        })
      }
    }

    // مدفوعات البوّابة
    const { data: pm } = await supabase
      .from('payments').select('id, passenger_id, provider, provider_ref, amount, currency, created_at')
      .eq('trip_id', currentTripId).order('created_at', { ascending: false }).limit(200)
    if (loadedTripIdRef.current !== currentTripId) return
    const pmRows = pm ?? []
    const cachedPay = cached?.payments?.length ?? 0
    if (pmRows.length > 0 || cachedPay === 0) safeSet(setPayments)(pmRows)

    // ★ احفظ snapshot للـ cache — يَنجو من re-mount بعد التنقّل
    if (cacheKey) {
      setCached(cacheKey, {
        passengers: rows,
        waitlist: wRows,
        buses: bs || [],
        payments: pmRows,
        mapBusId: nextMapBusId,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip, cacheKey])

  const reloadTrip = useCallback(async () => {
    if (!trip?.id) return
    const { data } = await supabase.from('trips').select('*').eq('id', trip.id).maybeSingle()
    if (data) setTrip(data)
    onTripChanged?.()
  }, [trip, onTripChanged])

  useEffect(() => { loadPassengers() }, [loadPassengers])

  // تحديثٌ حيٌّ: عند أي تغيّرٍ على passengers لهذه الرحلة، أعِد التحميل (مع كبحٍ
  // يجمع دفعات التغييرات المتتالية كالاستيراد فلا تتكرّر الجلبات ولا تومض القائمة).
  // + إعادةُ ضمِّ القناة وتحديثٌ فوريٌّ عند إيقاظ التطبيق (lib/wake.js) فلا تتجمّد
  //   الصفحةُ بعد الرجوع من الخلفيّة.
  useEffect(() => {
    if (!trip?.id) return
    let cancelled = false
    let t = null
    const debouncedReload = () => {
      clearTimeout(t); t = setTimeout(() => { if (!cancelled) loadPassengers() }, 350)
    }
    let ch = null
    function subscribe() {
      if (ch) { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
      ch = supabase
        .channel(`pax-mgr:${trip.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'passengers', filter: `trip_id=eq.${trip.id}` }, debouncedReload)
        .subscribe()
    }
    subscribe()
    const unsubscribeWake = onWake(() => { if (!cancelled) { subscribe(); debouncedReload() } })
    return () => {
      cancelled = true
      clearTimeout(t)
      unsubscribeWake()
      if (ch) { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
    }
  }, [trip?.id, loadPassengers])

  function openAdd() { setEditingPax(null); setPaxOpen(true) }
  function openEdit(p) { setEditingPax(p); setPaxOpen(true) }

  /** بياناتُ كشف المعتمرين للتصدير (تُستخدم في DOCX، والـ PDF يستعمل HTML الكشف الرسمي). */
  function rosterRows() {
    const statusAr = { registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة' }
    const busById = new Map(buses.map((b) => [b.id, busName(b)]))
    return passengers.map((p) => [
      p.full_name || '', p.national_id || '', p.phone || '', p.nationality || '',
      p.gender === 'female' ? 'أنثى' : 'ذكر',
      busById.get(p.bus_id) || '', p.seat_no || '', p.boarding_point || '',
      statusAr[p.status] || p.status,
      p.amount != null ? p.amount : '', fmtDateTime(p.paid_at), p.ticket_code || '',
    ])
  }
  const rosterHeaders = ['الاسم الرباعي','رقم الهوية/الإقامة','الجوال','الجنسية','الجنس','الباص','المقعد','مكان الركوب','الحالة','المبلغ','وقت الدفع','رمز التذكرة']

  async function exportRosterDocx() {
    toast('جارٍ تجهيز ملفّ Word…', { type: 'info' })
    try {
      await tableToDocx({
        title: `كشف معتمري رحلة «${trip?.title || ''}»`,
        subtitle: sub?.org_name || '',
        org: sub?.org_name || '',
        meta: [
          trip?.route_from ? `المسار: ${trip.route_from} ← ${trip.route_to || ''}` : '',
          trip?.depart_at ? `الذهاب: ${new Date(trip.depart_at).toLocaleDateString('ar-SA')}` : '',
          `عدد المعتمرين: ${passengers.length}`,
        ].filter(Boolean),
        headers: rosterHeaders,
        rows: rosterRows(),
        filename: `كشف-${(trip?.title || 'رحلة').replace(/\s+/g, '_')}`,
      })
      toast('تم تنزيل ملفّ Word', { type: 'success' })
    } catch (e) {
      console.error(e)
      toast('تعذّر إنشاء ملفّ Word — حاول مجدّدًا.', { type: 'error' })
    }
  }

  // إشعارٌ داخل التطبيق للمعتمرين المسجّلين بحساب (تُستدعى من نافذة التذكير الجماعيّ).
  async function sendInAppReminder() {
    const { data, error } = await supabase.rpc('remind_trip', { p_trip: trip.id })
    if (error) { toast(translateRpcError(error, 'تعذّر إرسال التذكير.'), { type: 'error' }); return }
    toast(`أُرسل إشعارٌ داخل التطبيق إلى ${data ?? 0} معتمرًا ✓`, { type: 'success' })
  }

  async function removePax(p) {
    if (!p?.id) return
    if (!(await confirm({ title: 'حذف معتمر', message: `حذف «${p.full_name}» من الكشف؟`, confirmText: 'حذف', danger: true }))) return
    const { error } = await supabase.from('passengers').delete().eq('id', p.id)
    if (error) { setErr(translateRpcError(error, 'تعذّر الحذف.')); return }
    toast('تم حذف المعتمر', { type: 'success' })
    loadPassengers()
  }

  const cap = Number(trip?.capacity) || 0
  // ملخّصاتٌ مرّةً واحدةً عند تغيّر passengers/price/cap — لا حلقاتٍ في كلّ rerender.
  const price = trip?.price != null ? Number(trip.price) : null
  const summary = useMemo(() => {
    let paid = 0, boarded = 0, collected = 0
    for (const p of passengers) {
      const isPaid = p.status === 'paid' || p.status === 'boarded' || p.status === 'checked_in'
      const isBoarded = p.status === 'boarded' || p.status === 'checked_in'
      if (isPaid) { paid++; collected += Number(p.amount) || (price || 0) }
      if (isBoarded) boarded++
    }
    const count = passengers.length
    const pct = cap > 0 ? Math.min(100, Math.round((count / cap) * 100)) : 0
    const expected = price != null ? price * count : null
    return { count, paid, boarded, collected, expected, pct }
  }, [passengers, price, cap])
  const { count, paid, boarded, collected, expected, pct } = summary
  const money = (n) => Number(n || 0).toLocaleString('en-US')

  // أرقام الهويّة المكرّرة داخل الرحلة (تُرفض في الكشوف الرسميّة) — للتنبيه
  const dupIds = useMemo(() => {
    const counts = {}
    for (const p of passengers) {
      const id = (p.national_id || '').trim()
      if (id) counts[id] = (counts[id] || 0) + 1
    }
    return new Set(Object.keys(counts).filter((k) => counts[k] > 1))
  }, [passengers])

  const q = search.trim().toLowerCase()
  const PAID = new Set(['paid', 'boarded', 'checked_in'])
  let filtered = q
    ? passengers.filter((p) => [p.full_name, p.national_id, p.phone, p.seat_no, p.boarding_point]
        .filter(Boolean).join(' ').toLowerCase().includes(q))
    : passengers
  if (paxFilter === 'unpaid') filtered = filtered.filter((p) => !PAID.has(p.status))
  else if (paxFilter === 'paid') filtered = filtered.filter((p) => PAID.has(p.status))
  // ترتيبٌ طبيعيٌّ للمقاعد: «٢» قبل «١٠» (لا ترتيبٌ نصّيّ)، ويدعم المقاعد الأبجديّة (A2 قبل A10)
  const seatCmp = (a, b) => {
    const sa = String(a.seat_no || ''), sb = String(b.seat_no || '')
    if (!sa) return sb ? 1 : 0
    if (!sb) return -1
    return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' })
  }
  const by = {
    default: seatCmp,
    seat: seatCmp,
    name: (a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ar'),
    boarding: (a, b) => (a.boarding_point || '').localeCompare(b.boarding_point || '', 'ar') || (a.full_name || '').localeCompare(b.full_name || '', 'ar'),
  }[paxSort]
  if (by) filtered = [...filtered].sort(by)

  if (manifestOpen) {
    return <Manifest trip={trip} sub={sub} passengers={passengers} buses={buses} onClose={() => setManifestOpen(false)} />
  }
  if (busEditOpen) {
    return (
      <BusEditor
        trip={trip}
        passengers={passengers}
        onClose={() => setBusEditOpen(false)}
        onSaved={() => { setBusEditOpen(false); reloadTrip() }}
      />
    )
  }
  if (hotelsOpen) {
    return (
      <HotelsManager
        trip={trip}
        sub={sub}
        passengers={passengers}
        onClose={() => setHotelsOpen(false)}
        onChanged={loadPassengers}
      />
    )
  }
  if (ticketFor) {
    return (
      <Suspense fallback={<LazyLoading />}>
        <Ticket passenger={ticketFor} trip={trip} sub={sub} buses={buses} onClose={() => setTicketFor(null)} />
      </Suspense>
    )
  }
  if (scanMode) {
    return (
      <Suspense fallback={<LazyLoading />}>
        <Scanner trip={trip} mode={scanMode} onClose={() => setScanMode(null)} onUpdated={loadPassengers} />
      </Suspense>
    )
  }

  return (
    <>
      {/* رأس الشاشة — شريط رجوعٍ ثابتٌ يبقى في المتناول أثناء التمرير */}
      <div className="tm-backbar">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <Icon name="arrowRight" size={16} /> رجوع للرحلات
        </button>
      </div>

      <section className="hero">
        <div className="tags">
          <span className="tag gold">عمرة</span>
          <span className="tag muted">{trip?.bus_label || 'بدون باص'}</span>
          <span className="tag info">{policyLabel(trip?.seating_policy)}</span>
        </div>
        <h2 style={{ marginTop: 8 }}>{trip?.title || 'رحلة'}</h2>
        <p>{(trip?.route_from || '—') + ' ← ' + (trip?.route_to || '—')} · {fmt(trip?.depart_at)}</p>
      </section>

      <div className="stats">
        <div className="stat"><div className="top"><span className="ic"><Icon name="customers" size={15} /></span>المسجّلون</div><div className="v">{count}{cap ? <span style={{ fontSize: 16, color: 'var(--cr-300)' }}>/{cap}</span> : null}</div></div>
        <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={15} /></span>مدفوع</div><div className="v">{paid}</div></div>
        <div className="stat info"><div className="top"><span className="ic"><Icon name="bus" size={15} /></span>صعدوا</div><div className="v">{boarded}</div></div>
        <div className="stat warn"><div className="top"><span className="ic"><Icon name="seat" size={15} /></span>الإشغال</div><div className="v">{pct}%</div></div>
      </div>

      {(price != null || paid > 0) && (
        <div className="stats" style={{ marginTop: 12 }}>
          <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={15} /></span>المحصّل</div><div className="v" style={{ fontSize: 22 }}>{money(collected)} <span style={{ fontSize: 13, color: 'var(--cr-300)' }}>﷼</span></div></div>
          <div className="stat warn"><div className="top"><span className="ic"><Icon name="chart" size={15} /></span>المتوقّع</div><div className="v" style={{ fontSize: 22 }}>{expected != null ? <>{money(expected)} <span style={{ fontSize: 13, color: 'var(--cr-300)' }}>﷼</span></> : <span style={{ fontSize: 14, color: 'var(--cr-300)' }}>—</span>}</div></div>
          <div className="stat"><div className="top"><span className="ic"><Icon name="seat" size={15} /></span>سعر المقعد</div><div className="v" style={{ fontSize: 22 }}>{price != null ? <>{money(price)} <span style={{ fontSize: 13, color: 'var(--cr-300)' }}>﷼</span></> : <span style={{ fontSize: 14, color: 'var(--cr-300)' }}>غير محدّد</span>}</div></div>
        </div>
      )}
      {price == null && paid > 0 && (
        <div className="alert warn" style={{ marginTop: 10, fontSize: 13 }}>
          <Icon name="bell" size={14} /> سعرُ المقعد غير محدّدٍ — حرّر الرحلةَ من الصفحة الرئيسيّة لإظهار «المحصّل» و«المتوقّع» بدقّة.
        </div>
      )}

      {/* أزرار الإجراءات */}
      <div className="actions" style={{ marginTop: 16 }}>
        <div className="sec-label">المعتمرون</div>
        <div className="action-row">
          <button className="action primary" onClick={openAdd}>
            <Icon name="plus" size={18} /> إضافة معتمر
          </button>
          <button className="action" onClick={() => setImportOpen(true)}>
            <Icon name="download" size={18} /> استيراد قائمة
          </button>
        </div>
        <button className="action" onClick={() => setRemindOpen(true)} disabled={count === 0}>
          <Icon name="bell" size={18} /> تذكير المعتمرين بالرحلة
        </button>

        <div className="sec-label" style={{ marginTop: 6 }}>الصعود والتسكين</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="action info" style={{ flex: 1 }} onClick={() => setScanMode('board')}>
            <Icon name="qr" size={18} /> مسح الصعود
          </button>
          <button className="action warn" style={{ flex: 1 }} onClick={() => setScanMode('checkin')}>
            <Icon name="bed" size={18} /> مسح التسكين
          </button>
        </div>
        <button className="action info" onClick={() => setHotelsOpen(true)}>
          <Icon name="bed" size={18} /> الفنادق والتسكين
        </button>

        <div className="sec-label" style={{ marginTop: 6 }}>الباص والمقاعد</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="action" style={{ flex: 1 }} onClick={() => setSeatMapOpen(true)}>
            <Icon name="seat" size={18} /> خريطة المقاعد
          </button>
          <button className="action" style={{ flex: 1 }} onClick={() => setBusEditOpen(true)}>
            <Icon name="settings" size={18} /> تعديل الباص
          </button>
        </div>
        <button className="action" onClick={() => setCrewOpen(true)}>
          <Icon name="bus" size={18} /> الباص والطاقم (للكشف)
        </button>

        <div className="sec-label" style={{ marginTop: 6 }}>الكشوفات والتواصل</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="action ok" style={{ flex: 1 }} onClick={() => setManifestOpen(true)} disabled={count === 0}>
            <Icon name="manifest" size={18} /> الكشف الرسمي (PDF)
          </button>
          <button className="action" style={{ flex: 1 }} onClick={exportRosterDocx} disabled={count === 0}>
            <Icon name="edit" size={18} /> Word قابلٌ للتعديل
          </button>
        </div>
        <button className="action violet" onClick={() => setOffersOpen(true)} disabled={count === 0}>
          <Icon name="message" size={18} /> إرسال عرض
        </button>

        <div className="sec-label" style={{ marginTop: 6 }}>متقدّم</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="action" style={{ flex: 1 }} onClick={() => setRefundsOpen(true)}>
            <Icon name="payments" size={18} /> طلبات الاسترداد
          </button>
          <button className="action" style={{ flex: 1 }} onClick={() => setAuditOpen(true)}>
            <Icon name="manifest" size={18} /> سجلّ النشاط
          </button>
        </div>
        <button className="action" onClick={() => setDupOpen(true)}>
          <Icon name="copy" size={18} /> استنساخ هذه الرحلة (لفوجٍ جديد)
        </button>
      </div>

      {err && <div className="alert err" style={{ marginTop: 14 }}>{err}</div>}

      {/* قائمة المعتمرين */}
      <section className="panel">
        <div className="panel-head">
          <h3>المعتمرون</h3><span className="sub">({count})</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-em btn-sm" onClick={openAdd}><Icon name="plus" size={16} /> إضافة</button>
        </div>

        {dupIds.size > 0 && (
          <div className="alert warn" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Icon name="bell" size={16} />
            <span>تنبيه: {dupIds.size} رقم هويّةٍ مكرّر بين المعتمرين — تُرفض الكشوف الرسميّة بالمكرّرات. راجِع المعلّمين بـ«هويّة مكرّرة».</span>
          </div>
        )}

        <div className="field search" style={{ marginBottom: 4 }}>
          <span className="ic"><Icon name="search" size={17} /></span>
          <input type="text" placeholder="بحث: اسم / هوية / جوال / مقعد" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="chips" style={{ marginTop: 2, marginBottom: 8, alignItems: 'center' }}>
          {[{ k: 'all', t: 'الكلّ' }, { k: 'unpaid', t: 'غير المدفوعين' }, { k: 'paid', t: 'المدفوعون' }].map((f) => (
            <button key={f.k} type="button" className={`chip ${paxFilter === f.k ? 'active' : ''}`} onClick={() => setPaxFilter(f.k)}>{f.t}</button>
          ))}
          <span style={{ flex: 1 }} />
          <select value={paxSort} onChange={(e) => setPaxSort(e.target.value)} aria-label="الترتيب"
            style={{ width: 'auto', padding: '6px 10px', fontSize: 13 }}>
            <option value="default">الترتيب: تلقائيّ</option>
            <option value="name">الاسم</option>
            <option value="boarding">مكان الركوب</option>
            <option value="seat">المقعد</option>
          </select>
        </div>

        {loading ? (
          <SkeletonList count={5} />
        ) : filtered.length === 0 ? (
          <div className="empty">
            <div className="em-mark"><CompassMark size={52} /></div>
            <div className="em-ttl">{count === 0 ? 'لا يوجد معتمرون بعد' : 'لا نتائج للبحث'}</div>
            <div>{count === 0 ? 'أضف أوّل معتمرٍ ليظهر في الكشف الرسمي.' : 'جرّب كلمةً أخرى.'}</div>
          </div>
        ) : (
          <div className="pax-list">
            {filtered.map((p, i) => (
              <div className="pax-row" key={p.id}>
                <div className="pax-seat">{p.seat_no || (i + 1)}</div>
                <div className="pax-main">
                  <div className="pax-name">
                    {p.full_name}
                    {p.profile_id && <span className="tag muted" style={{ fontSize: 9, padding: '1px 6px', marginInlineStart: 6 }}>ذاتي</span>}
                    {p.national_id && dupIds.has(p.national_id.trim()) && (
                      <span className="tag danger" style={{ fontSize: 9, padding: '1px 6px', marginInlineStart: 6 }}>هويّة مكرّرة</span>
                    )}
                  </div>
                  <div className="pax-meta">
                    <span className="ltr">{p.national_id || '—'}</span>
                    <span>·</span>
                    <span className="ltr">{p.phone || '—'}</span>
                    {p.boarding_point && <><span>·</span><span>{p.boarding_point}</span></>}
                    {p.payment_ref && p.status === 'registered' && (
                      <><span>·</span><span style={{ color: 'var(--warn-ink)' }}>دفع بانتظار التأكيد: {p.payment_ref}</span></>
                    )}
                    {p.payment_proof_url && p.status === 'registered' && (
                      <><span>·</span>
                        <button type="button" className="tag warn" style={{ cursor: 'pointer', border: 'none' }} onClick={() => setProofFor(p)}>
                          <Icon name="eye" size={12} /> إيصالٌ مرفق
                        </button>
                      </>
                    )}
                    {p.paid_at && (p.status === 'paid' || p.status === 'boarded' || p.status === 'checked_in') && (
                      <><span>·</span><span style={{ color: 'var(--ok-ink)' }}>
                        {p.amount != null
                          ? `${Number(p.amount).toLocaleString('en-US')}﷼ `
                          : price != null ? `${money(price)}﷼ ` : ''}
                        {p.payment_provider ? 'مؤكّد آليًّا' : 'مؤكّد'}
                      </span></>
                    )}
                  </div>
                </div>
                <span className={`st ${STATUS_CLS[p.status] || 'muted'}`}>{STATUS_AR[p.status] || p.status}</span>
                <div className="pax-actions">
                  {(p.payment_ref || p.payment_proof_url) && p.status === 'registered' && (
                    <button className="icon-btn" aria-label="تأكيد الدفع" title="تأكيد الدفع" onClick={async () => {
                      const { error } = await supabase.from('passengers').update({ status: 'paid' }).eq('id', p.id)
                      if (error) toast(translateRpcError(error, 'تعذّر تأكيد الدفع.'), { type: 'error' })
                      else { toast('تم تأكيد الدفع', { type: 'success' }); loadPassengers() }
                    }}><Icon name="check" size={15} /></button>
                  )}
                  <button className="icon-btn" onClick={() => setTicketFor(p)} aria-label="التذكرة"><Icon name="qr" size={15} /></button>
                  {p.phone && (
                    <a
                      className="icon-btn"
                      href={waMeLink(p.phone, waMessage(p, trip, sub))}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`إرسال على واتساب لـ ${p.full_name}`}
                      aria-label="إرسال على واتساب"
                      style={{ color: '#25D366' }}
                    ><Icon name="whatsapp" size={15} /></a>
                  )}
                  <button className="icon-btn" onClick={() => openEdit(p)} aria-label="تعديل"><Icon name="edit" size={15} /></button>
                  <button className="icon-btn danger" onClick={() => removePax(p)} aria-label="حذف"><Icon name="trash" size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {waitlist.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>قائمة الانتظار</h3><span className="sub">({waitlist.length})</span>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: -4, marginBottom: 10 }}>
            عندما يتفرّغ مقعد، يُبلَّغ أوّل ٥ منتظرين تلقائيًّا.
          </p>
          <div className="pax-list">
            {waitlist.map((w, i) => (
              <div className="pax-row" key={w.id}>
                <div className="pax-seat">#{i + 1}</div>
                <div className="pax-main">
                  <div className="pax-name">{w.full_name || 'بانتظار'}</div>
                  <div className="pax-meta">
                    {w.phone && <span className="ltr">{w.phone}</span>}
                    {w.notified_at && <><span>·</span><span className="tag ok" style={{ fontSize: 10 }}>أُبلِغ</span></>}
                  </div>
                </div>
                <button className="icon-btn danger" onClick={async () => {
                  if (!(await confirm({ title: 'إزالة من الانتظار', message: 'إزالة هذا الشخص من قائمة الانتظار؟', confirmText: 'إزالة', danger: true }))) return
                  const { error } = await supabase.from('waitlist').delete().eq('id', w.id)
                  if (error) toast(translateRpcError(error, 'تعذّر الحذف.'), { type: 'error' })
                  else { toast('تمت الإزالة من قائمة الانتظار', { type: 'info' }); loadPassengers() }
                }}><Icon name="trash" size={15} /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      {payments.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>سجلّ مدفوعات البوّابة</h3><span className="sub">({payments.length})</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl tbl-cards">
              <thead><tr><th>المعتمر</th><th>المزوّد</th><th>المبلغ</th><th>المرجع</th><th>التاريخ</th></tr></thead>
              <tbody>
                {payments.map((pm) => {
                  const px = passengers.find((p) => p.id === pm.passenger_id)
                  return (
                    <tr key={pm.id}>
                      <td data-label="المعتمر">{px?.full_name || <span className="muted">غير مرتبط</span>}</td>
                      <td data-label="المزوّد">{pm.provider}</td>
                      <td data-label="المبلغ" style={{ fontFamily: 'var(--font-display)', color: 'var(--gd-300)' }}>{pm.amount != null ? `${Number(pm.amount).toLocaleString('en-US')} ${pm.currency || '﷼'}` : '—'}</td>
                      <td data-label="المرجع" className="ltr" style={{ textAlign: 'right' }}><code style={{ fontSize: 11 }}>{pm.provider_ref}</code></td>
                      <td data-label="التاريخ">{fmtDateTime(pm.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {importOpen && (
        <ImportPassengers
          open
          tripId={trip?.id}
          subscriberId={sub?.id}
          buses={buses}
          defaultBoarding={trip?.boarding_point}
          onClose={() => setImportOpen(false)}
          onDone={(n) => { setImportOpen(false); setErr(''); loadPassengers(); toast(`تم استيراد ${n} معتمرٍ بنجاح`, { type: 'success' }) }}
        />
      )}

      <DuplicateTripSheet
        open={dupOpen}
        sourceTitle={trip?.title}
        onClose={() => setDupOpen(false)}
        onDone={(newTrip) => { setDupOpen(false); onTripChanged?.(); onOpenTrip?.(newTrip) }}
        sourceId={trip?.id}
      />

      <AuditLogSheet open={auditOpen} tripId={trip?.id} subscriberId={sub?.id} onClose={() => setAuditOpen(false)} />
      <RefundsSheet open={refundsOpen} tripId={trip?.id} onClose={() => setRefundsOpen(false)} />

      <BottomSheet
        open={!!proofFor}
        title={`إيصال دفع · ${proofFor?.full_name || ''}`}
        onClose={() => setProofFor(null)}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setProofFor(null)}>إغلاق</button>
            {proofFor?.status === 'registered' && (
              <button className="btn btn-em" onClick={async () => {
                const { error } = await supabase.from('passengers').update({ status: 'paid' }).eq('id', proofFor.id)
                if (error) toast(translateRpcError(error, 'تعذّر تأكيد الدفع.'), { type: 'error' })
                else { toast('تم تأكيد الدفع', { type: 'success' }); setProofFor(null); loadPassengers() }
              }}><Icon name="check" size={16} /> تأكيد الدفع</button>
            )}
          </>
        }
      >
        {proofFor?.payment_ref && (
          <p className="muted" style={{ fontSize: 13 }}>رقم العملية: <strong style={{ color: 'var(--cr-50)' }}>{proofFor.payment_ref}</strong></p>
        )}
        {proofFor?.payment_proof_url
          ? <SignedImage bucket="payment-proofs" path={proofFor.payment_proof_url} maxHeight={420} showOpenFull />
          : <div className="empty">لا توجد صورة إيصالٍ مرفقة.</div>}
      </BottomSheet>

      {paxOpen && (
        <PassengerFormModal
          open
          key={editingPax?.id || 'new'}
          passenger={editingPax}
          tripId={trip?.id}
          subscriberId={sub?.id}
          seatingPolicy={trip?.seating_policy}
          busRows={trip?.bus_rows}
          busBack={trip?.bus_back_row}
          buses={buses}
          passengers={passengers}
          defaultBoarding={trip?.boarding_point}
          onClose={() => setPaxOpen(false)}
          onSaved={() => { setPaxOpen(false); loadPassengers() }}
        />
      )}

      <BottomSheet
        open={seatMapOpen}
        onClose={() => setSeatMapOpen(false)}
        title="خريطة المقاعد"
        actions={<button className="btn btn-em btn-block" onClick={() => setSeatMapOpen(false)}>تم</button>}
      >
        <p className="muted" style={{ fontSize: 13, marginTop: -8, marginBottom: 8, textAlign: 'center' }}>
          عرضٌ مباشرٌ للباص — يحدّث فور إضافة معتمرٍ أو نقل مقعده.
        </p>
        {buses.length > 1 && (
          <div className="bus-tabs" style={{ justifyContent: 'center' }}>
            {buses.map((b) => (
              <button key={b.id} type="button" className={`bus-tab ${b.id === mapBusId ? 'active' : ''}`}
                onClick={() => setMapBusId(b.id)}>
                <Icon name="bus" size={15} /> {busName(b)}
              </button>
            ))}
          </div>
        )}
        {(() => {
          const multi = buses.length > 1
          const active = buses.find((b) => b.id === mapBusId)
          const lay = multi && active ? busLayout(active)
            : { rows: trip?.bus_rows, back: trip?.bus_back_row, policy: trip?.seating_policy }
          const pax = multi ? passengers.filter((p) => p.bus_id === mapBusId) : passengers
          return <SeatMap policy={lay.policy} rows={lay.rows} back={lay.back} passengers={pax} readOnly />
        })()}
      </BottomSheet>

      {crewOpen && (
        <CrewFormModal
          open
          trip={trip}
          sub={sub}
          onClose={() => setCrewOpen(false)}
          onSaved={() => { setCrewOpen(false); reloadTrip() }}
        />
      )}

      <OffersSheet
        open={offersOpen}
        onClose={() => setOffersOpen(false)}
        passengers={passengers}
        trip={trip}
        sub={sub}
        msg={offerMsg}
        setMsg={setOfferMsg}
      />

      <RemindSheet
        open={remindOpen}
        onClose={() => setRemindOpen(false)}
        passengers={passengers}
        trip={trip}
        sub={sub}
        onSendInApp={sendInAppReminder}
      />
    </>
  )
}

/* ---------- إرسال عرضٍ جماعيٍّ عبر واتساب/الإيميل ---------- */
function toWaPhoneIntl(p) {
  let d = String(p || '').replace(/[^\d]/g, '')
  if (!d) return ''
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0')) d = '966' + d.slice(1)        // محلّي سعودي
  else if (d.startsWith('5') && d.length === 9) d = '966' + d
  return d
}

function OffersSheet({ open, onClose, passengers, trip, sub, msg, setMsg }) {
  const withPhone = passengers.filter((p) => toWaPhoneIntl(p.phone))
  const defaultMsg = `السلام عليكم، من ${sub?.org_name || 'حملتنا'} بخصوص رحلة «${trip?.title || 'العمرة'}». `
  const text = (msg && msg.trim()) ? msg : defaultMsg

  function waOne(p) {
    const ph = toWaPhoneIntl(p.phone)
    if (!ph) return
    window.open(`https://wa.me/${ph}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }
  function mailAll() {
    // لا إيميل في سجلّ الراكب — نفتح رسالةً فارغةً بالنصّ للنسخ (احتياطي)
    // نستخدم location.href لا window.open('_blank') — الأخير يترك about:blank على الجوال
    window.location.href = `mailto:?subject=${encodeURIComponent('عرض ' + (sub?.org_name || 'الحملة'))}&body=${encodeURIComponent(text)}`
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="إرسال عرضٍ للمعتمرين"
      actions={<button className="btn btn-em btn-block" onClick={onClose}>تم</button>}
    >
      <div className="form" style={{ marginTop: 0 }}>
        <div className="field">
          <label>نصّ العرض</label>
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={defaultMsg} />
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          اضغط على معتمرٍ لفتح محادثة واتساب جاهزةً بالنصّ — {withPhone.length} معتمرٍ لديهم رقم جوال.
        </p>
        <button className="btn btn-ghost btn-block btn-sm" onClick={mailAll}>
          <Icon name="message" size={15} /> فتح رسالة بريدٍ بالنصّ
        </button>
        <div className="pax-list" style={{ marginTop: 6 }}>
          {withPhone.length === 0 ? (
            <div className="empty">لا يوجد معتمرون بأرقام جوال.</div>
          ) : withPhone.map((p) => (
            <button type="button" className="pax-row" key={p.id} style={{ cursor: 'pointer', textAlign: 'start' }} onClick={() => waOne(p)}>
              <div className="pax-seat"><Icon name="message" size={15} /></div>
              <div className="pax-main">
                <div className="pax-name">{p.full_name}</div>
                <div className="pax-meta ltr">{p.phone}</div>
              </div>
              <Icon name="external" size={15} />
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  )
}

/* ---------- تذكير المعتمرين جماعيًّا: إشعارٌ داخل التطبيق + واتساب متسلسل ---------- */
function RemindSheet({ open, onClose, passengers, trip, sub, onSendInApp }) {
  const withAccount = passengers.filter((p) => p.profile_id)
  const withPhone = passengers.filter((p) => toWaPhoneIntl(p.phone))
  const storeKey = `malbeek.remind.${trip?.id || ''}`
  const [done, setDone] = useState(() => new Set())
  const [inAppBusy, setInAppBusy] = useState(false)

  // نحفظ مَن تواصلنا معهم محلّيًّا — فتح واتساب يغادر التطبيق، فيبقى التقدّم عند العودة.
  useEffect(() => {
    if (!open) return
    try { const raw = localStorage.getItem(storeKey); setDone(new Set(raw ? JSON.parse(raw) : [])) }
    catch { setDone(new Set()) }
  }, [open, storeKey])

  function persist(next) {
    setDone(next)
    try { localStorage.setItem(storeKey, JSON.stringify([...next])) } catch (_) {}
  }
  function markDone(id) { const n = new Set(done); n.add(id); persist(n) }
  function toggleDone(id) { const n = new Set(done); n.has(id) ? n.delete(id) : n.add(id); persist(n) }

  const remaining = withPhone.filter((p) => !done.has(p.id))
  const nextPax = remaining[0]
  const sentCount = withPhone.length - remaining.length

  // يفتح واتساب لأوّل معتمرٍ لم نتواصل معه ويعلّمه (نقرة المستخدم تتجاوز حاجب النوافذ).
  function openNext() {
    if (!nextPax) return
    window.open(waMeLink(nextPax.phone, waMessage(nextPax, trip, sub)), '_blank', 'noopener')
    markDone(nextPax.id)
  }

  async function sendInApp() {
    if (inAppBusy) return
    setInAppBusy(true)
    await onSendInApp()
    setInAppBusy(false)
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="تذكير المعتمرين بالرحلة"
      actions={<button className="btn btn-em btn-block" onClick={onClose}>تم</button>}>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        ذكّر معتمري الرحلة بموعدها ومقاعدهم — عبر إشعارٍ داخل التطبيق لمن لديه حساب،
        وعبر واتساب (برسالةٍ شخصيّةٍ جاهزة) للجميع.
      </p>

      {/* إشعارٌ داخل التطبيق */}
      <div className="panel" style={{ padding: 14, marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="action-ic info"><Icon name="bell" size={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: 'var(--cr-50)' }}>إشعارٌ داخل التطبيق</div>
            <div className="muted" style={{ fontSize: 12.5 }}>{withAccount.length} معتمرٍ لديه حسابٌ في ملبّيك.</div>
          </div>
        </div>
        <button className="btn btn-ghost btn-block btn-sm" style={{ marginTop: 10 }}
          onClick={sendInApp} disabled={inAppBusy || withAccount.length === 0}>
          {inAppBusy ? <span className="spinner" /> : <><Icon name="bell" size={15} /> إرسال إشعارٍ للجميع</>}
        </button>
      </div>

      {/* تذكير واتساب جماعيّ متسلسل */}
      <div className="panel" style={{ padding: 14, marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="action-ic ok"><Icon name="message" size={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: 'var(--cr-50)' }}>تذكير عبر واتساب</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {withPhone.length === 0 ? 'لا معتمرَ برقم جوال.' : `تواصلتَ مع ${sentCount} من ${withPhone.length}.`}
            </div>
          </div>
          {sentCount > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => persist(new Set())}>تصفير</button>
          )}
        </div>

        {withPhone.length > 0 && (
          <>
            <div className="remind-bar" style={{ marginTop: 10 }}>
              <span style={{ width: `${Math.round((sentCount / withPhone.length) * 100)}%` }} />
            </div>
            <button className="btn btn-em btn-block" style={{ marginTop: 10 }} onClick={openNext} disabled={!nextPax}>
              {nextPax
                ? <><Icon name="message" size={16} /> فتح واتساب — {nextPax.full_name}</>
                : <><Icon name="check" size={16} /> تواصلتَ مع الجميع</>}
            </button>
            <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 6 }}>
              يفتح محادثةً جاهزةً بالرسالة — أرسِلها ثمّ عُد واضغط ثانيةً للتالي.
            </p>

            <div className="pax-list" style={{ marginTop: 8 }}>
              {withPhone.map((p) => {
                const sent = done.has(p.id)
                return (
                  <div className="pax-row" key={p.id} style={{ opacity: sent ? 0.62 : 1 }}>
                    <button type="button" className="rmd-check" aria-label={sent ? 'إلغاء العلامة' : 'تعليمٌ كمُرسَل'}
                      onClick={() => toggleDone(p.id)}>
                      <Icon name={sent ? 'check' : 'bell'} size={15} />
                    </button>
                    <div className="pax-main">
                      <div className="pax-name">{p.full_name}</div>
                      <div className="pax-meta ltr">{p.phone}</div>
                    </div>
                    <a className="icon-btn" href={waMeLink(p.phone, waMessage(p, trip, sub))}
                      target="_blank" rel="noopener noreferrer" onClick={() => markDone(p.id)}
                      aria-label={`واتساب لـ ${p.full_name}`}>
                      <Icon name="message" size={15} />
                    </a>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  )
}

/* ============================================================
   استنساخ الرحلة — مودال صغير، يستدعي RPC duplicate_trip.
   ============================================================ */
function DuplicateTripSheet({ open, sourceId, sourceTitle, onClose, onDone }) {
  const [suffix, setSuffix] = useState(' — الفوج التالي')
  const [shift, setShift] = useState('30')   // إزاحة افتراضيّةٌ شهرٌ
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function doDuplicate() {
    if (busy || !sourceId) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('duplicate_trip', {
      p_trip_id: sourceId,
      p_name_suffix: suffix || '',
      p_shift_days: Number(shift) || 0,
    })
    setBusy(false)
    if (error) { setErr(translateRpcError(error, 'تعذّر الاستنساخ.')); return }
    onDone?.(data)   // data = صفّ الرحلة الجديدة كاملًا
  }

  return (
    <BottomSheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title="استنساخ الرحلة لفوجٍ جديد"
      actions={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
          <button className="btn btn-em" onClick={doDuplicate} disabled={busy}>
            {busy ? <span className="spinner" /> : <><Icon name="copy" size={16} /> استنساخ</>}
          </button>
        </>
      }
    >
      <div className="form" style={{ marginTop: 0 }}>
        <div className="alert info" style={{ fontSize: 12.5 }}>
          نُنشئ رحلةً جديدةً (مسوّدة) بنفس إعدادات «{sourceTitle || 'الرحلة'}»: المسار، الباصات،
          الطاقم، السعر، وسياسة المقاعد. لا يُستنسخ المعتمرون ولا قائمة الانتظار ولا المدفوعات.
        </div>
        <div className="field">
          <label>لاحقة الاسم</label>
          <input type="text" placeholder=" — الفوج التالي" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
        </div>
        <div className="field ltr">
          <label>إزاحة التواريخ (أيام) — موجبٌ يؤجِّل، سالبٌ يُقدِّم</label>
          <input type="number" inputMode="numeric" placeholder="30" value={shift} onChange={(e) => setShift(e.target.value)} />
        </div>
        {err && <div className="alert err">{err}</div>}
      </div>
    </BottomSheet>
  )
}
