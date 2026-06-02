import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import SeatMap from './SeatMap'
import { toLatinDigits, normalizePhone, cleanName, isValidNationalId, isValidSaPhone } from '../lib/format'
import { busLayout, busName } from '../lib/buses'

export const PASSENGER_STATUS = [
  { v: 'registered', t: 'مسجّل' },
  { v: 'paid',       t: 'مدفوع' },
  { v: 'boarded',    t: 'صعد الحافلة' },
  { v: 'checked_in', t: 'استلم الغرفة' },
]

const GENDERS = [
  { v: 'male',   t: 'ذكر' },
  { v: 'female', t: 'أنثى' },
]

/**
 * نافذة إضافة/تعديل معتمر ضمن رحلةٍ معيّنة — تتضمّن مخطّط الباص لاختيار المقعد.
 * @param {object|null} passenger
 * @param {string}      tripId
 * @param {string}      subscriberId
 * @param {string}      seatingPolicy   سياسة المقاعد للرحلة
 * @param {Array}       passengers      المعتمرون الحاليّون لإظهار المحجوز
 */
export default function PassengerFormModal({ open, passenger, tripId, subscriberId, seatingPolicy, busRows, busBack, buses = [], passengers = [], defaultBoarding, onClose, onSaved }) {
  const isEdit = Boolean(passenger?.id)
  const multiBus = buses.length > 1
  // الباص النشِط: باص الراكب الحالي إن وُجد، وإلّا الأوّل
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

  const forPassenger = useMemo(() => ({
    id: passenger?.id, gender, is_family: isFamily,
  }), [passenger, gender, isFamily])

  // تحقّقٌ حيّ — الهوية/الجوال اختياريّان للمعتمر، فيُتحقّق منهما فقط عند الإدخال (يطابق القاعدة)
  const idErr = nationalId.trim() && !isValidNationalId(nationalId) ? '١٠ أرقام تبدأ بـ ١ أو ٢.' : ''
  const phErr = phone.trim() && !isValidSaPhone(phone) ? 'مثال: 05XXXXXXXX.' : ''

  async function save() {
    if (busy) return
    if (!fullName.trim()) { setErr('الاسم الرباعي مطلوب.'); return }
    if (idErr || phErr) { setErr('صحّح رقم الهوية/الجوال المظلّل.'); return }
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
    // عند تعدّد الباصات نُسند الباص المختار صراحةً (وإلّا يُسنده الحارس لباص ١)
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
          if (m.includes('seat')) { setErr('هذا المقعد محجوزٌ لمعتمرٍ آخر — اختر مقعدًا مختلفًا.'); return }
          if (m.includes('ticket')) { setErr('تعارضٌ في رمز التذكرة — حاول الحفظ مرّةً ثانية.'); return }
          setErr('قيمةٌ مكرّرةٌ تتعارض مع قيدٍ في القاعدة — حاول مرّةً ثانية.')
          return
        }
        throw result.error
      }
      onSaved?.()
    } catch (e) {
      setErr(e?.message ? 'تعذّر الحفظ: ' + e.message : 'تعذّر حفظ المعتمر.')
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
          ضمن عائلة (يُتاح له اختيار مقاعد العوائل)
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
          <strong style={{ color: 'var(--gd-300)', fontFamily: 'var(--font-display)' }}>{seatNo || '— لم يُختر بعد —'}</strong>
          {seatNo && <button type="button" className="icon-btn" onClick={() => setSeatNo('')}>إلغاء الاختيار</button>}
        </div>

        <div className="grid-2">
          <div className="field">
            <label>مكان الركوب</label>
            <input type="text" placeholder="مثال: محطة جازان" value={boarding} onChange={(e) => setBoarding(e.target.value)} />
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
          <textarea placeholder="أي ملاحظةٍ على المعتمر…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {err && <div className="alert err">{err}</div>}
      </div>
    </BottomSheet>
  )
}
