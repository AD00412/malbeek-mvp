import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import { SEATING_POLICIES } from '../lib/busLayout'
import { translateRpcError } from '../lib/rpcErrors'
import { useUI } from '../lib/useUI'

const STATUS_OPTIONS = [
  { v: 'draft', t: 'مسودة' },
  { v: 'open', t: 'مفتوحة' },
  { v: 'closed', t: 'مغلقة' },
  { v: 'done', t: 'منتهية' },
]

// ISO ← → قيمة input[type=datetime-local] بالتوقيت المحلي
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * نافذة إنشاء/تعديل رحلة
 * @param {object|null} trip          رحلة للتعديل، أو null للإنشاء
 * @param {string}      subscriberId  معرّف الحملة (يُستخدم عند الإدراج)
 * @param {Function}    onClose
 * @param {Function}    onSaved
 */
export default function TripFormModal({ trip, subscriberId, onClose, onSaved }) {
  const isEdit = Boolean(trip?.id)

  const [title, setTitle] = useState(trip?.title ?? '')
  const [routeFrom, setRouteFrom] = useState(trip?.route_from ?? 'جازان')
  const [routeTo, setRouteTo] = useState(trip?.route_to ?? 'مكة المكرمة')
  const [depart, setDepart] = useState(isoToLocalInput(trip?.depart_at))
  const [ret, setRet] = useState(isoToLocalInput(trip?.return_at))
  const [capacity, setCapacity] = useState(
    trip?.capacity === 0 || trip?.capacity ? String(trip.capacity) : ''
  )
  const [price, setPrice] = useState(trip?.price != null ? String(trip.price) : '')
  const [busLabel, setBusLabel] = useState(trip?.bus_label ?? '')
  const [boardingPoint, setBoardingPoint] = useState(trip?.boarding_point ?? '')
  const [status, setStatus] = useState(trip?.status ?? 'open')
  const [seatingPolicy, setSeatingPolicy] = useState(trip?.seating_policy ?? 'all_male')
  const [notes, setNotes] = useState(trip?.notes ?? '')

  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useUI()

  // تحقّقٌ حيّ: العودة بعد الذهاب (يطابق تريغر validate_trip في القاعدة)
  const dateErr = depart && ret && new Date(ret) < new Date(depart) ? 'تاريخ العودة يجب أن يكون بعد تاريخ الذهاب.' : ''

  async function save() {
    if (busy) return
    if (!title.trim()) { setErr('عنوان الرحلة مطلوب.'); return }
    if (!depart) { setErr('تاريخ ووقت الذهاب مطلوب.'); return }
    if (dateErr) { setErr(dateErr); return }
    setErr(''); setBusy(true)

    const payload = {
      title: title.trim(),
      route_from: routeFrom.trim() || null,
      route_to: routeTo.trim() || null,
      depart_at: new Date(depart).toISOString(),
      return_at: ret ? new Date(ret).toISOString() : null,
      capacity: capacity === '' ? 0 : Math.max(0, parseInt(capacity, 10) || 0),
      price: price === '' ? null : Math.max(0, parseFloat(price) || 0),
      bus_label: busLabel.trim() || null,
      boarding_point: boardingPoint.trim() || null,
      status,
      seating_policy: seatingPolicy,
      notes: notes.trim() || null,
    }

    try {
      let result
      if (isEdit) {
        result = await supabase.from('trips').update(payload).eq('id', trip.id)
      } else {
        result = await supabase.from('trips').insert({ ...payload, subscriber_id: subscriberId })
      }
      if (result.error) throw result.error
      toast(isEdit ? 'تم حفظ تعديلات الرحلة ✓' : 'تم إنشاء الرحلة ✓', { type: 'success' })
      onSaved?.()
    } catch (e) {
      setErr(translateRpcError(e, 'تعذّر حفظ الرحلة. حاول مرة أخرى.'))
    } finally {
      setBusy(false)
    }
  }

  function tryClose() { if (!busy) onClose?.() }

  return (
    <BottomSheet
      open
      title={isEdit ? 'تعديل الرحلة' : 'رحلة جديدة'}
      onClose={tryClose}
      actions={
        <>
          <button className="btn btn-ghost" onClick={tryClose} disabled={busy}>إلغاء</button>
          <button className="btn btn-gold" onClick={save} disabled={busy || Boolean(dateErr)}>
            {busy ? <span className="spinner" /> : (isEdit ? 'حفظ التعديلات' : 'إنشاء الرحلة')}
          </button>
        </>
      }
    >
        <div className="form" style={{ marginTop: 0 }}>
          <div className="field">
            <label>عنوان الرحلة *</label>
            <input type="text" placeholder="مثال: عُمرة رمضان — الفوج الأول" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="grid-2">
            <div className="field">
              <label>من</label>
              <input type="text" placeholder="جازان" value={routeFrom} onChange={(e) => setRouteFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>إلى</label>
              <input type="text" placeholder="مكة المكرمة" value={routeTo} onChange={(e) => setRouteTo(e.target.value)} />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>تاريخ ووقت الذهاب *</label>
              <input type="datetime-local" value={depart} onChange={(e) => setDepart(e.target.value)} />
            </div>
            <div className={`field ${dateErr ? 'invalid' : ''}`}>
              <label>تاريخ العودة (اختياري)</label>
              <input type="datetime-local" value={ret} onChange={(e) => setRet(e.target.value)} />
              {dateErr && <span className="hint">{dateErr}</span>}
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>السعة (عدد المقاعد)</label>
              <input type="number" min="0" inputMode="numeric" placeholder="0" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </div>
            <div className="field">
              <label>سعر المقعد (﷼ — اختياري)</label>
              <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="مثال: 1500" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>الحالة</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
              </select>
            </div>
            <div className="field">
              <label>اسم/رقم الباص (اختياري)</label>
              <input type="text" placeholder="باص ١ — حافلة VIP" value={busLabel} onChange={(e) => setBusLabel(e.target.value)} />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>نقطة الانطلاق (اختياري)</label>
              <input type="text" placeholder="محطة جازان المركزية" value={boardingPoint} onChange={(e) => setBoardingPoint(e.target.value)} />
            </div>
            <div className="field">
              <label>سياسة المقاعد</label>
              <select value={seatingPolicy} onChange={(e) => setSeatingPolicy(e.target.value)}>
                {SEATING_POLICIES.map((p) => <option key={p.v} value={p.v}>{p.t}</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <label>ملاحظات (اختياري)</label>
            <textarea placeholder="أي تفاصيل إضافية عن الرحلة…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {err && <div className="alert err">{err}</div>}
        </div>
    </BottomSheet>
  )
}
