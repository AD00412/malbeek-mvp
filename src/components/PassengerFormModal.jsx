import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import SeatMap from './SeatMap'
import RatingStars from './RatingStars'
import { toLatinDigits, normalizePhone, cleanName, isValidNationalId, isValidSaPhone } from '../lib/format'
import { busLayout, busName } from '../lib/buses'
import { translateRpcError } from '../lib/rpcErrors'
import { useUI } from '../lib/useUI'
import { PASSENGER_STATUS } from '../lib/passengerStatus'

const GENDERS = [
  { v: 'male',   t: 'ذكر' },
  { v: 'female', t: 'أنثى' },
]

/**
 * نافذة إضافة/تعديل معتمر ضمن رحلة معينة — تتضمن مخطط الباص لاختيار المقعد.
 * @param {object|null} passenger
 * @param {string}      tripId
 * @param {string}      subscriberId
 * @param {string}      seatingPolicy   سياسة المقاعد للرحلة
 * @param {Array}       passengers      المعتمرون الحاليون لإظهار المحجوز
 */
export default function PassengerFormModal({ open, passenger, tripId, subscriberId, seatingPolicy, busRows, busBack, buses = [], passengers = [], defaultBoarding, onClose, onSaved }) {
  const isEdit = Boolean(passenger?.id)
  const multiBus = buses.length > 1
  // الباص النشط: باص الراكب الحالي إن وجد، وإلا الأول
  const [busId, setBusId] = useState(passenger?.bus_id ?? (buses[0]?.id ?? null))
  const activeBus = buses.find((b) => b.id === busId) || buses[0] || null
  const layout = multiBus && activeBus ? busLayout(activeBus)
    : { rows: busRows, back: busBack, policy: seatingPolicy || 'all_male' }
  const [fullName, setFullName] = useState(passenger?.full_name ?? '')
  const [nationalId, setNationalId] = useState(passenger?.national_id ?? '')
  const [phone, setPhone] = useState(passenger?.phone ?? '')
  const [nationality, setNationality] = useState(passenger?.nationality ?? 'سعودي')
  const [gender, setGender] = useState(passenger?.gender ?? 'male')
  const [isFamily, setIsFamily] = useState(Boolean(passenger?.is_family))
  const [seatNo, setSeatNo] = useState(passenger?.seat_no ?? '')
  const [boarding, setBoarding] = useState(passenger?.boarding_point ?? defaultBoarding ?? '')
  const [status, setStatus] = useState(passenger?.status ?? 'registered')
  const [notes, setNotes] = useState(passenger?.notes ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useUI()

  // ── تقييم المعتمر (مشترك → معتمر) — للحجوزات الذاتية فقط (لها حساب) ──
  const ratable = isEdit && Boolean(passenger?.profile_id) && Boolean(tripId)
  const [rStars, setRStars] = useState(0)
  const [rComment, setRComment] = useState('')
  const [rId, setRId] = useState(null)
  const [rBusy, setRBusy] = useState(false)
  useEffect(() => {
    if (!ratable) return
    let cancel = false
    ;(async () => {
      const { data } = await supabase.from('ratings')
        .select('id, stars, comment')
        .eq('trip_id', tripId).eq('profile_id', passenger.profile_id)
        .eq('direction', 'subscriber_to_customer').maybeSingle()
      if (cancel || !data) return
      setRId(data.id); setRStars(data.stars || 0); setRComment(data.comment || '')
    })()
    return () => { cancel = true }
  }, [ratable, tripId, passenger?.profile_id])

  async function saveRating() {
    if (rBusy || !rStars) { if (!rStars) toast('اختر عدد النجوم أولا.', { type: 'error' }); return }
    setRBusy(true)
    const payload = {
      subscriber_id: subscriberId, trip_id: tripId, profile_id: passenger.profile_id,
      passenger_id: passenger.id, direction: 'subscriber_to_customer',
      stars: rStars, comment: rComment.trim() || null,
    }
    try {
      let res
      if (rId) res = await supabase.from('ratings').update({ stars: payload.stars, comment: payload.comment }).eq('id', rId)
      else     res = await supabase.from('ratings').insert(payload)
      if (res.error) {
        if (res.error.code === '23505') {
          const { data: ex } = await supabase.from('ratings').select('id')
            .eq('trip_id', tripId).eq('profile_id', passenger.profile_id).eq('direction', 'subscriber_to_customer').maybeSingle()
          if (ex?.id) { await supabase.from('ratings').update({ stars: payload.stars, comment: payload.comment }).eq('id', ex.id); setRId(ex.id) }
        } else throw res.error
      }
      toast('حفظ تقييم المعتمر ✓', { type: 'success' })
    } catch (e) {
      toast(translateRpcError(e, 'تعذر حفظ التقييم.'), { type: 'error' })
    } finally { setRBusy(false) }
  }

  const forPassenger = useMemo(() => ({
    id: passenger?.id, gender, is_family: isFamily,
  }), [passenger, gender, isFamily])

  // تحقق حي — الهوية/الجوال اختياريان للمعتمر، فيتحقق منهما فقط عند الإدخال (يطابق القاعدة)
  const idErr = nationalId.trim() && !isValidNationalId(nationalId) ? '١٠ أرقام تبدأ بـ ١ أو ٢.' : ''
  const phErr = phone.trim() && !isValidSaPhone(phone) ? 'مثال: 05XXXXXXXX.' : ''

  async function save() {
    if (busy) return
    if (!fullName.trim()) { setErr('الاسم الرباعي مطلوب.'); return }
    if (idErr || phErr) { setErr('صحح رقم الهوية/الجوال المظلل.'); return }
    setErr(''); setBusy(true)

    const cleanPhone = normalizePhone(phone)
    const payload = {
      full_name: cleanName(fullName),
      national_id: toLatinDigits(nationalId).trim() || null,
      phone: cleanPhone || null,
      nationality: nationality.trim() || null,
      gender,
      is_family: isFamily,
      seat_no: seatNo.trim() || null,
      boarding_point: boarding.trim() || null,
      status,
      notes: notes.trim() || null,
    }
    // عند تعدد الباصات نسند الباص المختار صراحة (وإلا يسنده الحارس لباص ١)
    if (multiBus && busId) payload.bus_id = busId
    try {
      let result
      if (isEdit) {
        result = await supabase.from('passengers').update(payload).eq('id', passenger.id)
      } else {
        result = await supabase.from('passengers').insert({ ...payload, trip_id: tripId, subscriber_id: subscriberId })
      }
      if (result.error) {
        if (result.error.code === '23505') {
          const m = String(result.error.message || '')
          if (m.includes('seat')) { setErr('هذا المقعد محجوز لمعتمر آخر — اختر مقعدا مختلفا.'); return }
          if (m.includes('ticket')) { setErr('تعارض في رمز التذكرة — حاول الحفظ مرة ثانية.'); return }
          setErr('قيمة مكررة تتعارض مع قيد في القاعدة — حاول مرة ثانية.')
          return
        }
        throw result.error
      }
      onSaved?.()
    } catch (e) {
      setErr(translateRpcError(e, 'تعذر حفظ المعتمر.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title={isEdit ? 'تعديل بيانات المعتمر' : 'إضافة معتمر'}
      actions={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
          <button className="btn btn-gold" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : <><Icon name="check" size={16} /> {isEdit ? 'حفظ' : 'إضافة'}</>}
          </button>
        </>
      }
    >
      <div className="form" style={{ marginTop: 0 }}>
        {err && <div className="alert err" style={{ marginBottom: 10 }}>{err}</div>}
        <div className="field with-ic">
          <label>الاسم الرباعي <span className="req">*</span></label>
          <span className="f-ic"><Icon name="user" size={17} /></span>
          <input type="text" placeholder="الاسم كما في الهوية" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="grid-2">
          <div className={`field with-ic ltr ${idErr ? 'invalid' : ''}`}>
            <label>رقم الهوية / الإقامة</label>
            <span className="f-ic"><Icon name="badge" size={17} /></span>
            <input type="text" inputMode="numeric" placeholder="1xxxxxxxxx" value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
            {idErr && <span className="hint">{idErr}</span>}
          </div>
          <div className={`field with-ic ltr ${phErr ? 'invalid' : ''}`}>
            <label>رقم الجوال</label>
            <span className="f-ic"><Icon name="phone" size={17} /></span>
            <input type="tel" inputMode="tel" placeholder="05xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {phErr && <span className="hint">{phErr}</span>}
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>الجنس</label>
            <select value={gender} onChange={(e) => setGender(e.target.value)}>
              {GENDERS.map((g) => <option key={g.v} value={g.v}>{g.t}</option>)}
            </select>
          </div>
          <div className="field">
            <label>الجنسية</label>
            <input type="text" placeholder="سعودي" value={nationality} onChange={(e) => setNationality(e.target.value)} />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--cr-200)', cursor: 'pointer' }}>
          <input type="checkbox" checked={isFamily} onChange={(e) => setIsFamily(e.target.checked)} />
          ضمن عائلة (يتاح له اختيار مقاعد العوائل)
        </label>

        {multiBus && (
          <>
            <div className="sec-label">الباص</div>
            <div className="bus-tabs">
              {buses.map((b) => (
                <button key={b.id} type="button" className={`bus-tab ${b.id === busId ? 'active' : ''}`}
                  onClick={() => { setBusId(b.id); setSeatNo('') }}>
                  <Icon name="bus" size={15} /> {busName(b)}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="sec-label">اختر المقعد</div>
        <SeatMap
          policy={layout.policy}
          rows={layout.rows}
          back={layout.back}
          passengers={multiBus ? passengers.filter((p) => p.bus_id === busId) : passengers}
          selected={seatNo}
          onSelect={(no) => setSeatNo(no)}
          forPassenger={forPassenger}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -4 }}>
          <span className="muted" style={{ fontSize: 13 }}>المقعد المختار:</span>
          <strong style={{ color: 'var(--gd-300)', fontFamily: 'var(--font-display)' }}>{seatNo || '— لم يختر بعد —'}</strong>
          {seatNo && <button type="button" className="icon-btn" onClick={() => setSeatNo('')}>إلغاء الاختيار</button>}
        </div>

        <div className="grid-2">
          <div className="field">
            <label>مكان الركوب</label>
            <input type="text" placeholder="مثال: المحطة المركزية" value={boarding} onChange={(e) => setBoarding(e.target.value)} />
          </div>
          <div className="field">
            <label>الحالة</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {PASSENGER_STATUS.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label>ملاحظات (اختياري)</label>
          <textarea placeholder="أي ملاحظة على المعتمر…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {ratable && (
          <div className="rating-box">
            <div className="sec-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="sparkle" size={15} /> تقييم المعتمر
              <span className="tag muted" style={{ fontSize: 9, padding: '1px 6px' }}>خاص بحملتك</span>
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>
              قيم التزامه وتعامله في هذه الرحلة. لا يراه المعتمر — يساعدك في حجوزاته القادمة.
            </p>
            <div className="rating-pick">
              <RatingStars value={rStars} onChange={setRStars} size={32} />
              <span className="rating-pick-label">{rStars ? `${rStars} من ٥` : 'لم يقيم بعد'}</span>
            </div>
            <div className="field">
              <textarea placeholder="ملاحظة داخلية على المعتمر… (اختياري)" value={rComment}
                        maxLength={1000} onChange={(e) => setRComment(e.target.value)} />
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={saveRating} disabled={rBusy}>
              {rBusy ? <span className="spinner" /> : <><Icon name="check" size={14} /> {rId ? 'تحديث التقييم' : 'حفظ التقييم'}</>}
            </button>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
