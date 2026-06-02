import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import SeatMap from './SeatMap'
import { SEATING_POLICIES, seatCount, DEFAULT_ROWS, DEFAULT_BACK } from '../lib/busLayout'

/**
 * صفحة تعديل الباص المخصّصة — تخطيطٌ قابلٌ للضبط مع معاينةٍ حيّة.
 * تحفظ في جدول trips (bus_label, bus_plate, seating_policy, bus_rows,
 * bus_back_row, capacity).
 *
 * @param {object} trip
 * @param {Array}  passengers  لعرضها في المعاينة
 * @param {Function} onClose
 * @param {Function} onSaved
 */
export default function BusEditor({ trip, passengers = [], onClose, onSaved }) {
  const [busLabel, setBusLabel] = useState(trip?.bus_label ?? '')
  const [busPlate, setBusPlate] = useState(trip?.bus_plate ?? '')
  const [policy, setPolicy] = useState(trip?.seating_policy ?? 'all_male')
  const [rows, setRows] = useState(trip?.bus_rows ?? DEFAULT_ROWS)
  const [back, setBack] = useState(trip?.bus_back_row ?? DEFAULT_BACK)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const total = seatCount(rows, back)
  const bookedBeyond = passengers.filter((p) => p.seat_no && Number(p.seat_no) > total).length

  async function save() {
    if (busy || !trip?.id) return
    if (bookedBeyond > 0) {
      setErr(`يوجد ${bookedBeyond} معتمرٍ على مقاعد أكبر من سعة التخطيط الجديد (${total}). عدّل مقاعدهم أوّلًا أو زِد الصفوف.`)
      return
    }
    setErr(''); setBusy(true)
    try {
      const { error } = await supabase.from('trips').update({
        bus_label: busLabel.trim() || null,
        bus_plate: busPlate.trim() || null,
        seating_policy: policy,
        bus_rows: rows,
        bus_back_row: back,
        capacity: total,
      }).eq('id', trip.id)
      if (error) throw error
      onSaved?.()
    } catch (e) {
      setErr(e?.message ? 'تعذّر الحفظ: ' + e.message : 'تعذّر حفظ تخطيط الباص.')
    } finally {
      setBusy(false)
    }
  }

  function step(setter, val, min, max, delta) {
    const n = Math.max(min, Math.min(max, (val | 0) + delta))
    setter(n)
  }

  return (
    <div className="manifest-overlay">
      <div className="manifest-toolbar no-print">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <Icon name="arrowRight" size={16} /> رجوع
        </button>
        <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 900, color: 'var(--cr-50)' }}>تعديل الباص</div>
        <button className="btn btn-gold btn-sm" onClick={save} disabled={busy}>
          {busy ? <span className="spinner" /> : <><Icon name="check" size={16} /> حفظ</>}
        </button>
      </div>

      <div className="manifest-scroll" style={{ flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div className="bus-editor">
          <div className="form" style={{ marginTop: 0 }}>
            <div className="grid-2">
              <div className="field">
                <label>رقم / اسم الباص</label>
                <input type="text" placeholder="باص ١" value={busLabel} onChange={(e) => setBusLabel(e.target.value)} />
              </div>
              <div className="field ltr">
                <label>لوحة الباص</label>
                <input type="text" placeholder="أ ب ج 1234" value={busPlate} onChange={(e) => setBusPlate(e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label>سياسة المقاعد</label>
              <select value={policy} onChange={(e) => setPolicy(e.target.value)}>
                {SEATING_POLICIES.map((p) => <option key={p.v} value={p.v}>{p.t}</option>)}
              </select>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>صفوف المقاعد (٤ لكل صف)</label>
                <div className="stepper">
                  <button type="button" onClick={() => step(setRows, rows, 1, 20, -1)}>−</button>
                  <span>{rows}</span>
                  <button type="button" onClick={() => step(setRows, rows, 1, 20, +1)}>+</button>
                </div>
              </div>
              <div className="field">
                <label>مقاعد الصفّ الخلفي</label>
                <div className="stepper">
                  <button type="button" onClick={() => step(setBack, back, 0, 6, -1)}>−</button>
                  <span>{back}</span>
                  <button type="button" onClick={() => step(setBack, back, 0, 6, +1)}>+</button>
                </div>
              </div>
            </div>

            <div className="alert info" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="seat" size={16} /> إجمالي المقاعد: <strong>{total}</strong> مقعدًا (عدا السائق والمساعد)
            </div>

            {err && <div className="alert err">{err}</div>}
          </div>

          <div className="sec-label" style={{ textAlign: 'center', marginTop: 10 }}>معاينة حيّة</div>
          <SeatMap policy={policy} rows={rows} back={back} passengers={passengers} readOnly />
        </div>
      </div>
    </div>
  )
}
