import { useMemo } from 'react'
import Icon from './Icon'
import { busName } from '../lib/buses'

const STATUS_AR = {
  registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة',
}
const NO_BP = 'بلا مكان محدَّد'

/** عددُ الصفوف الافتراضيُّ للحافلةِ السعوديّةِ النموذجيّةِ (١٢×٤ + خلفيّ٥ = ٤٩) */
const DEFAULT_CAPACITY = 49
/** عددُ الصفوف المرئيِّ في كلِّ صفحةٍ A4 — مختبَرٌ ليناسبَ مع الترويسةِ والتذييل */
const ROWS_PER_PAGE = 25

/* تنسيقُ تاريخٍ ميلاديٍّ مختصرٍ. */
function fmt(v, opts = {}) {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleDateString('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric', ...opts,
    })
  } catch { return '—' }
}

/* تسميةٌ + قيمةٌ inline لقسم بيانات الرحلة */
function Info({ k, v, ltr = false }) {
  return (
    <div className="mf-info-item">
      <span className="mf-info-k">{k}</span>
      <span className={`mf-info-v${ltr ? ' ltr' : ''}`}>{v || '—'}</span>
    </div>
  )
}

/* جمعُ الاسم + الجوال في خانةٍ واحدةٍ (لقصرِ الكشف) */
function joinNamePhone(name, phone) {
  if (!name && !phone) return '—'
  if (!phone) return name
  if (!name) return phone
  return `${name} · ${phone}`
}

/**
 * ورقةُ كشفٍ واحدةٍ — A4 كاملةُ الترويسةِ والتذييلِ. تتكرّرُ هذه الورقةُ
 * (مع الترويسةِ والتذييلِ نفسِهما) لكلِّ صفحةٍ من صفحات نفس الـ (باص × مكان ركوب)
 * عند تجاوزِ ROWS_PER_PAGE — فلا يفقدُ المستخدمُ الترويسةَ ولا الذيلَ ولا
 * تسلسلَ الترقيمِ بين الصفحات.
 */
