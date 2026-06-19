import { useRef, useMemo } from 'react'
import Icon from './Icon'
import { busName } from '../lib/buses'

const STATUS_AR = {
  registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة',
}
const NO_BP = 'بلا مكان محدَّد'

/* تنسيقُ تاريخٍ ميلاديٍّ مختصرٍ بالعربيّ. يُحاول الهجريَّ أوّلًا إن كان متاحًا. */
function fmt(v, opts = {}) {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleDateString('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric', ...opts,
    })
  } catch { return '—' }
}

/* خليّةُ ترويسةٍ (تسميةٌ صغيرةٌ + قيمةٌ بارزةٌ) */
function HCell({ label, value, wide = false }) {
  return (
    <div className={`mf-cell ${wide ? 'wide' : ''}`}>
      <span className="mf-k">{label}</span>
      <span className="mf-v">{value || '—'}</span>
    </div>
  )
}

/**
 * ورقةُ كشفٍ واحدةٍ — لباصٍ واحدٍ ومكانِ ركوبٍ واحدٍ.
 * كلُّ ورقةٍ مستقلّةٌ بحقّها للطباعة (مقاسُ A4).
 */
function ManifestSheet({ trip, sub, rows, busLabel, busPlate, boardingPoint, pageBreak, sheetIndex, totalSheets }) {
  const count = rows.length
  const stampUrl = sub?.stamp_url || ''
  const stamp = (sub?.stamp_text || '').trim()
  const today = fmt(new Date().toISOString())

  return (
    <article className="mf-sheet" dir="rtl" style={pageBreak ? { pageBreakBefore: 'always' } : undefined}>

      {/* ======= ترويسةٌ رسميّةٌ ======= */}
      <header className="mf-head">
        <div className="mf-brand">
          {sub?.logo_url && (
            <img className="mf-logo" src={sub.logo_url} alt={sub?.org_name || 'الحملة'} crossOrigin="anonymous" />
          )}
          <div className="mf-brand-text">
            <div className="mf-org">{sub?.org_name || 'الحملة'}</div>
            <div className="mf-sub">
              {sub?.license_no && <span>تصريحٌ رقم {sub.license_no}</span>}
              {sub?.contact_phone && <span dir="ltr">{sub.contact_phone}</span>}
            </div>
          </div>
        </div>
        <div className="mf-title">
          <div className="mf-t1">كشفُ ركّاب الحافلة</div>
          <div className="mf-t2">{trip?.title || 'رحلة عُمرة'}</div>
          {totalSheets > 1 && (
            <div className="mf-t3">الورقة {sheetIndex} من {totalSheets}</div>
          )}
        </div>
      </header>

      {/* ======= شريطُ تحديدٍ بارزٌ لمكان الركوب ======= */}
      <div className="mf-pickup">
        <div className="mf-pickup-label">مكانُ الركوب</div>
        <div className="mf-pickup-value">{boardingPoint || NO_BP}</div>
        <div className="mf-pickup-meta">
          <span>عدد الركّاب: <b>{count}</b></span>
        </div>
      </div>

      {/* ======= بياناتُ الرحلة (شبكةٌ مكثَّفة) ======= */}
      <section className="mf-grid">
        <HCell label="المسار" value={`${trip?.route_from || '—'} ← ${trip?.route_to || '—'}`} wide />
        <HCell label="تاريخ الذهاب" value={fmt(trip?.depart_at)} />
        <HCell label="تاريخ العودة" value={fmt(trip?.return_at)} />
        <HCell label="رقم/اسم الباص" value={busLabel} />
        <HCell label="لوحة الباص" value={busPlate} />
        <HCell label="السائق" value={trip?.driver_name} />
        <HCell label="جوال السائق" value={trip?.driver_phone} />
        <HCell label="المشرف" value={trip?.supervisor_name} />
        <HCell label="جوال المشرف" value={trip?.supervisor_phone} />
      </section>

      {/* ======= جدولُ الركّاب ======= */}
      <table className="mf-table">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '20%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>م</th>
            <th>الاسم الرباعي</th>
            <th>رقم الهوية / الإقامة</th>
            <th>الجنسية</th>
            <th>رقم الجوال</th>
            <th>المقعد</th>
            <th>الحالة</th>
            <th>ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={8} className="mf-empty">لا ركّابَ مسجّلين لهذا المكانِ بعد.</td></tr>
          ) : rows.map((p, i) => (
            <tr key={p.id}>
              <td className="mf-num">{i + 1}</td>
              <td className="mf-name">{p.full_name || '—'}</td>
              <td className="ltr">{p.national_id || '—'}</td>
              <td>{p.nationality || '—'}</td>
              <td className="ltr">{p.phone || '—'}</td>
              <td className="mf-num">{p.seat_no || '—'}</td>
              <td>{STATUS_AR[p.status] || '—'}</td>
              <td className="mf-notes"></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ======= تذييلٌ رسميٌّ ======= */}
      <footer className="mf-foot">
        <div className="mf-note">
          كشفٌ رسميٌّ صادرٌ عن {sub?.org_name || 'الحملة'} بتاريخ {today}.
          <br/>
          <span className="mf-note-fine">يُلتزم بمكان الركوب المحدَّد والمواعيد المعلنة، ويُمنع تبادل المقاعد دون إذنٍ من المشرف.</span>
        </div>
        <div className="mf-stamp">
          {stampUrl ? (
            <img className="mf-stamp-img" src={stampUrl} alt="الختم الرسميّ" crossOrigin="anonymous" />
          ) : stamp ? (
            <div className="mf-stamp-e"><span>{stamp}</span></div>
          ) : (
            <div className="mf-stamp-m">الختمُ والتوقيع</div>
          )}
        </div>
      </footer>

    </article>
  )
}

