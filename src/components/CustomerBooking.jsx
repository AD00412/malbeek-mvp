import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../app/useAuth'
import Icon from './Icon'
import SeatMap from './SeatMap'
import CompassMark from './CompassMark'
import { toLatinDigits, normalizePhone, cleanName, isValidNationalId, isValidSaPhone } from '../lib/format'
import { loadTripBuses, busLayout, busName } from '../lib/buses'

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
  const [payBusy, setPayBusy] = useState(false)
  const [buses, setBuses] = useState([])
  const [busId, setBusId] = useState(null)

  const multiBus = buses.length > 1
  const activeBus = buses.find((b) => b.id === busId) || buses[0] || null
  const layout = multiBus && activeBus ? busLayout(activeBus)
    : { rows: trip?.bus_rows, back: trip?.bus_back_row, policy: trip?.seating_policy }

  async function load() {
    if (!trip?.id || !user?.id) return
    setLoading(true); setErr('')
    // حجز العميل الحالي لهذه الرحلة (إن وُجد)
    const { data: mine } = await supabase
      .from('passengers')
      .select('id, full_name, national_id, phone, gender, is_family, seat_no, status, ticket_code, boarded_at, boarding_point, payment_ref, bus_id')
      .eq('trip_id', trip.id).eq('profile_id', user.id).maybeSingle()
    // باصات الرحلة + تحديد الباص النشِط (باص الحجز الحالي أو الأوّل)
    const bs = await loadTripBuses(trip.id)
    setBuses(bs)
    const activeId = mine?.bus_id ?? bs[0]?.id ?? null
    setBusId(activeId)
    // إشغال المقاعد (بلا أسماء) — للباص المختار عند تعدّد الباصات
    const occArgs = bs.length > 1 && activeId ? { p_trip: trip.id, p_bus: activeId } : { p_trip: trip.id }
    const { data: occ } = await supabase.rpc('trip_seat_occupancy', occArgs)
    setOccupancy(occ ?? [])
    if (mine) {
      setBooking(mine)
      setFullName(mine.full_name ?? ''); setNationalId(mine.national_id ?? '')
      setPhone(mine.phone ?? ''); setGender(mine.gender ?? 'male')
      setIsFamily(!!mine.is_family); setSeatNo(mine.seat_no ?? '')
      setPaymentRef(mine.payment_ref ?? '')
    } else {
      setFullName(profile?.full_name ?? ''); setPhone(profile?.phone ?? '')
    }
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
  useEffect(() => {
    if (!trip?.id) return
    let cancelled = false
    const refresh = async () => {
      const args = multiBus && busId ? { p_trip: trip.id, p_bus: busId } : { p_trip: trip.id }
      const { data: occ } = await supabase.rpc('trip_seat_occupancy', args)
      if (!cancelled) setOccupancy(occ ?? [])
    }
    refresh()  // التقاط فوريٌّ عند تبديل الباص
    const ch = supabase
      .channel(`pax:${trip.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passengers', filter: `trip_id=eq.${trip.id}` }, refresh)
      .subscribe()
    const poll = setInterval(refresh, 12000)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearInterval(poll)
      window.removeEventListener('focus', onFocus)
      supabase.removeChannel(ch)
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
      boarding_point: trip?.boarding_point || null,
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
          .select('id, full_name, seat_no, status, ticket_code, boarded_at, boarding_point, national_id, phone, gender, is_family, payment_ref, bus_id').maybeSingle()
      } else {
        result = await supabase.from('passengers')
          .insert({ ...payload, trip_id: trip.id, subscriber_id: sub.id, profile_id: user.id })
          .select('id, full_name, seat_no, status, ticket_code, boarded_at, boarding_point, national_id, phone, gender, is_family, payment_ref, bus_id').maybeSingle()
      }
      if (result.error) {
        if (result.error.code === '23505') { setErr('عذرًا، هذا المقعد حُجز للتوّ — اختر مقعدًا آخر.'); await load(); return }
        throw result.error
      }
      row = result.data
      setBooking(row)
      onBooked?.()
      setShowTicket(true)
    } catch (e) {
      setErr(e?.message ? 'تعذّر الحجز: ' + e.message : 'تعذّر إتمام الحجز.')
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
                  <div className="sec-label">{booking?.id && trip?.price != null ? 'أو ادفع يدويًّا' : 'الدفع'}</div>
                  <a className="btn btn-em btn-block" href={sub.store_url} target="_blank" rel="noopener noreferrer">
                    <Icon name="external" size={16} /> ادفع عبر متجر الحملة
                  </a>
                  <div className="field">
                    <label>مرجع/رقم عملية الدفع (بعد الدفع)</label>
                    <input type="text" placeholder="الصق رقم العملية لإثبات الدفع" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />
                  </div>
                  <p className="muted" style={{ fontSize: 12.5 }}>يُراجع رقم العملية من الحملة ويُؤكَّد الدفع — يبقى حجزك «مسجّلًا» حتى التأكيد.</p>
                </div>
              )}

              {err && <div className="alert err" style={{ marginTop: 12 }}>{err}</div>}

              <button className="btn btn-gold btn-block" style={{ marginTop: 16 }} onClick={confirm} disabled={busy}>
                {busy ? <span className="spinner" /> : <><Icon name="check" size={17} /> {booking ? 'حفظ وعرض التذكرة' : 'تأكيد الحجز'}</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