function ManifestSheet({
  trip, sub,
  chunk,                  // ركّابُ/صفوفٌ فارغةٌ في هذه الصفحة
  startNum,               // رقمُ بدايةِ الترقيم (٢٦ للصفحة الثانية مثلًا)
  busLabel, busPlate,
  boardingPoint,
  pageIndex, pageTotal,   // ١ من ٢، ٢ من ٢
  groupIndex, groupTotal, // الكشفُ الفلانيُّ من الفلانيّةِ كشوفٍ في الرحلة
  pageBreakBefore,
}) {
  const stampUrl = sub?.stamp_url || ''
  const stamp = (sub?.stamp_text || '').trim()
  const today = fmt(new Date().toISOString())
  const filledCount = chunk.filter(Boolean).length
  // عدد الركاب الإجمالي لهذا (الباص × مكان الركوب) — نُمرَّر للترويسة
  // (نحسبه من فهرس النهاية ‎startNum + chunk.length - 1‎ ليس صحيحًا لأنّه يضمُّ الفراغَ،
  //  بل نُمرَّره من الأعلى ضمن chunk بمساعدةٍ خارجيّةٍ)

  return (
    <article className="mf-sheet" dir="rtl" style={pageBreakBefore ? { pageBreakBefore: 'always' } : undefined}>

      {/* ===== الترويسة — تتكرّرُ في كلِّ صفحةٍ ===== */}
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
          <div className="mf-t3">
            {groupTotal > 1 && <span>كشف {groupIndex} من {groupTotal} · </span>}
            <span>صفحة {pageIndex} من {pageTotal}</span>
          </div>
        </div>
      </header>

      {/* ===== شريطُ مكان الركوب ===== */}
      <div className="mf-pickup">
        <div className="mf-pickup-main">
          <span className="mf-pickup-k">مكانُ الركوب</span>
          <span className="mf-pickup-v">{boardingPoint || NO_BP}</span>
        </div>
        <div className="mf-pickup-count">
          مسجّلٌ: <b>{filledCount > 0 ? filledCount : 0}</b>
        </div>
      </div>

      {/* ===== معلوماتُ الرحلة — صفّان مدمجان ===== */}
      <section className="mf-info">
        <Info k="المسار" v={`${trip?.route_from || '—'} ← ${trip?.route_to || '—'}`} />
        <Info k="تاريخ الذهاب" v={fmt(trip?.depart_at)} />
        <Info k="تاريخ العودة" v={fmt(trip?.return_at)} />
        <Info k="الباص" v={busPlate && busPlate !== '—' ? `${busLabel} · ${busPlate}` : busLabel} />
        <Info k="السائق" v={joinNamePhone(trip?.driver_name, trip?.driver_phone)} />
        <Info k="المشرف" v={joinNamePhone(trip?.supervisor_name, trip?.supervisor_phone)} />
      </section>

      {/* ===== جدولُ الركّاب ===== */}
      <table className="mf-table">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '11%' }} />
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
          {chunk.map((p, idx) => {
            const num = startNum + idx
            if (!p) {
              // صفٌّ فارغٌ — جاهزٌ لإضافةٍ يدويّةٍ على Word/طباعةٍ مكتوبةٍ
              return (
                <tr key={`empty-${num}`} className="mf-row-empty">
                  <td className="mf-num">{num}</td>
                  <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                </tr>
              )
            }
            return (
              <tr key={p.id}>
                <td className="mf-num">{num}</td>
                <td className="mf-name">{p.full_name || '—'}</td>
                <td className="ltr">{p.national_id || '—'}</td>
                <td>{p.nationality || '—'}</td>
                <td className="ltr">{p.phone || '—'}</td>
                <td className="mf-num">{p.seat_no || '—'}</td>
                <td>{p.boarding_point || '—'}</td>
                <td>{STATUS_AR[p.status] || '—'}</td>
                <td></td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* ===== التذييل — يتكرّرُ في كلِّ صفحةٍ ===== */}
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

/* ترتيبٌ أبجديٌّ لأماكنِ الركوب — يُبقي «بلا مكان» في الآخر */
function sortBoardingPoints(arr) {
  return [...arr].sort((a, b) => {
    if (a === NO_BP && b !== NO_BP) return 1
    if (b === NO_BP && a !== NO_BP) return -1
    return a.localeCompare(b, 'ar')
  })
}

/**
 * يُعيدُ عددَ الصفوفِ المعروضةِ في كشفٍ واحدٍ:
 *   - يبدأُ من عدد الركّاب المسجَّلين
 *   - يُضافُ بافرٌ صغيرٌ (٥) لمستحدثاتٍ يدويّةٍ
 *   - يَقفِزُ لأقربِ حدِّ صفحةٍ (٢٥) فلا تظهر أوراقٌ نصفُ فارغةٍ
 *   - مقيّدٌ بسعةِ الباصِ كحدٍّ أقصى (٤٩ افتراضيًّا)
 */
function targetRowCount(filledCount, capacity) {
  const buffer = 5
  const withBuffer = filledCount + buffer
  const snapped = Math.ceil(withBuffer / ROWS_PER_PAGE) * ROWS_PER_PAGE
  const minimum = ROWS_PER_PAGE  // كشفٌ بصفحةٍ كاملةٍ على الأقلّ (مساحةُ كتابةٍ يدويّةٍ)
  return Math.min(Math.max(snapped, minimum), capacity)
}

/**
 * الكشف الرسميّ — يُصدر كشفًا لكلِّ (باص × مكانِ ركوب)، وكلُّ كشفٍ
 * يحتوي صفوفًا مرقّمةً حتّى السعةِ المنطقيّةِ (افتراضيًّا حتّى ٤٩).
 * يتدفّقُ الكشفُ تلقائيًّا على صفحاتٍ A4 (٢٥ صفًّا/صفحة) مع تكرارِ
 * الترويسةِ والتذييلِ في كلِّ صفحةٍ — جاهزٌ للطباعةِ مباشرةً أو
 * للحفظِ PDF وتعديلِه يدويًّا على Word لإضافةِ معتمرٍ نُسي.
 */
export default function Manifest({ trip, sub, passengers = [], buses = [], onClose }) {
  const groups = useMemo(() => {
    const capacity = trip?.capacity || DEFAULT_CAPACITY
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
        const filled = byBP.get(bp).sort((a, b) =>
          (a.full_name || '').localeCompare(b.full_name || '', 'ar'))
        const totalRows = targetRowCount(filled.length, capacity)
        // املأ المصفوفةَ بالركّاب الفعليّين ثمّ بـ null للصفوفِ الفارغة
        const padded = [...filled]
        while (padded.length < totalRows) padded.push(null)
        out.push({
          key: `${busId}:${bp}`,
          rows: padded,
          filled: filled.length,
          totalRows,
          busLabel: busList.length === 1 && busId === 'single' ? (trip?.bus_label || '—') : busName(bus),
          busPlate: busList.length === 1 && busId === 'single' ? (trip?.bus_plate || '—') : (bus.plate || '—'),
          boardingPoint: bp,
        })
      }
    }
    if (out.length === 0) {
      out.push({
        key: 'empty', rows: Array(ROWS_PER_PAGE).fill(null), filled: 0, totalRows: ROWS_PER_PAGE,
        busLabel: trip?.bus_label || '—',
        busPlate: trip?.bus_plate || '—',
        boardingPoint: NO_BP,
      })
    }
    return out
  }, [trip, passengers, buses])

  // تقسيمُ كلِّ مجموعةٍ إلى صفحاتٍ من ROWS_PER_PAGE
  const pages = useMemo(() => {
    const out = []
    groups.forEach((g, gi) => {
      const pageTotal = Math.ceil(g.totalRows / ROWS_PER_PAGE)
      for (let p = 0; p < pageTotal; p++) {
        const start = p * ROWS_PER_PAGE
        const end = Math.min(start + ROWS_PER_PAGE, g.rows.length)
        out.push({
          key: `${g.key}#${p}`,
          chunk: g.rows.slice(start, end),
          startNum: start + 1,
          busLabel: g.busLabel,
          busPlate: g.busPlate,
          boardingPoint: g.boardingPoint,
          pageIndex: p + 1,
          pageTotal,
          groupIndex: gi + 1,
          groupTotal: groups.length,
        })
      }
    })
    return out
  }, [groups])

  function handlePrint() { window.print() }

  return (
    <div className="manifest-overlay">
      <div className="manifest-toolbar no-print">
        <button className="btn btn-ghost btn-sm mf-btn" onClick={onClose} aria-label="رجوع">
          <Icon name="arrowRight" size={18} /> <span>رجوع</span>
        </button>
        {groups.length > 1 && (
          <span className="mf-toolbar-info">
            {groups.length} {groups.length === 2 ? 'كشفان' : 'كشوفات'} · ورقةٌ لكلِّ مكانِ ركوبٍ في كلِّ باص
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn btn-em btn-sm mf-btn" onClick={handlePrint}>
          <Icon name="manifest" size={18} /> <span>طباعة / حفظ PDF</span>
        </button>
      </div>

      <div className="manifest-scroll">
        {pages.map((p, idx) => (
          <ManifestSheet
            key={p.key}
            trip={trip}
            sub={sub}
            chunk={p.chunk}
            startNum={p.startNum}
            busLabel={p.busLabel}
            busPlate={p.busPlate}
            boardingPoint={p.boardingPoint}
            pageIndex={p.pageIndex}
            pageTotal={p.pageTotal}
            groupIndex={p.groupIndex}
            groupTotal={p.groupTotal}
            pageBreakBefore={idx > 0}
          />
        ))}
      </div>
    </div>
  )
}
