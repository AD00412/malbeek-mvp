import { useRef, useState } from 'react'
import CompassMark from './CompassMark'
import Icon from './Icon'
import { busName } from '../lib/buses'
import { htmlsToPdf } from '../lib/pdf'

const STATUS_AR = { registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة' }

/* تنسيق تاريخ ميلادي مختصر للكشف */
function fmt(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return '—' }
}

/* خليّة ترويسة (تسمية + قيمة) */
function HCell({ label, value }) {
  return (
    <div className="mf-cell">
      <span className="mf-k">{label}</span>
      <span className="mf-v">{value || '—'}</span>
    </div>
  )
}

/* ورقة كشفٍ واحدة (باصٌ واحد) */
function ManifestSheet({ trip, sub, rows, busLabel, busPlate, pageBreak }) {
  const count = rows.length
  const stamp = (sub?.stamp_text || '').trim()
  return (
    <div className="manifest-sheet" dir="rtl" style={pageBreak ? { pageBreakBefore: 'always' } : undefined}>
      <header className="mf-head">
        <div className="mf-brand">
          <CompassMark size={54} variant="gold" />
          <div>
            <div className="mf-org">{sub?.org_name || 'مؤسسة النقل'}</div>
            <div className="mf-sub">
              {sub?.license_no ? `تصريح رقم: ${sub.license_no}` : 'كشف رسمي لرحلة عُمرة'}
              {sub?.contact_phone ? ` · ${sub.contact_phone}` : ''}
            </div>
          </div>
        </div>
        <div className="mf-title">
          <div className="t1">كشف ركّاب الحافلة</div>
          <div className="t2">{trip?.title || 'رحلة عُمرة'}</div>
        </div>
      </header>

      <section className="mf-grid">
        <HCell label="المسار" value={`${trip?.route_from || '—'} ← ${trip?.route_to || '—'}`} />
        <HCell label="تاريخ الذهاب" value={fmt(trip?.depart_at)} />
        <HCell label="تاريخ العودة" value={fmt(trip?.return_at)} />
        <HCell label="رقم/اسم الباص" value={busLabel} />
        <HCell label="لوحة الباص" value={busPlate} />
        <HCell label="عدد الركّاب" value={String(count)} />
        <HCell label="السائق" value={trip?.driver_name} />
        <HCell label="جوال السائق" value={trip?.driver_phone} />
        <HCell label="مساعد السائق" value={trip?.assistant_name} />
        <HCell label="جوال المساعد" value={trip?.assistant_phone} />
        <HCell label="المشرف" value={trip?.supervisor_name} />
        <HCell label="جوال المشرف" value={trip?.supervisor_phone} />
      </section>

      <table className="mf-table">
        <thead>
          <tr>
            <th style={{ width: '4%' }}>م</th>
            <th style={{ width: '22%' }}>الاسم الرباعي</th>
            <th style={{ width: '13%' }}>رقم الهوية/الإقامة</th>
            <th style={{ width: '9%' }}>الجنسية</th>
            <th style={{ width: '12%' }}>رقم الجوال</th>
            <th style={{ width: '6%' }}>المقعد</th>
            <th style={{ width: '13%' }}>مكان الركوب</th>
            <th style={{ width: '9%' }}>الحالة</th>
            <th style={{ width: '12%' }}>التوقيع</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={9} className="mf-empty">لا يوجد ركّابٌ مسجّلون بعد لهذا الباص.</td></tr>
          ) : (
            rows.map((p, i) => (
              <tr key={p.id}>
                <td>{i + 1}</td>
                <td className="mf-name">{p.full_name || '—'}</td>
                <td className="ltr">{p.national_id || '—'}</td>
                <td>{p.nationality || '—'}</td>
                <td className="ltr">{p.phone || '—'}</td>
                <td>{p.seat_no || '—'}</td>
                <td>{p.boarding_point || '—'}</td>
                <td>{STATUS_AR[p.status] || '—'}</td>
                <td></td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <footer className="mf-foot">
        <div className="mf-note">
          صُدر هذا الكشف من منصّة ملبّيك بتاريخ {fmt(new Date().toISOString())}.
        </div>
        <div className="mf-stamp">
          {stamp ? (
            <div className="mf-stamp-e">
              <CompassMark size={30} variant="gold" />
              <span>{stamp}</span>
            </div>
          ) : (
            <div className="mf-stamp-m">الختم والتوقيع</div>
          )}
        </div>
      </footer>
    </div>
  )
}

/**
 * الكشف الرسمي. عند تعدّد الباصات يُصدَر كشفٌ مستقلٌّ لكلّ باص (ورقةٌ لكلّ سائق)؛
 * وعند الباص الواحد يبقى كشفًا واحدًا مطابقًا تمامًا للسابق.
 *
 * @param {object} trip
 * @param {object} sub
 * @param {Array}  passengers
 * @param {Array}  buses
 * @param {Function} onClose
 */
export default function Manifest({ trip, sub, passengers = [], buses = [], onClose }) {
  const multi = buses.length > 1
  const groups = multi
    ? buses.map((b) => ({
        key: b.id,
        rows: passengers.filter((p) => p.bus_id === b.id),
        busLabel: busName(b),
        busPlate: b.plate || '—',
      }))
    : [{ key: 'single', rows: passengers, busLabel: trip?.bus_label, busPlate: trip?.bus_plate }]

  const sheetRefs = useRef([])
  const [busy, setBusy] = useState(false)

  async function downloadPdf() {
    if (busy) return
    setBusy(true)
    try {
      await htmlsToPdf(sheetRefs.current.filter(Boolean), `كشف-${(trip?.title || 'رحلة').replace(/\s+/g, '_')}`)
    } catch (e) { alert('تعذّر إنشاء PDF: ' + (e?.message || e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="manifest-overlay">
      <div className="manifest-toolbar no-print">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <Icon name="arrowRight" size={16} /> رجوع
        </button>
        {multi && <span className="muted" style={{ fontSize: 13 }}>{buses.length} باصات — كشفٌ لكلّ باص</span>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
          <Icon name="qr" size={16} /> طباعة
        </button>
        <button className="btn btn-gold btn-sm" onClick={downloadPdf} disabled={busy}>
          {busy ? <span className="spinner" /> : <><Icon name="download" size={16} /> تنزيل PDF</>}
        </button>
      </div>

      <div className="manifest-scroll">
        {groups.map((g, gi) => (
          <div key={g.key} ref={(el) => { sheetRefs.current[gi] = el }}>
            <ManifestSheet
              trip={trip}
              sub={sub}
              rows={g.rows}
              busLabel={g.busLabel}
              busPlate={g.busPlate}
              pageBreak={gi > 0}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
