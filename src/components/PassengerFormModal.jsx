import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import Icon from './Icon'

export const PASSENGER_STATUS = [
  { v: 'registered', t: 'مسجّل' },
  { v: 'paid',       t: 'مدفوع' },
  { v: 'boarded',    t: 'صعد الحافلة' },
  { v: 'checked_in', t: 'استلم الغرفة' },
]

/**
 * نافذة إضافة/تعديل معتمر ضمن رحلةٍ معيّنة.
 * @param {object|null} passenger   سجلٌّ للتعديل أو null للإضافة
 * @param {string} tripId
 * @param {string} subscriberId
 */
export default function PassengerFormModal({ open, passenger, tripId, subscriberId, defaultBoarding, onClose, onSaved }) {
  const isEdit = Boolean(passenger?.id)
  const [fullName, setFullName] = useState(passenger?.full_name ?? '')
  const [nationalId, setNationalId] = useState(passenger?.national_id ?? '')
  const [phone, setPhone] = useState(passenger?.phone ?? '')
  const [nationality, setNationality] = useState(passenger?.nationality ?? 'سعودي')
  const [seatNo, setSeatNo] = useState(passenger?.seat_no ?? '')
  const [boarding, setBoarding] = useState(passenger?.boarding_point ?? defaultBoarding ?? '')
  const [status, setStatus] = useState(passenger?.status ?? 'registered')
  const [notes, setNotes] = useState(passenger?.notes ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy) return
    if (!fullName.trim()) { setErr('الاسم الرباعي مطلوب.'); return }
    setErr(''); setBusy(true)

    const payload = {
      full_name: fullName.trim(),
      national_id: nationalId.trim() || null,
      phone: phone.trim() || null,
      nationality: nationality.trim() || null,
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
      if (result.error) throw result.error
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
            <label>الجنسية</label>
            <input type="text" placeholder="سعودي" value={nationality} onChange={(e) => setNationality(e.target.value)} />
          </div>
          <div className="field">
            <label>رقم المقعد</label>
            <input type="text" inputMode="numeric" placeholder="مثال: 12" value={seatNo} onChange={(e) => setSeatNo(e.target.value)} />
          </div>
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
