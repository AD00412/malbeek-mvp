import { useMemo } from 'react'
import Icon from './Icon'
import { busName } from '../lib/buses'

const STATUS_AR = {
  registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة',
}
const NO_BP = 'بلا مكان محدَّد'
const DEFAULT_CAPACITY = 49
/** عددُ الصفوف لكلِّ صفحةٍ A4 — مضبوطٌ مع رأسٍ موحَّدٍ يحوي بيانات الناقل */
const ROWS_PER_PAGE = 22

/* تنسيقُ تاريخٍ هجريٍّ بصيغةِ ١٣/٠٦/١٤٤٧ — يستخدمُ تقويمَ أمّ القرى. */
function fmtHijri(v) {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleDateString('ar-SA-u-ca-islamic-umalqura', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
  } catch { return '—' }
}

/* تنسيقُ تاريخٍ ميلاديٍّ مختصرٍ بصيغةِ ٠٤/١٢/٢٠٢٥ — مقروءٌ ومدمجٌ. */
function fmtGreg(v) {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleDateString('ar-EG', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
  } catch { return '—' }
}

/* جمعُ الاسم والجوال في خانةٍ واحدةٍ */
function joinNamePhone(name, phone) {
  if (!name && !phone) return '—'
  if (!phone) return name
  if (!name) return phone
  return (
    <>
      <span>{name}</span>
      <span className="mf-c-sep"> · </span>
      <span className="ltr">{phone}</span>
    </>
  )
}

/* بناءُ نصِّ الوجهةِ مع رحلةِ العودة (مثال: «جازان - مكة - جازان») */
function buildRoute(from, to, hasReturn) {
  const a = (from || '—').trim()
  const b = (to || '—').trim()
  return hasReturn ? `${a} - ${b} - ${a}` : `${a} - ${b}`
}

/* سطرٌ في كتلةِ بيانات الناقل */
function CarrierRow({ k, v }) {
  return (
    <div className="mf-c-row">
      <span className="mf-c-k">{k}</span>
      <span className="mf-c-v">{v || '—'}</span>
    </div>
  )
}

/**
 * ورقةُ كشفٍ واحدةٍ — A4 برأسٍ موحَّدٍ يحوي بياناتِ الناقلِ كاملةً.
 * الترويسةُ والتذييلُ يتكرّران في كلِّ صفحةٍ من صفحاتِ نفسِ الكشف.
 */
function ManifestSheet({
  trip, sub, carrierCompany,
  driver1Name, driver1Phone, driver2Name, driver2Phone,
  chunk, startNum, busLabel, busPlate, boardingPoint,
  pageIndex, pageTotal, groupIndex, groupTotal, pageBreakBefore,
}) {
  const stampUrl = sub?.stamp_url || ''
  const stamp = (sub?.stamp_text || '').trim()
  const today = fmtGreg(new Date().toISOString())
  const filledCount = chunk.filter(Boolean).length
  const hasReturn = !!trip?.return_at
  const route = buildRoute(trip?.route_from, trip?.route_to, hasReturn)

  return (
    <article className="mf-sheet" dir="rtl" style={pageBreakBefore ? { pageBreakBefore: 'always' } : undefined}>

      {/* ===== الترويسة — اللوكَب يمين، بياناتُ الناقل يسار ===== */}
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

        <div className="mf-carrier">
          <CarrierRow k="الشركة الناقلة" v={carrierCompany} />
          <CarrierRow k="الوجهة" v={route} />
          <CarrierRow k="الذهاب" v={<><span dir="ltr">{fmtGreg(trip?.depart_at)}</span><span className="mf-c-sep"> · </span><span dir="ltr">{fmtHijri(trip?.depart_at)}</span></>} />
          <CarrierRow k="العودة" v={hasReturn ? <><span dir="ltr">{fmtGreg(trip?.return_at)}</span><span className="mf-c-sep"> · </span><span dir="ltr">{fmtHijri(trip?.return_at)}</span></> : '—'} />
          <CarrierRow k="السائق ١" v={joinNamePhone(driver1Name, driver1Phone)} />
          <CarrierRow k="السائق ٢" v={(driver2Name || driver2Phone) ? joinNamePhone(driver2Name, driver2Phone) : '—'} />
          <CarrierRow k="رقم الباص" v={busLabel || '—'} />
          <CarrierRow k="لوحة الباص" v={<span className="ltr">{busPlate || '—'}</span>} />
        </div>
      </header>

      {/* ===== سطرٌ فرعيٌّ: عنوانُ الكشف + رقمُ الصفحة ===== */}
      <div className="mf-subtitle">
        <div className="mf-st-main">كشفُ ركّاب الحافلة · {trip?.title || 'رحلة عُمرة'}</div>
        <div className="mf-st-page">
          {groupTotal > 1 && <span>كشف {groupIndex} من {groupTotal} · </span>}
          صفحة {pageIndex} من {pageTotal}
        </div>
      </div>

      {/* ===== شريطُ مكان الركوب — هويّةُ هذه الورقة ===== */}
      <div className="mf-pickup">
        <div className="mf-pickup-main">
          <span className="mf-pickup-k">مكانُ الركوب</span>
          <span className="mf-pickup-v">{boardingPoint || NO_BP}</span>
        </div>
        <div className="mf-pickup-count">
          مسجّلٌ: <b>{filledCount}</b>
        </div>
      </div>

      {/* ===== جدولُ الركّاب — أعمدةٌ ثابتةُ القياسِ موحَّدةٌ بين كلِّ الكشوفات ===== */}
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

      {/* ===== التذييل — موحَّدٌ في كلِّ الكشوفات ===== */}
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

function targetRowCount(filledCount, capacity) {
  const buffer = 5
  const target = Math.max(filledCount + buffer, ROWS_PER_PAGE)
  return Math.min(target, capacity)
}

/**
 * الكشف الرسميّ — رأسٌ موحَّدٌ بكلِّ بيانات الناقل في كلِّ صفحةٍ، توزيعٌ
 * حسب (الباص × مكانِ الركوب)، أعمدةٌ ثابتةُ القياس.
 */
export default function Manifest({ trip, sub, passengers = [], buses = [], onClose }) {
  // الحقولُ القابلةُ للتعديلِ من إعدادات الحملةِ والرحلةِ (مع fallbackاتٍ متوافقةٍ)
  const carrierCompany = (sub?.carrier_company || sub?.org_name || 'الحملة').trim()
  const driver1Name  = trip?.driver_name || ''
  const driver1Phone = trip?.driver_phone || ''
  const driver2Name  = trip?.driver2_name  || trip?.assistant_name  || ''
  const driver2Phone = trip?.driver2_phone || trip?.assistant_phone || ''

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
            carrierCompany={carrierCompany}
            driver1Name={driver1Name}
            driver1Phone={driver1Phone}
            driver2Name={driver2Name}
            driver2Phone={driver2Phone}
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
