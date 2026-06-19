import { useRef, useMemo } from 'react'
import Icon from './Icon'
import { busName } from '../lib/buses'

const STATUS_AR = {
  registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة',
}
const NO_BP = 'بلا مكان محدَّد'

/* تنسيقُ تاريخٍ ميلاديٍّ مختصرٍ بالعربيّ. */
function fmt(v, opts = {}) {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleDateString('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric', ...opts,
    })
  } catch { return '—' }
}

/* صفُّ معلوماتٍ — تسمية + قيمة، مختصرٌ ومنظّمٌ بحقّه */
function Info({ k, v, ltr = false }) {
  return (
    <div className="mf-info-item">
      <span className="mf-info-k">{k}</span>
      <span className={`mf-info-v${ltr ? ' ltr' : ''}`}>{v || '—'}</span>
    </div>
  )
}

/* جمعُ الاسم + الجوال في صفٍّ واحدٍ لأماكنَ كالسائق/المشرف */
function joinNamePhone(name, phone) {
  if (!name && !phone) return '—'
  if (!phone) return name
  if (!name) return phone
  return `${name} · ${phone}`
}

/**
 * ورقةُ كشفٍ واحدةٍ — A4 مدمجةٌ ومتوازنةٌ، تتسعُ لـ ~٣٠ راكبًا في صفحةٍ
 * (وتتدفّقُ تلقائيًّا لصفحاتٍ متعدّدةٍ عند الأعدادِ الكبيرةِ مع تكرارِ
 *  ترويسةِ الجدول).
 */
function ManifestSheet({ trip, sub, rows, busLabel, busPlate, boardingPoint, pageBreak, sheetIndex, totalSheets }) {
  const count = rows.length
  const stampUrl = sub?.stamp_url || ''
  const stamp = (sub?.stamp_text || '').trim()
  const today = fmt(new Date().toISOString())

  return (
    <article className="mf-sheet" dir="rtl" style={pageBreak ? { pageBreakBefore: 'always' } : undefined}>

      {/* ====== ترويسةٌ رسميّةٌ مدمجةٌ — اللوكَب يمين، البطاقة يسار ====== */}
      <header className="mf-head">
        <div className="mf-brand">
          {sub?.logo_url && (
            <img className="mf-logo" src={sub.logo_url} alt={sub?.org_name || 'الحملة'} crossOrigin="anonymous" />
          )}
          <div className="mf-brand-text">
            <div className="mf-org">{sub?.org_name || 'الحملة'}</div>
            <div className="mf-org-sub">
              {sub?.license_no && <span>تصريح: {sub.license_no}</span>}
              {sub?.contact_phone && <span dir="ltr">· {sub.contact_phone}</span>}
            </div>
          </div>
        </div>
        <div className="mf-title">
          <div className="mf-t1">كشفُ ركّاب الحافلة</div>
          <div className="mf-t2">{trip?.title || 'رحلة عُمرة'}</div>
          {totalSheets > 1 && <div className="mf-t3">ورقة {sheetIndex} من {totalSheets}</div>}
        </div>
      </header>

      {/* ====== سطرُ مكان الركوب — لمسةٌ زمرّديّةٌ رفيعةٌ ====== */}
      <div className="mf-pickup">
        <div className="mf-pickup-main">
          <span className="mf-pickup-k">مكانُ الركوب</span>
          <span className="mf-pickup-v">{boardingPoint || NO_BP}</span>
        </div>
        <div className="mf-pickup-count">
          عددُ الركّاب: <b>{count}</b>
        </div>
      </div>

      {/* ====== معلوماتُ الرحلة — صفٌّ مدمجٌ بسطرَين ====== */}
      <section className="mf-info">
        <Info k="المسار" v={`${trip?.route_from || '—'} ← ${trip?.route_to || '—'}`} />
        <Info k="تاريخ الذهاب" v={fmt(trip?.depart_at)} />
        <Info k="تاريخ العودة" v={fmt(trip?.return_at)} />
        <Info k="الباص" v={busPlate && busPlate !== '—' ? `${busLabel} · ${busPlate}` : busLabel} />
        <Info k="السائق" v={joinNamePhone(trip?.driver_name, trip?.driver_phone)} />
        <Info k="المشرف" v={joinNamePhone(trip?.supervisor_name, trip?.supervisor_phone)} />
      </section>

      {/* ====== جدولُ الركّاب — يتدفّقُ عبر الصفحاتِ مع تكرارِ الترويسة ====== */}
      <table className="mf-table">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>م</th>
            <th>الاسم الرباعي</th>
            <th>رقم الهوية / الإقامة</th>
            <th>الجنسية</th>
            <th>رقم الجوال</th>
            <th>المقعد</th>
            <th>مكان الركوب</th>
            <th>الحالة</th>
            <th>ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={9} className="mf-empty">لا ركّابَ مسجّلين لهذا المكانِ بعد.</td></tr>
          ) : rows.map((p, i) => (
            <tr key={p.id}>
              <td className="mf-num">{i + 1}</td>
              <td className="mf-name">{p.full_name || '—'}</td>
              <td className="ltr">{p.national_id || '—'}</td>
              <td>{p.nationality || '—'}</td>
              <td className="ltr">{p.phone || '—'}</td>
              <td className="mf-num">{p.seat_no || '—'}</td>
              <td>{p.boarding_point || '—'}</td>
              <td>{STATUS_AR[p.status] || '—'}</td>
              <td className="mf-notes"></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ====== تذييلٌ نحيلٌ — تاريخٌ يمين، ختمٌ يسار ====== */}
      <footer className="mf-foot">
        <div className="mf-note">
          كشفٌ رسميٌّ صادرٌ عن {sub?.org_name || 'الحملة'} · {today}
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
    const busList = buses.length > 0
      ? buses
      : [{ id: 'single', plate: trip?.bus_plate, label: trip?.bus_label, name: trip?.bus_label }]

    const out = []
    for (const bus of busList) {
      const busId = bus.id
      const busPax = busList.length === 1 && busId === 'single'
        ? passengers
        : passengers.filter((p) => p.bus_id === busId)

      const byBP = new Map()
      for (const p of busPax) {
        const bp = (p.boarding_point || '').trim() || NO_BP
        if (!byBP.has(bp)) byBP.set(bp, [])
        byBP.get(bp).push(p)
      }

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
