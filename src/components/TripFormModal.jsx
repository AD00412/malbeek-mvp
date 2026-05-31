import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

/* ============================================================
   نافذة إنشاء/تعديل رحلة — RTL، هوية ملبّيك
   الاستخدام:
     <TripFormModal
        open={bool}
        trip={null | tripObject}   // null = إنشاء جديد
        subscriberId={uuid}        // مطلوب للإنشاء فقط
        onClose={() => ...}
        onSaved={() => ...}        // يُستدعى بعد نجاح الحفظ
     />
   ============================================================ */

// قائمة حالات الرحلة (مطابِقة لـ enum trip_status في القاعدة)
const STATUS_OPTIONS = [
  { value: 'draft',  label: 'مسودة'   },
  { value: 'open',   label: 'مفتوحة'  },
  { value: 'closed', label: 'مغلقة'   },
  { value: 'done',   label: 'منتهية' },
]

// الحالة الابتدائية للنموذج (افتراضيات ودودة)
const EMPTY = {
  title: '',
  route_from: 'جازان',
  route_to: 'مكة المكرمة',
  depart_at: '',
  return_at: '',
  capacity: '',
  bus_label: '',
  boarding_point: '',
  status: 'open',
  notes: '',
}

// 'YYYY-MM-DDTHH:mm' (وقت محلي) ← ISO UTC
function localInputToIso(v) {
  if (!v) return null
  const d = new Date(v) // المتصفّح يفسّر القيمة كوقتٍ محلّي
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// ISO ← 'YYYY-MM-DDTHH:mm' لعرضها في حقل datetime-local
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const tz = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tz).toISOString().slice(0, 16)
}

// تحويل رحلةٍ من القاعدة إلى قيمٍ صالحة لحقول النموذج
function tripToForm(t) {
  if (!t) return { ...EMPTY }
  return {
    title:          t.title ?? '',
    route_from:     t.route_from ?? '',
    route_to:       t.route_to ?? '',
    depart_at:      isoToLocalInput(t.depart_at),
    return_at:      isoToLocalInput(t.return_at),
    capacity:       (t.capacity ?? '') === null ? '' : String(t.capacity ?? ''),
    bus_label:      t.bus_label ?? '',
    boarding_point: t.boarding_point ?? '',
    status:         t.status ?? 'open',
    notes:          t.notes ?? '',
  }
}

export default function TripFormModal({ open, trip, subscriberId, onClose, onSaved }) {
  const isEdit = Boolean(trip?.id)
  const [form, setForm]   = useState(EMPTY)
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState('')

  // إعادة تعبئة النموذج كلّما فُتحت النافذة أو تغيّرت الرحلة المعدَّلة
  useEffect(() => {
    if (!open) return
    setForm(tripToForm(trip))
    setErr('')
    setBusy(false)
  }, [open, trip])

  // إغلاق بـ Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  const set = useCallback((k, v) => setForm((f) => ({ ...f, [k]: v })), [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setErr('')

    // تحقّق من الحقول المطلوبة
    const title = form.title.trim()
    const departIso = localInputToIso(form.depart_at)
    if (!title) { setErr('عنوان الرحلة مطلوب.'); return }
    if (!departIso) { setErr('تاريخ ووقت الذهاب مطلوبان.'); return }
    if (!isEdit && !subscriberId) { setErr('لم يتم التعرّف على حملتك بعد. حدّث الصفحة وحاول مجدّدًا.'); return }

    // بناء الحمولة بأعمدةٍ مطابقةٍ تمامًا لجدول trips
    const capInt = Math.max(0, parseInt(form.capacity, 10) || 0)
    const payload = {
      title,
      route_from:     form.route_from.trim()     || null,
      route_to:       form.route_to.trim()       || null,
      depart_at:      departIso,
      return_at:      localInputToIso(form.return_at),
      capacity:       capInt,
      bus_label:      form.bus_label.trim()      || null,
      boarding_point: form.boarding_point.trim() || null,
      status:         form.status,
      notes:          form.notes.trim()          || null,
    }

    setBusy(true)
    try {
      if (isEdit) {
        const { error } = await supabase.from('trips').update(payload).eq('id', trip.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('trips')
          .insert({ ...payload, subscriber_id: subscriberId })
        if (error) throw error
      }
      onSaved?.()
    } catch (e2) {
      setErr(typeof e2?.message === 'string' ? e2.message : 'تعذّر حفظ الرحلة.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        // إغلاق فقط عند النقر على الخلفية (لا تُغلق إن بدأ النقر داخل البطاقة)
        if (e.target === e.currentTarget && !busy) onClose?.()
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={isEdit ? 'تعديل رحلة' : 'إنشاء رحلة'}>
        <div className="modal-head">
          <h3>{isEdit ? 'تعديل الرحلة' : 'رحلة جديدة'}</h3>
          <span className="sp" style={{ flex: 1 }} />
          <button type="button" className="modal-x" onClick={onClose} disabled={busy} aria-label="إغلاق">×</button>
        </div>

        <form className="form" onSubmit={handleSubmit} style={{ marginTop: 0, gap: 14 }}>
          <div className="field">
            <label>العنوان <span style={{ color: 'var(--gold-300)' }}>*</span></label>
            <input
              type="text"
              placeholder="مثال: رحلة العشر الأواخر"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="grid-2">
            <div className="field">
              <label>من</label>
              <input
                type="text"
                placeholder="مدينة الانطلاق"
                value={form.route_from}
                onChange={(e) => set('route_from', e.target.value)}
              />
            </div>
            <div className="field">
              <label>إلى</label>
              <input
                type="text"
                placeholder="مكة المكرمة"
                value={form.route_to}
                onChange={(e) => set('route_to', e.target.value)}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field ltr">
              <label>تاريخ ووقت الذهاب <span style={{ color: 'var(--gold-300)' }}>*</span></label>
              <input
                type="datetime-local"
                value={form.depart_at}
                onChange={(e) => set('depart_at', e.target.value)}
                required
              />
            </div>
            <div className="field ltr">
              <label>تاريخ ووقت العودة</label>
              <input
                type="datetime-local"
                value={form.return_at}
                onChange={(e) => set('return_at', e.target.value)}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field ltr">
              <label>السعة</label>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={form.capacity}
                onChange={(e) => set('capacity', e.target.value)}
              />
            </div>
            <div className="field">
              <label>اسم/رقم الباص</label>
              <input
                type="text"
                placeholder="مثال: باص رقم ١"
                value={form.bus_label}
                onChange={(e) => set('bus_label', e.target.value)}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>نقطة الانطلاق</label>
              <input
                type="text"
                placeholder="مثال: محطة جازان المركزية"
                value={form.boarding_point}
                onChange={(e) => set('boarding_point', e.target.value)}
              />
            </div>
            <div className="field">
              <label>الحالة</label>
              <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>ملاحظات</label>
            <textarea
              placeholder="تعليمات أو ترتيبات إضافية…"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
            />
          </div>

          {err && <div className="alert err">{err}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
            <button type="submit" className="btn btn-gold" disabled={busy}>
              {busy ? <span className="spinner" /> : (isEdit ? 'حفظ التعديلات' : 'حفظ الرحلة')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
