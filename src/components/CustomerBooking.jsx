import { useEffect, useState, useMemo, useRef, lazy, Suspense } from 'react'
import { supabase } from '../lib/supabaseClient'
import { onWake } from '../lib/wake'
import { getCached, setCached } from '../lib/dataCache'
import { useAuth } from '../app/useAuth'
import Icon from './Icon'
import SeatMap from './SeatMap'
import SignedImage from './SignedImage'
import CompassMark from './CompassMark'
import { toLatinDigits, normalizePhone, cleanName, isValidNationalId, isValidSaPhone, safeExt } from '../lib/format'
import { loadTripBuses, busLayout, busName } from '../lib/buses'
import { translateRpcError } from '../lib/rpcErrors'
import { tripLifecycle } from '../lib/tripLifecycle'
import { useUI } from '../lib/useUI'

const PROOF_MAX = 5 * 1024 * 1024
const PROOF_TYPES = ['image/png', 'image/jpeg', 'image/webp']

const Ticket = lazy(() => import('./Ticket'))

function fmt(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return '—' }
}

/**
 * تدفّق حجز العميل لرحلةٍ واحدة:
 * بياناته → اختيار المقعد من الخريطة الحيّة → (الدفع إن وُجد) → تذكرته.
 *
 * @param {object} trip
 * @param {object} sub        { id, org_name, store_url, ... }
 * @param {Function} onClose
 * @param {Function} onBooked
 */
