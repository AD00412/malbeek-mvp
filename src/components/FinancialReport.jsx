import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { PAID_STATUSES } from '../lib/passengerStatus'

function fmtGreg(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' }) }
  catch { return '—' }
}
function fmtHijri(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA-u-ca-islamic-umalqura', { year: 'numeric', month: '2-digit', day: '2-digit' }) }
  catch { return '—' }
}
function money(n) { return Number(n || 0).toLocaleString('en-US') }
function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0 }

/**
 * تقرير مالي شامل مطبوع — بهوية الكشف الرسمي.
 *   ١) ترويسة بشعار الحملة + المدة + خلاصة مالية كبيرة
 *   ٢) ٤ بطاقات رئيسة (المحصل/المتوقع/المسترد/الصافي)
 *   ٣) جدول تفصيل لكل رحلة: السعر، المسجلون، المدفوعون،
 *      المحصل الفعلي، المتوقع، المتبقي، نسبة التحصيل
 *   ٤) تذييل بالختم/التوقيع — يبقى على نفس الصفحة دائما
 */
export default function FinancialReport({ trips = [], byTrip, sub, onClose }) {
  const [paymentsByTrip, setPaymentsByTrip] = useState(new Map()) // trip_id → collected amount
  const [expectedByTrip, setExpectedByTrip] = useState(new Map()) // trip_id → مجموع السعر المثبت وقت الحجز
  const [refunds, setRefunds] = useState({ refunded: 0, pending: 0, count: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!sub?.id) { setLoading(false); return }
    let cancel = false
    ;(async () => {
      // سعر الرحلة الحالي (احتياط للصفوف بلا price_at_booking مثبت)
      const tripPrice = new Map((trips || []).map((t) => [t.id, t.price != null ? Number(t.price) : 0]))
      // كل معتمري الحملة: المحصل (amount للمدفوعين) + المتوقع (السعر المثبت وقت الحجز)
      const { data: rows } = await supabase
        .from('passengers')
        .select('trip_id, amount, price_at_booking, status')
        .eq('subscriber_id', sub.id)
      if (cancel) return
      const m = new Map()        // collected
      const exp = new Map()      // expected (مجموع السعر المثبت لكل معتمر)
      for (const r of rows || []) {
        if (PAID_STATUSES.includes(r.status)) {
          m.set(r.trip_id, (m.get(r.trip_id) || 0) + (Number(r.amount) || 0))
        }
        // المتوقع = ما يلتزم به كل معتمر بسعره المثبت (أو سعر الرحلة الحالي احتياطا)
        const seat = r.price_at_booking != null ? Number(r.price_at_booking) : (tripPrice.get(r.trip_id) || 0)
        exp.set(r.trip_id, (exp.get(r.trip_id) || 0) + seat)
      }
      setPaymentsByTrip(m)
      setExpectedByTrip(exp)

      // الاستردادات
      const { data: refs } = await supabase
        .from('refunds').select('amount, status')
        .eq('subscriber_id', sub.id).in('status', ['requested','refunded'])
      if (cancel) return
      const refundedSum = (refs || []).filter(r => r.status === 'refunded').reduce((s, r) => s + (Number(r.amount) || 0), 0)
      const pendArr = (refs || []).filter(r => r.status === 'requested')
      const pendSum = pendArr.reduce((s, r) => s + (Number(r.amount) || 0), 0)
      setRefunds({ refunded: refundedSum, pending: pendSum, count: pendArr.length })
      setLoading(false)
    })()
    return () => { cancel = true }
  }, [sub?.id])

  // تفصيل لكل رحلة
  const tripRows = useMemo(() => trips.map(t => {
    const e = byTrip?.get(t.id) || { count: 0, paid: 0 }
    const price = t.price != null ? Number(t.price) : 0
    // المتوقع من السعر المثبت وقت الحجز (دقة تاريخية)؛ وإن لم يحمل بعد
    // فاحتياط بالسعر الحالي × المسجلين (سلوك سابق).
    const expSum = expectedByTrip.get(t.id)
    const expected = expSum != null ? expSum : price * e.count
    const collected = paymentsByTrip.get(t.id) || 0
    const outstanding = Math.max(0, expected - collected)
    return {
      id: t.id, title: t.title || '—', depart_at: t.depart_at,
      capacity: t.capacity || 0,
      registered: e.count, paid: e.paid, price,
      expected, collected, outstanding,
      collectRate: pct(collected, expected),
    }
  }), [trips, byTrip, paymentsByTrip, expectedByTrip])

  const totals = useMemo(() => {
    const expected = tripRows.reduce((s, r) => s + r.expected, 0)
    const collected = tripRows.reduce((s, r) => s + r.collected, 0)
    const outstanding = tripRows.reduce((s, r) => s + r.outstanding, 0)
    const net = collected - refunds.refunded
    return { expected, collected, outstanding, net }
  }, [tripRows, refunds])

  const today = new Date()
  function handlePrint() { window.print() }

  return (
    <div className="manifest-overlay">
      <div className="manifest-toolbar no-print">
        <button className="btn btn-ghost btn-sm mf-btn" onClick={onClose} aria-label="رجوع">
          <Icon name="arrowRight" size={18} /> <span>رجوع</span>
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-em btn-sm mf-btn" onClick={handlePrint}>
          <Icon name="manifest" size={18} /> <span>طباعة / حفظ PDF</span>
        </button>
      </div>

      <div className="manifest-scroll">
        <article className="mf-sheet fr-sheet" dir="rtl">
          {/* ترويسة */}
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
              <div className="mf-c-row"><span className="mf-c-k">نوع التقرير</span><span className="mf-c-v">تقرير مالي شامل للحملة</span></div>
              <div className="mf-c-row"><span className="mf-c-k">عدد الرحلات</span><span className="mf-c-v">{trips.length}</span></div>
              <div className="mf-c-row"><span className="mf-c-k">تاريخ الإصدار</span><span className="mf-c-v" dir="ltr">{fmtGreg(today)} · {fmtHijri(today)}</span></div>
            </div>
          </header>

          <div className="mf-subtitle">
            <div className="mf-st-main">التقرير المالي لحملة {sub?.org_name || ''}</div>
          </div>

          {/* خلاصة كبيرة — ٤ بطاقات */}
          <div className="fr-kpis">
            <div className="fr-kpi">
              <div className="fr-kpi-lb">المحصل الفعلي</div>
              <div className="fr-kpi-num">{money(totals.collected)} <span>﷼</span></div>
            </div>
            <div className="fr-kpi">
              <div className="fr-kpi-lb">المتوقع</div>
              <div className="fr-kpi-num">{money(totals.expected)} <span>﷼</span></div>
              <div className="fr-kpi-sub">نسبة التحصيل: {totals.expected > 0 ? pct(totals.collected, totals.expected) + '٪' : '—'}</div>
            </div>
            <div className="fr-kpi">
              <div className="fr-kpi-lb">المتبقي</div>
              <div className="fr-kpi-num">{money(totals.outstanding)} <span>﷼</span></div>
            </div>
            <div className="fr-kpi fr-kpi-net">
              <div className="fr-kpi-lb">الصافي بعد الاسترداد</div>
              <div className="fr-kpi-num">{money(totals.net)} <span>﷼</span></div>
              {refunds.refunded > 0 && <div className="fr-kpi-sub">مسترد: {money(refunds.refunded)} ﷼</div>}
            </div>
          </div>

          {refunds.pending > 0 && (
            <div className="fr-alert">
              ⚠️ {refunds.count} طلب استرداد بانتظار المعالجة — بمبلغ {money(refunds.pending)} ﷼
            </div>
          )}

          {/* جدول التفصيل */}
          <table className="mf-table fr-table">
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>م</th>
                <th>الرحلة</th>
                <th>تاريخ الذهاب</th>
                <th>السعة</th>
                <th>مسجل</th>
                <th>السعر (﷼)</th>
                <th>المتوقع (﷼)</th>
                <th>المحصل (﷼)</th>
                <th>التحصيل ٪</th>
              </tr>
            </thead>
            <tbody>
              {tripRows.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '8mm', color: '#7a8a82', fontStyle: 'italic' }}>لا رحلات بعد</td></tr>
              ) : tripRows.map((r, i) => (
                <tr key={r.id}>
                  <td className="mf-num">{i + 1}</td>
                  <td className="mf-name">{r.title}</td>
                  <td className="ltr">{fmtGreg(r.depart_at)}</td>
                  <td className="mf-num">{r.capacity || '—'}</td>
                  <td className="mf-num">{r.registered}</td>
                  <td className="mf-num">{r.price ? money(r.price) : '—'}</td>
                  <td className="mf-num">{money(r.expected)}</td>
                  <td className="mf-num" style={{ color: '#0b5c43', fontWeight: 700 }}>{money(r.collected)}</td>
                  <td className="mf-num">{r.expected > 0 ? r.collectRate + '٪' : '—'}</td>
                </tr>
              ))}
              {tripRows.length > 0 && (
                <tr className="fr-totals">
                  <td colSpan={6} style={{ textAlign: 'end', fontWeight: 700 }}>الإجمالي</td>
                  <td className="mf-num" style={{ fontWeight: 700 }}>{money(totals.expected)}</td>
                  <td className="mf-num" style={{ fontWeight: 700, color: '#0b5c43' }}>{money(totals.collected)}</td>
                  <td className="mf-num" style={{ fontWeight: 700 }}>{totals.expected > 0 ? pct(totals.collected, totals.expected) + '٪' : '—'}</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* تذييل */}
          <footer className="mf-foot">
            <div className="mf-note">
              تقرير مالي صادر عن {sub?.org_name || 'الحملة'} · {fmtGreg(today)}
              <br />
              <span style={{ fontSize: '7pt', color: '#7a8a82' }}>
                الأرقام محتسبة من قاعدة بيانات ملبّيك. المحصل = مجموع مبالغ المدفوعين/الصاعدين/المسكنين.
              </span>
            </div>
            <div className="mf-stamp">
              {sub?.stamp_url ? (
                <img className="mf-stamp-img" src={sub.stamp_url} alt="الختم الرسمي" crossOrigin="anonymous" />
              ) : sub?.stamp_text ? (
                <div className="mf-stamp-e"><span>{sub.stamp_text}</span></div>
              ) : (
                <div className="mf-stamp-m">الختم والتوقيع</div>
              )}
            </div>
          </footer>
        </article>
      </div>
    </div>
  )
}
