import { Fragment, useMemo, useState } from 'react'
import Icon from './Icon'
import { busName } from '../lib/buses'
import ReportSettings from './ReportSettings'

const STATUS_AR = {
  registered: 'مسجل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة',
}
const NO_BP = 'بلا مكان محدد'

function fmtHijri(v) {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleDateString('ar-SA-u-ca-islamic-umalqura', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
  } catch { return '—' }
}

function fmtGreg(v) {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleDateString('ar-EG', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
  } catch { return '—' }
}

function buildRoute(from, to, hasReturn) {
  const a = (from || '—').trim()
  const b = (to || '—').trim()
  return hasReturn ? `${a} - ${b} - ${a}` : `${a} - ${b}`
}

function CarrierRow({ k, v }) {
  return (
    <div className="mf-c-row">
      <span className="mf-c-k">{k}</span>
      <span className="mf-c-v">{v || '—'}</span>
    </div>
  )
}

/** ختم إلكتروني دائري */
function ElectronicStamp({ orgName, docRef }) {
  return (
    <div className="mf-stamp-circle" aria-label="ختم إلكتروني رسمي">
      <svg viewBox="0 0 120 120" className="mf-stamp-svg" aria-hidden="true">
        <circle cx="60" cy="60" r="56" fill="none" stroke="#0b5c43" strokeWidth="2.5" strokeDasharray="4 2" />
        <circle cx="60" cy="60" r="46" fill="none" stroke="#0b5c43" strokeWidth="1" />
        <text textAnchor="middle" dominantBaseline="middle">
          <textPath href="#mf-stamp-path-top" startOffset="50%">
            {orgName} · كشف رسمي
          </textPath>
        </text>
        <text x="60" y="57" textAnchor="middle" fontSize="9" fill="#0b5c43" fontWeight="700">معتمد</text>
        <text x="60" y="67" textAnchor="middle" fontSize="9" fill="#0b5c43">إلكترونياً ✔</text>
        <defs>
          <path id="mf-stamp-path-top" d="M 10,60 A 50,50 0 0 1 110,60" />
        </defs>
      </svg>
      {docRef && <div className="mf-stamp-ref">{docRef}</div>}
    </div>
  )
}

/** حساب رقم توثيق من معرّف الرحلة والتاريخ */
function buildDocRef(tripId, date) {
  const hex = (tripId || '').replace(/-/g, '').slice(0, 8).toUpperCase()
  const d = new Date(date || Date.now())
  const yy = String(d.getFullYear()).slice(2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `MLK-${yy}${mm}-${hex || 'XXXXXXXX'}`
}

/** شريط ملخص الكشف */
function SummaryBar({ passengers, capacity, bpCount, settings }) {
  if (settings?.show_summary === false) return null
  const total = passengers.length
  const counts = passengers.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1
    return acc
  }, {})
  return (
    <div className="mf-summary no-print-hide">
      <div className="mf-sum-item mf-sum-total">
        <span className="mf-sum-n">{total}/{capacity || '—'}</span>
        <span className="mf-sum-l">إجمالي المعتمرين</span>
      </div>
      <div className="mf-sum-sep" />
      <div className="mf-sum-item">
        <span className="mf-sum-n">{bpCount}</span>
        <span className="mf-sum-l">نقطة ركوب</span>
      </div>
      {Object.entries(counts).map(([st, n]) => (
        <div className="mf-sum-item" key={st}>
          <span className="mf-sum-n mf-sum-st">{n}</span>
          <span className="mf-sum-l">{STATUS_AR[st] || st}</span>
        </div>
      ))}
    </div>
  )
}