export default function CustomerBooking({ trip, sub, onClose, onBooked }) {
  const { user, profile } = useAuth()
  const { toast } = useUI()
  const [booking, setBooking] = useState(null)     // سجلّ الراكب الحالي (إن حجز سابقًا)
  const [occupancy, setOccupancy] = useState([])   // [{seat_no, gender, is_family}]
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [showTicket, setShowTicket] = useState(false)

  // الحقول
  const [fullName, setFullName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [phone, setPhone] = useState('')
  const [gender, setGender] = useState('male')
  const [isFamily, setIsFamily] = useState(false)
  const [seatNo, setSeatNo] = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [boardingPoint, setBoardingPoint] = useState('')
  const [payBusy, setPayBusy] = useState(false)
  const [buses, setBuses] = useState([])
  const [busId, setBusId] = useState(null)
  const [proofBusy, setProofBusy] = useState(false)
  const proofRef = useRef(null)

  // رفع صورة إثبات الدفع (لقطة إتمام طلب المتجر) وربطها بحجز المعتمر.
  async function uploadProof(e) {
    const file = e.target.files?.[0]
    if (proofRef.current) proofRef.current.value = ''
    if (!file || !booking?.id) return
    const subId = sub?.id ?? trip?.subscriber_id
    if (!PROOF_TYPES.includes(file.type)) { toast('الصيغة غير مدعومة — استخدم PNG/JPG/WebP.', { type: 'error' }); return }
    if (file.size > PROOF_MAX) { toast('حجم الصورة كبير (٥ ميغابايت كحدٍّ أقصى).', { type: 'error' }); return }
    if (!subId || !user?.id) return
    setProofBusy(true)
    try {
      const ext = safeExt(file)
      const path = `${subId}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('payment-proofs').upload(path, file, { upsert: false, cacheControl: '3600', contentType: file.type })
      if (upErr) throw upErr
      const { error: updErr } = await supabase.from('passengers').update({ payment_proof_url: path }).eq('id', booking.id)
      if (updErr) throw updErr
      setBooking((b) => ({ ...b, payment_proof_url: path }))
      toast('تم إرفاق إيصال الدفع ✓ بانتظار تأكيد الحملة', { type: 'success' })
    } catch (e2) {
      toast(translateRpcError(e2, 'تعذّر رفع الإيصال — حاول مجدّدًا.'), { type: 'error' })
    } finally {
      setProofBusy(false)
    }
  }

  const lc = tripLifecycle(trip)
  const blockedNew = !booking?.id && !lc.bookable   // محاولة حجزٍ جديدٍ في رحلةٍ غير متاحة
  const multiBus = buses.length > 1
  const activeBus = buses.find((b) => b.id === busId) || buses[0] || null
  const layout = multiBus && activeBus ? busLayout(activeBus)
    : { rows: trip?.bus_rows, back: trip?.bus_back_row, policy: trip?.seating_policy }

  const retryLoadRef = useRef(0)
  async function load(retry = 0) {
    if (!trip?.id || !user?.id) return
    const cacheKey = `cust-booking:${trip.id}:${user.id}`
    const cached = getCached(cacheKey)
    const hadBuses = (cached?.buses?.length ?? 0) > 0
    const hadOcc   = (cached?.occupancy?.length ?? 0) > 0

    // SWR: نَعرض المخزَّن فورًا (لا skeleton)
    if (retry === 0 && cached) {
      if (cached.buses) setBuses(cached.buses)
      if (cached.busId) setBusId(cached.busId)
      if (cached.occupancy) setOccupancy(cached.occupancy)
      if (cached.booking) {
        setBooking(cached.booking)
      }
      setLoading(false)
    } else if (retry === 0) {
      setLoading(true)
    }
    setErr('')
    const subId = sub?.id ?? trip?.subscriber_id
    const [{ data: mine }, bs, { data: myCustomer }] = await Promise.all([
      supabase.from('passengers')
        .select('id, full_name, national_id, phone, gender, is_family, seat_no, status, ticket_code, boarded_at, boarding_point, payment_ref, payment_proof_url, bus_id')
        .eq('trip_id', trip.id).eq('profile_id', user.id).maybeSingle(),
      loadTripBuses(trip.id),
      subId
        ? supabase.from('customers').select('pickup_location')
            .eq('profile_id', user.id).eq('subscriber_id', subId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    // ★ حارسُ empty الزائف: لو الباصات فارغةٌ ومخزَّنُنا فيه باصات → إعادة محاولة
    const busArr = bs || []
    if (busArr.length === 0 && hadBuses && retryLoadRef.current < 2) {
      retryLoadRef.current += 1
      setTimeout(() => load(retryLoadRef.current), 800)
      return
    }
    retryLoadRef.current = 0

    if (busArr.length > 0 || !hadBuses) setBuses(busArr)
    const activeId = mine?.bus_id ?? busArr[0]?.id ?? null
    setBusId(activeId)
    const occArgs = busArr.length > 1 && activeId ? { p_trip: trip.id, p_bus: activeId } : { p_trip: trip.id }
    const { data: occ } = await supabase.rpc('trip_seat_occupancy', occArgs)
    const occArr = occ || []
    if (occArr.length > 0 || !hadOcc) setOccupancy(occArr)

    if (mine) {
      setBooking(mine)
      setFullName(mine.full_name ?? ''); setNationalId(mine.national_id ?? '')
      setPhone(mine.phone ?? ''); setGender(mine.gender ?? 'male')
      setIsFamily(!!mine.is_family); setSeatNo(mine.seat_no ?? '')
      setPaymentRef(mine.payment_ref ?? '')
      setBoardingPoint(mine.boarding_point ?? '')
    } else if (!cached?.booking) {
      // لا تَكتب فوق نموذجٍ مَملوءٍ من المخزَّن لو الشبكة رجعت null زائفًا
      setFullName(profile?.full_name ?? ''); setPhone(profile?.phone ?? '')
      setBoardingPoint(myCustomer?.pickup_location || trip?.boarding_point || '')
    }

    // احفظ snapshot — لا نَكتب فارغًا فوق مَملوء
    const safeBuses = (busArr.length > 0 || !hadBuses) ? busArr : (cached?.buses ?? [])
    const safeOcc   = (occArr.length > 0 || !hadOcc)   ? occArr : (cached?.occupancy ?? [])
    setCached(cacheKey, { buses: safeBuses, busId: activeId, occupancy: safeOcc, booking: mine ?? cached?.booking ?? null })

    setLoading(false)
  }
  useEffect(() => { load() }, [trip?.id, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // عودةٌ من بوّابة الدفع: ?paid=<id> → أظهر رسالة شكرٍ ونظّف الـ URL
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.get('paid')) {
      url.searchParams.delete('paid')
      window.history.replaceState({}, '', url)
      setTimeout(() => load(), 500)  // الـ webhook ربّما لم يصل بعد — حدّث بعد لحظة
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // تحديثٌ حيٌّ للمقاعد بلا PII:
  // - اشتراك Realtime يلتقط تغيّر سجلّ العميل نفسه (يعمل ضمن RLS الخاصّة به).
  // - استطلاعٌ احتياطيٌّ كل ١٢ ثانية يلتقط حجوزات الآخرين (RLS الخاصة بـ passengers
  //   تمنع البثّ التلقائي للعميل، لكن الدالة trip_seat_occupancy آمنةٌ ومسموحٌ بها).
  // - يتوقّف الاستطلاع تلقائيًّا عند إخفاء التبويب (visibilitychange) — توفيرٌ
  //   للطاقة وحصّة الـ API بلا أيّ خسارةٍ للتجربة (focus يستدعي refresh عند العودة).
  useEffect(() => {
    if (!trip?.id) return
    let cancelled = false
    const refresh = async () => {
      if (cancelled) return  // لا نُطلق طلبًا إن أُلغي قبل بدء التشغيل
      const args = multiBus && busId ? { p_trip: trip.id, p_bus: busId } : { p_trip: trip.id }
      const { data: occ } = await supabase.rpc('trip_seat_occupancy', args)
      if (!cancelled) setOccupancy(occ ?? [])
    }
    refresh()  // التقاط فوريٌّ عند تبديل الباص
    let ch = null
    function subscribe() {
      if (ch) { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
      ch = supabase
        .channel(`pax:${trip.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'passengers', filter: `trip_id=eq.${trip.id}` }, refresh)
        .subscribe()
    }
    subscribe()
    // استطلاعٌ ١٢ ثانيةً، يتوقّف عند إخفاء التبويب (يعود عند الـ focus).
    let poll = null
    const startPoll = () => { if (!poll && !cancelled) poll = setInterval(refresh, 12000) }
    const stopPoll  = () => { if (poll) { clearInterval(poll); poll = null } }
    startPoll()
    // الإيقاظُ المركزيُّ (lib/wake.js): إعادةُ ضمِّ القناة + تحديثٌ فوريٌّ + إعادةُ تشغيل الاستطلاع.
    const unsubscribeWake = onWake(() => {
      if (cancelled) return
      subscribe()
      refresh()
      startPoll()
    })
    const onVisHide = () => { if (document.visibilityState !== 'visible') stopPoll() }
    document.addEventListener('visibilitychange', onVisHide)
    return () => {
      cancelled = true
      stopPoll()
      unsubscribeWake()
      document.removeEventListener('visibilitychange', onVisHide)
      if (ch) { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
    }
  }, [trip?.id, busId, multiBus])

  // مصفوفة "ركّاب" للخريطة: إشغالٌ بلا أسماء، مع تمييز مقعدي الحالي كـ "لي"
  const seatPassengers = useMemo(() => {
    return (occupancy ?? []).map((o) => ({
      id: booking && String(o.seat_no) === String(booking.seat_no) ? booking.id : 'occ-' + o.seat_no,
      seat_no: o.seat_no, gender: o.gender, is_family: o.is_family,
    }))
  }, [occupancy, booking])

  const totalSeats = (layout.rows || 0) * 4 + (layout.back || 0)
  const isFull = totalSeats > 0 && occupancy.length >= totalSeats && !booking
  const [waitlistJoined, setWaitlistJoined] = useState(false)

  /** ادفع الآن — ينشئ جلسة دفعٍ مُستضافةً عبر Edge Function ويُحوّل العميل إلى البوّابة. */
  async function payNow() {
    if (payBusy || !booking?.id) return
    setPayBusy(true); setErr('')
    const { data, error } = await supabase.functions.invoke('create-payment', {
      body: { passenger_id: booking.id },
    })
    if (error || !data?.url) {
      setPayBusy(false)
      const code = data?.error || error?.message || ''
      const msg = code === 'no_price' ? 'لا يوجد سعرٌ مضبوطٌ لهذه الرحلة. تواصل مع الحملة.'
        : code === 'already_paid' ? 'هذا الحجز مدفوعٌ مسبقًا.'
        : code === 'not_authorized' ? 'لا تملك هذا الحجز.'
        : code === 'unauthenticated' ? 'انتهت جلستك. سجّل دخولك مجدّدًا.'
        : 'تعذّر فتح صفحة الدفع.'
      setErr(msg); return
    }
    window.location.href = data.url
  }

  async function joinWaitlist() {
    if (!user?.id || !trip?.id || !sub?.id) return
    const { error } = await supabase.from('waitlist').insert({
      profile_id: user.id, trip_id: trip.id, subscriber_id: sub.id,
      full_name: fullName.trim() || null, phone: phone.trim() || null,
    })
    if (error && error.code !== '23505') { setErr('تعذّر الانضمام: ' + error.message); return }
    setWaitlistJoined(true); setErr('')
  }

  const forPassenger = useMemo(() => ({ id: booking?.id, gender, is_family: isFamily }), [booking, gender, isFamily])

  async function confirm() {
    if (busy) return
    // قفل دورة الحياة: لا حجزَ جديدٌ في رحلةٍ مغلقةٍ/منتهيةٍ أو فات موعدها (القاعدة تحرس أيضًا).
    if (!booking?.id && !lc.bookable) { setErr(lc.reason); return }
    if (!fullName.trim()) { setErr('الاسم الرباعي مطلوب.'); return }
    if (nationalId.trim() && !isValidNationalId(nationalId)) { setErr('رقم الهوية/الإقامة غير صحيح (١٠ أرقام تبدأ بـ ١ أو ٢).'); return }
    if (phone.trim() && !isValidSaPhone(phone)) { setErr('رقم الجوال غير صحيح (مثال: 05XXXXXXXX).'); return }
    if (!seatNo) { setErr('اختر مقعدك من الخريطة.'); return }
    setErr(''); setBusy(true)
    const payload = {
      full_name: cleanName(fullName),
      national_id: toLatinDigits(nationalId).trim() || null,
      phone: normalizePhone(phone) || null,
      gender, is_family: isFamily,
      seat_no: seatNo,
      boarding_point: boardingPoint.trim() || trip?.boarding_point || null,
      payment_ref: paymentRef.trim() || null,
      // الحالة تبقى "مسجّل"؛ تأكيد الدفع يتمّ من الحملة بعد مراجعة المرجع.
      status: 'registered',
    }
    // عند تعدّد الباصات نُسند الباص المختار صراحةً (وإلّا يُسنده الحارس لباص ١)
    if (multiBus && busId) payload.bus_id = busId
    try {
      let result, row
      if (booking?.id) {
        result = await supabase.from('passengers').update(payload).eq('id', booking.id)
          .select('id, full_name, seat_no, status, ticket_code, boarded_at, boarding_point, national_id, phone, gender, is_family, payment_ref, payment_proof_url, bus_id').maybeSingle()
      } else {
        result = await supabase.from('passengers')
          .insert({ ...payload, trip_id: trip.id, subscriber_id: sub.id, profile_id: user.id })
          .select('id, full_name, seat_no, status, ticket_code, boarded_at, boarding_point, national_id, phone, gender, is_family, payment_ref, payment_proof_url, bus_id').maybeSingle()
      }
      if (result.error) {
        if (result.error.code === '23505') { setErr('عذرًا، هذا المقعد حُجز للتوّ — اختر مقعدًا آخر.'); await load(); return }
        throw result.error
      }
      row = result.data
      setBooking(row)
      onBooked?.()
      toast(booking?.id ? 'تم تحديث حجزك ✓' : 'تم تأكيد حجزك بنجاح ✓', { type: 'success' })
      setShowTicket(true)
    } catch (e) {
      setErr(translateRpcError(e, 'تعذّر إتمام الحجز.'))
    } finally {
      setBusy(false)
    }
  }

  if (showTicket && booking) {
    return (
      <Suspense fallback={<div className="manifest-overlay" style={{ display: 'grid', placeItems: 'center' }}><CompassMark size={64} /></div>}>
        <Ticket passenger={booking} trip={trip} sub={sub} buses={buses} onClose={onClose} />
      </Suspense>
    )
  }

  return (
    <div className="manifest-overlay">
      <div className="manifest-toolbar">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <Icon name="arrowRight" size={16} /> رجوع
        </button>
        <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 900, color: 'var(--cr-50)' }}>
          {booking ? 'تعديل حجزي' : 'حجز مقعد'}
        </div>
      </div>

      <div className="manifest-scroll" style={{ flexDirection: 'column', alignItems: 'center' }}>
        <div className="bus-editor">
          <section className="hero" style={{ marginTop: 0 }}>
            <span className="tag">{sub?.org_name || 'حملتي'}</span>
            <h2 style={{ fontSize: 22 }}>{trip?.title || 'رحلة عُمرة'}</h2>
            <p>{(trip?.route_from || '—') + ' ← ' + (trip?.route_to || '—')} · {fmt(trip?.depart_at)}</p>
          </section>

          {trip?.notes && trip.notes.trim() && (
            <div className="alert info" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 2 }}>
              <Icon name="bell" size={16} style={{ flex: 'none', marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>إرشادات الحملة</div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{trip.notes}</div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="empty"><div className="em-mark"><CompassMark size={48} /></div>جارٍ التحميل…</div>
          ) : (
            <>
              <div className="form" style={{ marginTop: 14 }}>
                <div className="sec-label">بياناتي</div>
                <div className="field">
                  <label>الاسم الرباعي <span className="req">*</span></label>
                  <input type="text" placeholder="الاسم كما في الهوية" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="grid-2">
                  <div className="field ltr">
                    <label>رقم الهوية / الإقامة</label>
                    <input type="text" inputMode="numeric" placeholder="1xxxxxxxxx" value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
                  </div>
                  <div className="field ltr">
                    <label>رقم الجوال</label>
                    <input type="tel" inputMode="tel" placeholder="05xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label>الجنس</label>
                    <select value={gender} onChange={(e) => setGender(e.target.value)}>
                      <option value="male">ذكر</option>
                      <option value="female">أنثى</option>
                    </select>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--cr-200)', alignSelf: 'flex-end', paddingBottom: 12 }}>
                    <input type="checkbox" checked={isFamily} onChange={(e) => setIsFamily(e.target.checked)} /> ضمن عائلة
                  </label>
                </div>
              </div>

              {isFull && (
                <div className="alert info" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon name="bell" size={16} />
                  <div style={{ flex: 1 }}>
                    <strong>الرحلة ممتلئة.</strong> انضمّ لقائمة الانتظار — سنُبلّغك فور تفريغ مقعد.
                  </div>
                  {waitlistJoined ? (
                    <span className="tag ok"><Icon name="check" size={14} /> أنت في القائمة</span>
                  ) : (
                    <button className="btn btn-gold btn-sm" onClick={joinWaitlist}>انضمام</button>
                  )}
                </div>
              )}

              {multiBus && (
                <>
                  <div className="sec-label" style={{ textAlign: 'center', marginTop: 8 }}>اختر الباص</div>
                  <div className="bus-tabs" style={{ justifyContent: 'center' }}>
                    {buses.map((b) => (
                      <button key={b.id} type="button" className={`bus-tab ${b.id === busId ? 'active' : ''}`}
                        onClick={() => { setBusId(b.id); setSeatNo('') }}>
                        <Icon name="bus" size={15} /> {busName(b)}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="sec-label" style={{ textAlign: 'center', marginTop: 8 }}>اختر مقعدك</div>
              <SeatMap
                policy={layout.policy} rows={layout.rows} back={layout.back}
                passengers={seatPassengers} selected={seatNo}
                onSelect={(no) => setSeatNo(no)} forPassenger={forPassenger}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: -4 }}>
                <span className="muted" style={{ fontSize: 13 }}>مقعدك:</span>
                <strong style={{ color: 'var(--gd-300)', fontFamily: 'var(--font-display)' }}>{seatNo || '— لم يُختر —'}</strong>
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <label>مكان الركوب</label>
                <input type="text"
                  placeholder={trip?.boarding_point || 'مثال: محطّة جازان المركزيّة'}
                  value={boardingPoint} onChange={(e) => setBoardingPoint(e.target.value)} />
              </div>

              {trip?.price != null && (
                <div className="alert info" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Icon name="payments" size={16} /> المبلغ المطلوب:
                  <strong>{Number(trip.price).toLocaleString('en-US')} ﷼</strong> للمقعد
                </div>
              )}

              {(booking?.id && trip?.price != null && booking?.status === 'registered') && (
                <div className="form" style={{ marginTop: 14 }}>
                  <div className="sec-label">الدفع</div>
                  <button type="button" className="btn btn-gold btn-block" onClick={payNow} disabled={payBusy}>
                    {payBusy ? <span className="spinner" /> : (<><Icon name="payments" size={16} /> ادفع الآن — تأكيدٌ آليّ</>)}
                  </button>
                  <p className="muted" style={{ fontSize: 12, marginTop: 6, textAlign: 'center' }}>
                    دفعٌ آمنٌ مباشرٌ عبر بوّابة الحملة. سيُؤكَّد حجزك تلقائيًّا بعد إتمام الدفع.
                  </p>
                </div>
              )}

              {sub?.store_url && (
                <div className="form" style={{ marginTop: 14 }}>
                  <div className="sec-label">{booking?.id && trip?.price != null ? 'أو ادفع عبر المتجر' : 'الدفع عبر المتجر'}</div>
                  <a className="btn btn-em btn-block" href={sub.store_url} target="_blank" rel="noopener noreferrer">
                    <Icon name="external" size={16} /> ادفع عبر متجر الحملة (زد/سلة)
                  </a>

                  {/* إثبات الدفع: لقطة إتمام الطلب (متاحٌ بعد تأكيد الحجز) */}
                  {booking?.id ? (
                    <div className="field" style={{ marginTop: 6 }}>
                      <label>أرفِق صورة إتمام الطلب <span className="muted" style={{ fontSize: 12 }}>(لقطة شاشة من المتجر)</span></label>
                      <input ref={proofRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={uploadProof} />
                      {booking.payment_proof_url ? (
                        <div className="img-upload preview" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ok-ink)', fontSize: 13, fontWeight: 700 }}>
                            <Icon name="check" size={15} /> تمّ إرفاق الإيصال — بانتظار تأكيد الحملة
                          </div>
                          <SignedImage bucket="payment-proofs" path={booking.payment_proof_url} maxHeight={200} />
                          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => proofRef.current?.click()} disabled={proofBusy}>
                            {proofBusy ? <span className="spinner" /> : <><Icon name="refresh" size={14} /> استبدال الصورة</>}
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="img-upload dropzone" onClick={() => proofRef.current?.click()} disabled={proofBusy}>
                          {proofBusy ? <span className="spinner" /> : <Icon name="download" size={22} style={{ transform: 'rotate(180deg)' }} />}
                          <strong>{proofBusy ? 'جارٍ رفع الإيصال…' : 'إرفاق صورة الدفع'}</strong>
                          <span className="muted" style={{ fontSize: 12 }}>PNG/JPG/WebP · يراها صاحب الحملة فقط</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="muted" style={{ fontSize: 12.5 }}>أكّد حجزك أوّلًا، ثمّ ادفع عبر المتجر وأرفِق صورة إتمام الطلب من تذكرتك في حسابك.</p>
                  )}

                  <div className="field">
                    <label>أو الصق رقم العملية <span className="muted" style={{ fontSize: 12 }}>(اختياري)</span></label>
                    <input type="text" placeholder="رقم عملية الدفع لإثباتٍ إضافيّ" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />
                  </div>
                  <p className="muted" style={{ fontSize: 12.5 }}>يراجع صاحب الحملة الإيصال ويؤكّد الدفع — يبقى حجزك «مسجّلًا» حتى التأكيد.</p>
                </div>
              )}

              {blockedNew && (
                <div className="alert warn" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="bell" size={16} /> {lc.reason}
                </div>
              )}

              {err && <div className="alert err" style={{ marginTop: 12 }}>{err}</div>}

              <button className="btn btn-gold btn-block" style={{ marginTop: 16 }} onClick={confirm} disabled={busy || blockedNew}>
                {busy ? <span className="spinner" /> : <><Icon name="check" size={17} /> {booking ? 'حفظ وعرض التذكرة' : 'تأكيد الحجز'}</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
