import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import SeatMap from './SeatMap'
import { SEATING_POLICIES, seatCount, buildSeats, isAllowed, DEFAULT_ROWS, DEFAULT_BACK } from '../lib/busLayout'
import { loadTripBuses, busName } from '../lib/buses'

/**
 * مدير باصات الرحلة — تخطيطٌ قابلٌ للضبط مع معاينةٍ حيّة، ودعمٌ لعدّة باصات.
 * الباص ١ يُحفظ في trips (المسار الحالي، يُزامَن إلى trip_buses عبر التريغر).
 * الباصات ٢+ تُحفظ مباشرةً في trip_buses. سعة الرحلة = مجموع الباصات.
 */
export default function BusEditor({ trip, passengers = [], onClose, onSaved }) {
  const [buses, setBuses] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [loading, setLoading] = useState(true)

  const [busLabel, setBusLabel] = useState('')
  const [busPlate, setBusPlate] = useState('')
  const [policy, setPolicy] = useState('all_male')
  const [rows, setRows] = useState(DEFAULT_ROWS)
  const [back, setBack] = useState(DEFAULT_BACK)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const fillFrom = useCallback((b) => {
    setBusLabel(b?.label ?? '')
    setBusPlate(b?.plate ?? '')
    setPolicy(b?.seating_policy ?? 'all_male')
    setRows(b?.bus_rows ?? DEFAULT_ROWS)
    setBack(b?.bus_back_row ?? DEFAULT_BACK)
    setActiveId(b?.id ?? null)
    setErr('')
  }, [])

  const load = useCallback(async (preferId) => {
    const list = await loadTripBuses(trip?.id)
    setBuses(list)
    const pick = (preferId && list.find((b) => b.id === preferId)) || list[0] || null
    fillFrom(pick)
    setLoading(false)
  }, [trip, fillFrom])

  useEffect(() => { load() }, [load])

  const active = buses.find((b) => b.id === activeId) || null
  const isPrimary = active?.bus_number === 1
  const multi = buses.length > 1

  // معتمرو هذا الباص فقط (للمعاينة والتحذيرات)
  const busPax = passengers.filter((p) => (multi ? p.bus_id === activeId : true))
  const total = seatCount(rows, back)
  const bookedBeyond = busPax.filter((p) => p.seat_no && Number(p.seat_no) > total).length

  const seatsByNo = new Map(buildSeats(rows, back).map((s) => [s.no, s]))
  const policyConflicts = busPax.filter((p) => {
    if (!p.seat_no) return false
    const seat = seatsByNo.get(Number(p.seat_no))
    if (!seat) return false
    return !isAllowed(seat, policy, p.gender, p.is_family)
  })

  // سعة الرحلة الكلّية = مجموع الباصات (مع تخطيط الباص النشِط الحالي)
  function tripCapacity() {
    return buses.reduce((s, b) => {
      if (b.id === activeId) return s + seatCount(rows, back)
      return s + seatCount(b.bus_rows ?? DEFAULT_ROWS, b.bus_back_row ?? DEFAULT_BACK)
    }, 0)
  }

  async function save() {
    if (busy || !trip?.id || !active) return
    if (bookedBeyond > 0) {
      setErr(`يوجد ${bookedBeyond} معتمرٍ على مقاعد أكبر من سعة التخطيط الجديد (${total}). عدّل مقاعدهم أوّلًا أو زِد الصفوف.`)
      return
    }
    setErr(''); setBusy(true)
    try {
      if (isPrimary) {
        // الباص ١: المسار الحالي (trips) — التريغر يُزامن trip_buses
        const { error } = await supabase.from('trips').update({
          bus_label: busLabel.trim() || null,
          bus_plate: busPlate.trim() || null,
          seating_policy: policy,
          bus_rows: rows,
          bus_back_row: back,
          capacity: tripCapacity(),
        }).eq('id', trip.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('trip_buses').update({
          label: busLabel.trim() || null,
          plate: busPlate.trim() || null,
          seating_policy: policy,
          bus_rows: rows,
          bus_back_row: back,
        }).eq('id', activeId)
        if (error) throw error
        // حدّث سعة الرحلة الكلّية (لا يمسّ الباص ١)
        await supabase.from('trips').update({ capacity: tripCapacity() }).eq('id', trip.id)
      }
      await load(activeId)
      onSaved?.()
    } catch (e) {
      setErr(e?.message ? 'تعذّر الحفظ: ' + e.message : 'تعذّر حفظ تخطيط الباص.')
    } finally {
      setBusy(false)
    }
  }

  async function addBus() {
    if (busy || !trip?.id) return
    setBusy(true); setErr('')
    try {
      const nextNum = buses.reduce((m, b) => Math.max(m, b.bus_number), 0) + 1
      const { data, error } = await supabase.from('trip_buses').insert({
        trip_id: trip.id, subscriber_id: trip.subscriber_id, bus_number: nextNum,
        bus_rows: DEFAULT_ROWS, bus_back_row: DEFAULT_BACK, seating_policy: 'all_male',
      }).select('id').maybeSingle()
      if (error) throw error
      await load(data?.id)
    } catch (e) {
      setErr(e?.message ? 'تعذّر إضافة الباص: ' + e.message : 'تعذّر إضافة الباص.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteActive() {
    if (busy || !active || isPrimary) return
    if (busPax.length > 0) { setErr('لا يمكن حذف باصٍ يحوي معتمرين. انقلهم أوّلًا.'); return }
    if (!window.confirm(`حذف «${busName(active)}»؟`)) return
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.from('trip_buses').delete().eq('id', activeId)
      if (error) throw error
      await supabase.from('trips').update({
        capacity: buses.filter((b) => b.id !== activeId)
          .reduce((s, b) => s + seatCount(b.bus_rows ?? DEFAULT_ROWS, b.bus_back_row ?? DEFAULT_BACK), 0),
      }).eq('id', trip.id)
      await load()
      onSaved?.()
    } catch (e) {
      setErr(e?.message ? 'تعذّر حذف الباص: ' + e.message : 'تعذّر حذف الباص.')
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
        <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 900, color: 'var(--cr-50)' }}>
          {multi ? 'إدارة الباصات' : 'تعديل الباص'}
        </div>
        <button className="btn btn-gold btn-sm" onClick={save} disabled={busy || loading}>
          {busy ? <span className="spinner" /> : <><Icon name="check" size={16} /> حفظ</>}
        </button>
      </div>

      <div className="manifest-scroll" style={{ flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div className="bus-editor">
          {/* شرائح الباصات + إضافة */}
          <div className="bus-tabs">
            {buses.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`bus-tab ${b.id === activeId ? 'active' : ''}`}
                onClick={() => fillFrom(b)}
                disabled={busy}
              >
                <Icon name="bus" size={15} /> {busName(b)}
              </button>
            ))}
            <button type="button" className="bus-tab add" onClick={addBus} disabled={busy}>
              <Icon name="plus" size={15} /> إضافة باص
            </button>
          </div>

          <div className="form" style={{ marginTop: 4 }}>
            <div className="grid-2">
              <div className="field">
                <label>رقم / اسم الباص</label>
                <input type="text" placeholder={active ? `باص ${active.bus_number}` : 'باص ١'} value={busLabel} onChange={(e) => setBusLabel(e.target.value)} />
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
              <Icon name="seat" size={16} /> مقاعد هذا الباص: <strong>{total}</strong>
              {multi && <span className="muted"> · إجمالي الرحلة: <strong>{tripCapacity()}</strong></span>}
            </div>

            {policyConflicts.length > 0 && (
              <div className="alert err">
                ⚠️ {policyConflicts.length} معتمرٍ على مقاعد تخالف السياسة الجديدة
                ({policyConflicts.map((p) => `${p.full_name} (${p.seat_no})`).join('، ')}).
                يُحفظ التغيير، لكن أعد توزيع مقاعدهم لاحقًا.
              </div>
            )}

            {err && <div className="alert err">{err}</div>}

            {active && !isPrimary && (
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={deleteActive} disabled={busy}>
                <Icon name="trash" size={15} /> حذف هذا الباص
              </button>
            )}
          </div>

          <div className="sec-label" style={{ textAlign: 'center', marginTop: 10 }}>
            معاينة حيّة{multi && active ? ` — ${busName(active)}` : ''}
          </div>
          <SeatMap policy={policy} rows={rows} back={back} passengers={busPax} readOnly />
        </div>
      </div>
    </div>
  )
}