/** بطاقة معتمر — وضع الجوال */
function PaxCard({ p, num, settings }) {
  const cols = settings?.columns || {}
  return (
    <div className="mf-card">
      <div className="mf-card-num">{num}</div>
      <div className="mf-card-body">
        <div className="mf-card-name">{p.full_name || '—'}</div>
        <div className="mf-card-details">
          {cols.national_id !== false && p.national_id && (
            <span className="ltr">{p.national_id}</span>
          )}
          {cols.nationality !== false && p.nationality && (
            <span>{p.nationality}</span>
          )}
          {cols.phone !== false && p.phone && (
            <span className="ltr">{p.phone}</span>
          )}
          {cols.seat_no !== false && p.seat_no && (
            <span>مقعد {p.seat_no}</span>
          )}
        </div>
        {cols.status !== false && (
          <div className={`mf-card-status mf-st-${p.status}`}>{STATUS_AR[p.status] || '—'}</div>
        )}
        {cols.notes !== false && p.notes && (
          <div className="mf-card-notes">{p.notes}</div>
        )}
      </div>
    </div>
  )
}

/**
 * كشف باص واحد — جدول A4 للطباعة، كروت على الجوال.
 * يحتوي على تجميع مواقع الركوب داخل جدول واحد مع صفوف رؤوس للمجموعات.
 */
