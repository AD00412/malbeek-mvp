import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import SeatMap from './SeatMap'

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
export default function PassengerFormModal({ open, passenger, tripId, subscriberId, seatingPolicy, passengers = [], defaultBoarding, onClose, onSaved }) {
  const isEdit = Boolean(passenger?.id)
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

  async function save() {
    if (busy) return
    if (!fullName.trim()) { setErr('الاسم الرباعي مطلوب.'); return }
    setErr(''); setBusy(true)

    const payload = {
      full_name: fullName.trim(),
      national_id: nationalId.trim() || null,
      phone: phone.trim() || null,
      nationality: nationality.trim() || null,
      gender,
      is_family: isFamily,
      seat_no: seatNo.trim() || null,
      boarding_point: boarding.trim() || null,
      status,
      notes: notes.trim() || null,
    }
    try {
      let result
      if (isEdit) {
        result = await supabase.from('passengers').update(payload).eq('id', passenger.id)
      } else {
        result = await supabase.from('passengers').insert({ ...payload, trip_id: tripId, subscriber_id: subscriberId })
      }
      if (result.error) {
        if (result.error.code === '23505') { setErr('هذا المقعد محجوزٌ لمعتمرٍ آخر — اختر مقعدًا مختلفًا.'); return }
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

        <div className="sec-label">اختر المقعد</div>
        <SeatMap
          policy={seatingPolicy || 'all_male'}
          passengers={passengers}
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