/* ترتيبٌ أبجديٌّ عربيٌّ لمفاتيح أماكن الركوب — يُبقي «بلا مكان محدَّد» في الآخر */
function sortBoardingPoints(arr) {
  return [...arr].sort((a, b) => {
    if (a === NO_BP && b !== NO_BP) return 1
    if (b === NO_BP && a !== NO_BP) return -1
    return a.localeCompare(b, 'ar')
  })
}

/**
 * الكشف الرسميّ — يُصدر كشفًا لكلِّ (باص × مكانِ ركوب).
 * كلُّ ورقةٍ على حدةٍ A4 مع page-break للطباعة الرسميّة الواضحة.
 *
 * مثال: حملةٌ بباصَين، الأوّلُ يأخذ من جازان والمسارحة، الثاني من الرياض،
 * فتُنشأ ٣ أوراق:
 *   ١) باص ١ — جازان
 *   ٢) باص ١ — المسارحة
 *   ٣) باص ٢ — الرياض
 *
 * @param {object} trip
 * @param {object} sub
 * @param {Array}  passengers
 * @param {Array}  buses        (فارغةٌ = باصٌ واحدٌ من حقول trip)
 * @param {Function} onClose
 */
export default function Manifest({ trip, sub, passengers = [], buses = [], onClose }) {
  const groups = useMemo(() => {
    // قائمةُ الباصاتِ الفعليّة: إن لم تكن متعدّدةً ننشئ باصًا منطقيًّا واحدًا
    const busList = buses.length > 0
      ? buses
      : [{ id: 'single', plate: trip?.bus_plate, label: trip?.bus_label, name: trip?.bus_label }]

    const out = []
    for (const bus of busList) {
      const busId = bus.id
      const busPax = busList.length === 1 && busId === 'single'
        ? passengers
        : passengers.filter((p) => p.bus_id === busId)

      // التجميعُ حسب مكان الركوب
      const byBP = new Map()
      for (const p of busPax) {
        const bp = (p.boarding_point || '').trim() || NO_BP
        if (!byBP.has(bp)) byBP.set(bp, [])
        byBP.get(bp).push(p)
      }

      // الأماكنُ مرتّبةٌ + ترتيبُ الأسماء داخل كلِّ مكان
      const bpKeys = sortBoardingPoints([...byBP.keys()])
      for (const bp of bpKeys) {
        const rows = byBP.get(bp).sort((a, b) =>
          (a.full_name || '').localeCompare(b.full_name || '', 'ar'))
        out.push({
          key: `${busId}:${bp}`,
          rows,
          busLabel: busList.length === 1 && busId === 'single' ? (trip?.bus_label || '—') : busName(bus),
          busPlate: busList.length === 1 && busId === 'single' ? (trip?.bus_plate || '—') : (bus.plate || '—'),
          boardingPoint: bp,
        })
      }
    }
    // حالةٌ خاصّةٌ: لا ركّابَ أصلًا — نُظهر ورقةً فارغةً واحدةً
    if (out.length === 0) {
      out.push({
        key: 'empty', rows: [],
        busLabel: trip?.bus_label || '—',
        busPlate: trip?.bus_plate || '—',
        boardingPoint: NO_BP,
      })
    }
    return out
  }, [trip, passengers, buses])

  const sheetsRef = useRef(null)

  function handlePrint() {
    // window.print() ينتجُ PDF حقيقيًّا (نصّيًّا قابلًا للبحث) من المتصفّح،
    // مع دعمٍ كاملٍ للعربيّ والـ A4 — بلا screenshot ولا فقدان جودة.
    window.print()
  }

  return (
    <div className="manifest-overlay">
      <div className="manifest-toolbar no-print">
        <button className="btn btn-ghost btn-sm mf-btn" onClick={onClose} aria-label="رجوع">
          <Icon name="arrowRight" size={18} /> <span>رجوع</span>
        </button>
        {groups.length > 1 && (
          <span className="mf-toolbar-info">
            {groups.length} {groups.length === 2 ? 'كشفان' : 'كشوفات'} — ورقةٌ لكلِّ مكانِ ركوبٍ في كلِّ باص
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn btn-em btn-sm mf-btn" onClick={handlePrint}>
          <Icon name="manifest" size={18} /> <span>طباعة / حفظ PDF</span>
        </button>
      </div>

      <div className="manifest-scroll" ref={sheetsRef}>
        {groups.map((g, gi) => (
          <ManifestSheet
            key={g.key}
            trip={trip}
            sub={sub}
            rows={g.rows}
            busLabel={g.busLabel}
            busPlate={g.busPlate}
            boardingPoint={g.boardingPoint}
            pageBreak={gi > 0}
            sheetIndex={gi + 1}
            totalSheets={groups.length}
          />
        ))}
      </div>
    </div>
  )
}