function BusManifest({
  trip, sub, settings,
  busLabel, busPlate,
  groups,     // [{bp, passengers}]
  globalStart, // رقم الراكب الأول في هذا الباص
  pageBreakBefore,
}) {
  const cols = settings?.columns || {}
  const showStamp = settings?.show_stamp !== false
  const showSig = settings?.show_signature !== false

  const carrierCompany = (settings?.carrier_company || sub?.carrier_company || sub?.org_name || '').trim() || '—'
  const driver1Name  = settings?.driver1_name  || trip?.driver_name  || ''
  const driver1Phone = settings?.driver1_phone || trip?.driver_phone || ''
  const driver2Name  = settings?.driver2_name  || trip?.driver2_name  || trip?.assistant_name  || ''
  const driver2Phone = settings?.driver2_phone || trip?.driver2_phone || trip?.assistant_phone || ''
  const plateVal     = settings?.plate         || busPlate || '—'
  const signerName   = settings?.signer_name   || ''

  const hasReturn = !!trip?.return_at
  const route = buildRoute(trip?.route_from, trip?.route_to, hasReturn)
  const today = fmtGreg(new Date())
  const docRef = buildDocRef(trip?.id, new Date())
  const totalPax = groups.reduce((s, g) => s + g.passengers.length, 0)
  const stampUrl = sub?.stamp_url || ''
  const stampText = (sub?.stamp_text || '').trim()

  /* الترقيم المتسلسل: نبني مصفوفة [{bp, p, num}] */
  const flatRows = []
  let seq = globalStart
  for (const g of groups) {
    for (const p of g.passengers) {
      flatRows.push({ bp: g.bp, p, num: seq++ })
    }
  }

  /* نبني مجموعات مفهرسة لرسم الجدول */
  const groupedRows = groups.map((g) => {
    const rows = []
    for (const p of g.passengers) {
      const fr = flatRows.find((r) => r.p === p)
      rows.push({ p, num: fr?.num ?? seq })
    }
    return { bp: g.bp, rows, count: g.passengers.length }
  })

  /* الأعمدة المرئية — دائماً: م + الاسم */
  const visibleCols = [
    { key: 'national_id', label: 'رقم الهوية / الإقامة', cls: 'ltr' },
    { key: 'nationality', label: 'الجنسية', cls: '' },
    { key: 'phone', label: 'رقم الجوال', cls: 'ltr' },
    { key: 'seat_no', label: 'المقعد', cls: 'mf-num' },
    { key: 'boarding_point', label: 'مكان الركوب', cls: '' },
    { key: 'status', label: 'الحالة', cls: '' },
    { key: 'notes', label: 'ملاحظات', cls: '' },
  ].filter((c) => cols[c.key] !== false)

  const colSpan = 2 + visibleCols.length

  return (
    <article
      className="mf-sheet"
      dir="rtl"
      style={pageBreakBefore ? { pageBreakBefore: 'always', breakBefore: 'page' } : undefined}
    >
      {/* ===== ترويسة ===== */}
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
          <CarrierRow k="السائق ١" v={(driver1Name || driver1Phone) ? [driver1Name, driver1Phone].filter(Boolean).join(' · ') : '—'} />
          <CarrierRow k="السائق ٢" v={(driver2Name || driver2Phone) ? [driver2Name, driver2Phone].filter(Boolean).join(' · ') : '—'} />
          <CarrierRow k="رقم الباص" v={busLabel || '—'} />
          <CarrierRow k="لوحة الباص" v={<span className="ltr">{plateVal}</span>} />
        </div>
      </header>

      {/* سطر العنوان */}
      <div className="mf-subtitle">
        <div className="mf-st-main">كشف ركاب الحافلة · {trip?.title || 'رحلة عمرة'}</div>
        <div className="mf-st-page">
          {totalPax} معتمر · {groups.length} {groups.length === 1 ? 'موقع' : 'مواقع ركوب'}
        </div>
      </div>

      {/* ===== كروت الجوال ===== */}
      <div className="mf-cards-view">
        {groupedRows.length === 0 ? (
          <div className="mf-empty">لا معتمرين في هذا الكشف</div>
        ) : groupedRows.map((g) => (
          <div key={g.bp} className="mf-card-group">
            <div className="mf-card-group-header">
              <span className="mf-card-group-bp">{g.bp === NO_BP ? 'بلا مكان محدد' : g.bp}</span>
              <span className="mf-card-group-count">{g.count} معتمر</span>
            </div>
            {g.rows.map(({ p, num }) => (
              <PaxCard key={p.id} p={p} num={num} settings={settings} />
            ))}
          </div>
        ))}
      </div>

      {/* ===== جدول الطباعة ===== */}
      <table className="mf-table mf-print-table">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: visibleCols.length < 5 ? '34%' : '22%' }} />
          {visibleCols.map((c) => <col key={c.key} />)}
        </colgroup>
        <thead>
          <tr>
            <th>م</th>
            <th>الاسم الرباعي</th>
            {visibleCols.map((c) => <th key={c.key}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {groupedRows.length === 0 ? (
            <tr><td colSpan={colSpan} className="mf-empty">لا معتمرين</td></tr>
          ) : groupedRows.map((g) => (
            <Fragment key={g.bp}>
              <tr className="mf-group-row">
                <td colSpan={colSpan}>
                  <span className="mf-group-bp">{g.bp === NO_BP ? 'بلا مكان محدد' : g.bp}</span>
                  <span className="mf-group-count">{g.count} معتمر</span>
                </td>
              </tr>
              {g.rows.map(({ p, num }) => (
                <tr key={p.id}>
                  <td className="mf-num">{num}</td>
                  <td className="mf-name" style={{ overflowWrap: 'anywhere' }}>{p.full_name || '—'}</td>
                  {visibleCols.map((c) => {
                    const val = c.key === 'status'
                      ? (STATUS_AR[p[c.key]] || '—')
                      : (p[c.key] || (c.key === 'notes' ? '' : '—'))
                    return (
                      <td key={c.key} className={c.cls} style={{ overflowWrap: 'anywhere' }}>
                        {val}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      {/* ===== التذييل ===== */}
      <footer className="mf-foot">
        <div className="mf-note">
          كشف رسمي صادر عن {sub?.org_name || 'الحملة'} · {today}
          {showSig && (
            <div className="mf-sig-line">
              <span>توقيع المسؤول: {signerName || '___________________________'}</span>
            </div>
          )}
        </div>
        <div className="mf-stamp">
          {showStamp && stampUrl ? (
            <img className="mf-stamp-img" src={stampUrl} alt="الختم الرسمي" crossOrigin="anonymous" style={{ maxWidth: '100%' }} />
          ) : showStamp && stampText ? (
            <div className="mf-stamp-e"><span>{stampText}</span></div>
          ) : showStamp ? (
            <ElectronicStamp orgName={sub?.org_name || 'الحملة'} docRef={docRef} />
          ) : null}
        </div>
      </footer>
    </article>
  )
}

/* ترتيب أبجدي لأماكن الركوب — يبقي «بلا مكان» في الآخر */
function sortBoardingPoints(arr) {
  return [...arr].sort((a, b) => {
    if (a === NO_BP && b !== NO_BP) return 1
    if (b === NO_BP && a !== NO_BP) return -1
    return a.localeCompare(b, 'ar')
  })
}

/**
 * الكشف الرسمي — جدول HTML حقيقي مدمج بالإعدادات.
 * كل باص يصدر كـarticle مستقل مع page-break بينهم.
 */
export default function Manifest({ trip, sub, passengers = [], buses = [], onClose }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [localSettings, setLocalSettings] = useState(null)

  const settings = localSettings || sub?.report_settings || {}

  const busManifests = useMemo(() => {
    const busList = buses.length > 0
      ? buses
      : [{ id: 'single', plate: trip?.bus_plate, label: trip?.bus_label, name: trip?.bus_label }]

    return busList.map((bus) => {
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
      const groups = bpKeys.map((bp) => ({
        bp,
        passengers: byBP.get(bp).sort((a, b) =>
          (a.full_name || '').localeCompare(b.full_name || '', 'ar')),
      }))

      return {
        key: busId,
        busLabel: busList.length === 1 && busId === 'single'
          ? (trip?.bus_label || '—')
          : busName(bus),
        busPlate: busList.length === 1 && busId === 'single'
          ? (trip?.bus_plate || '—')
          : (bus.plate || '—'),
        groups,
      }
    })
  }, [trip, passengers, buses])

  /* عدد مواقع الركوب */
  const allBPs = useMemo(() => {
    const s = new Set()
    for (const p of passengers) s.add((p.boarding_point || '').trim() || NO_BP)
    return s.size
  }, [passengers])

  /* الترقيم الكلي عبر كل الباصات */
  const starts = useMemo(() => {
    const arr = []
    let n = 1
    for (const bm of busManifests) {
      arr.push(n)
      n += bm.groups.reduce((s, g) => s + g.passengers.length, 0)
    }
    return arr
  }, [busManifests])

  function handlePrint() { window.print() }

  const showSummary = settings?.show_summary !== false

  return (
    <div className="manifest-overlay">
      <div className="manifest-toolbar no-print">
        <button className="btn btn-ghost btn-sm mf-btn" onClick={onClose} aria-label="رجوع">
          <Icon name="arrowRight" size={18} /> <span>رجوع</span>
        </button>
        {busManifests.length > 1 && (
          <span className="mf-toolbar-info">
            {busManifests.length} {busManifests.length === 2 ? 'باصان' : 'باصات'}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm mf-btn" onClick={() => setSettingsOpen(true)} title="إعدادات الكشف">
          <Icon name="settings" size={18} /> <span>إعدادات</span>
        </button>
        <button className="btn btn-em btn-sm mf-btn" onClick={handlePrint}>
          <Icon name="manifest" size={18} /> <span>طباعة / حفظ PDF</span>
        </button>
      </div>

      {/* شريط ملخّص */}
      {showSummary && (
        <SummaryBar
          passengers={passengers}
          capacity={trip?.capacity}
          bpCount={allBPs}
          settings={settings}
        />
      )}

      <div className="manifest-scroll">
        {passengers.length === 0 ? (
          <div className="mf-sheet mf-empty-state" dir="rtl">
            <Icon name="manifest" size={48} />
            <div>لا معتمرين مسجلين في هذه الرحلة</div>
          </div>
        ) : (
          busManifests.map((bm, idx) => (
            <BusManifest
              key={bm.key}
              trip={trip}
              sub={sub}
              settings={settings}
              busLabel={bm.busLabel}
              busPlate={bm.busPlate}
              groups={bm.groups}
              globalStart={starts[idx]}
              pageBreakBefore={idx > 0}
            />
          ))
        )}
      </div>

      {settingsOpen && (
        <ReportSettings
          sub={sub}
          settings={settings}
          onSave={(s) => { setLocalSettings(s); setSettingsOpen(false) }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
