import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { tableToDocx } from '../lib/docx'
import { useUI } from '../lib/useUI'
import { trace } from '../lib/debugLog'
import Icon from './Icon'
import RatingStars from './RatingStars'
import FinancialReport from './FinancialReport'

function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0 }
function dayKey(iso) { return iso ? iso.slice(0, 10) : '' }

/**
 * تحليلات الحملة المتقدمة — مؤشرات، منحنى زمني، نقاط الركوب الأكثر، ومقارنة الرحلات.
 * @param {Array}  trips
 * @param {object} byTrip   Map(trip_id -> {count, paid, boarded, checked_in})
 * @param {object} totals
 * @param {string} subscriberId   لجلب التفاصيل الزمنية ونقاط الركوب
 * @param {string} [org]          اسم الحملة لتبييض التقرير المصدر
 */
export default function CampaignAnalytics({ trips = [], byTrip, totals, subscriberId, org, sub }) {
  const { toast } = useUI()
  const [showReport, setShowReport] = useState(false)
  const tt = totals || { count: 0, paid: 0, boarded: 0, checked_in: 0 }
  const totalSeats = trips.reduce((s, t) => s + (Number(t.capacity) || 0), 0)
  const occupancy = pct(tt.count, totalSeats)
  const payRate = pct(tt.paid, tt.count)
  const boardRate = pct(tt.boarded, tt.count)
  const checkinRate = pct(tt.checked_in, tt.count)

  const bars = [
    { label: 'نسبة الإشغال', value: occupancy, sub: `${tt.count}/${totalSeats || '—'} مقعد`, cls: 'em' },
    { label: 'نسبة الدفع', value: payRate, sub: `${tt.paid} مدفوع`, cls: 'ok' },
    { label: 'نسبة الصعود', value: boardRate, sub: `${tt.boarded} صعد الباص`, cls: 'info' },
    { label: 'نسبة التسكين', value: checkinRate, sub: `${tt.checked_in} مسكن`, cls: 'warn' },
  ]

  // تفاصيل زمنية + نقاط الركوب + التحصيل — تحمل مرة عند تغير الحملة
  const [detail, setDetail] = useState({ daily: [], topBoarding: [], collected: 0, refunded: 0, refundPending: 0, refundPendingCount: 0 })
  const [loadErr, setLoadErr] = useState(false)
  // تقييم الحملة (المعتمرون → الحملة) — متوسط + عدد + أحدث التعليقات
  const [ratingSummary, setRatingSummary] = useState({ avg: 0, count: 0, recent: [] })
  useEffect(() => {
    if (!subscriberId) { setRatingSummary({ avg: 0, count: 0, recent: [] }); return }
    let cancel = false
    ;(async () => {
      const { data, error } = await supabase.from('ratings')
        .select('stars, comment, created_at')
        .eq('subscriber_id', subscriberId).eq('direction', 'customer_to_subscriber')
        .order('created_at', { ascending: false })
        .limit(500)
      if (cancel || error) return
      const rows = data || []
      const sum = rows.reduce((s, r) => s + (Number(r.stars) || 0), 0)
      const avg = rows.length ? sum / rows.length : 0
      const recent = rows.filter((r) => (r.comment || '').trim()).slice(0, 5)
      setRatingSummary({ avg, count: rows.length, recent })
    })()
    return () => { cancel = true }
  }, [subscriberId])
  useEffect(() => {
    let cancel = false
    if (!subscriberId) { setDetail({ daily: [], topBoarding: [], collected: 0, refunded: 0, refundPending: 0, refundPendingCount: 0 }); return }
    ;(async () => {
      setLoadErr(false)
      const since = new Date(Date.now() - 30 * 86400000).toISOString()
      const { data, error } = await trace('analytics:passengers', () => supabase
        .from('passengers').select('created_at, boarding_point, status')
        .eq('subscriber_id', subscriberId).gte('created_at', since).limit(2000))
      if (cancel) return
      // لا تظهر أصفارا مضللة عند فشل الجلب — ميز الخطأ بوضوح.
      if (error) { setLoadErr(true); return }
      const rows = data ?? []
      // منحنى زمني آخر ٣٠ يوم
      const buckets = new Map()
      const today = new Date(); today.setUTCHours(0, 0, 0, 0)
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today.getTime() - i * 86400000)
        buckets.set(d.toISOString().slice(0, 10), 0)
      }
      for (const r of rows) {
        const k = dayKey(r.created_at)
        if (buckets.has(k)) buckets.set(k, buckets.get(k) + 1)
      }
      const daily = Array.from(buckets, ([day, c]) => ({ day, c }))

      // أكثر نقاط الركوب
      const bp = new Map()
      for (const r of rows) {
        const k = (r.boarding_point || '—').trim() || '—'
        bp.set(k, (bp.get(k) || 0) + 1)
      }
      const topBoarding = [...bp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

      // التحصيل الكلي (كل الأوقات): مجموع مبالغ المدفوعين
      const { data: payRows } = await trace('analytics:payments', () => supabase
        .from('passengers').select('amount')
        .eq('subscriber_id', subscriberId)
        .in('status', ['paid', 'boarded', 'checked_in']))
      if (cancel) return
      const collected = (payRows ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0)

      // الاستردادات (المرحلة ٧): المعاد فعلا + المعلق بانتظار المعالجة
      const { data: refRows } = await trace('analytics:refunds', () => supabase
        .from('refunds').select('amount, status')
        .eq('subscriber_id', subscriberId).in('status', ['requested', 'refunded']))
      if (cancel) return
      const refunded = (refRows ?? []).filter((r) => r.status === 'refunded').reduce((s, r) => s + (Number(r.amount) || 0), 0)
      const pend = (refRows ?? []).filter((r) => r.status === 'requested')
      const refundPending = pend.reduce((s, r) => s + (Number(r.amount) || 0), 0)

      setDetail({ daily, topBoarding, collected, refunded, refundPending, refundPendingCount: pend.length })
    })()
    return () => { cancel = true }
  }, [subscriberId])

  // المتوقع = مجموع (سعر الرحلة × عدد مسجليها)
  const expectedRevenue = trips.reduce((s, t) => {
    const pr = t.price != null ? Number(t.price) : 0
    const c = byTrip?.get(t.id)?.count || 0
    return s + pr * c
  }, 0)
  const hasPricing = trips.some((t) => t.price != null)
  const money = (n) => Number(n || 0).toLocaleString('en-US')

  // تقرير مالي مخصص للحملة (Word) — أرقام لكل رحلة + إجماليات
  async function exportFinancial() {
    toast('جار تجهيز التقرير المالي…', { type: 'info' })
    try {
      const rows = trips.map((t) => {
        const e = byTrip?.get(t.id) || { count: 0, paid: 0 }
        const pr = t.price != null ? Number(t.price) : 0
        return [t.title || '—', String(t.capacity || 0), String(e.count), String(e.paid), money(pr * e.count)]
      })
      await tableToDocx({
        title: 'التقرير المالي للحملة',
        subtitle: org || '',
        org: org || '',
        meta: [
          `المحصل: ${money(detail.collected)} ﷼`,
          `المتوقع: ${money(expectedRevenue)} ﷼`,
          `المسترد: ${money(detail.refunded)} ﷼`,
          `الصافي بعد الاسترداد: ${money(detail.collected - detail.refunded)} ﷼`,
          detail.refundPending > 0 ? `طلبات استرداد معلقة: ${detail.refundPendingCount} بمبلغ ${money(detail.refundPending)} ﷼` : '',
        ].filter(Boolean),
        headers: ['الرحلة', 'السعة', 'المعتمرون', 'المدفوع', 'المتوقع (﷼)'],
        rows,
        filename: `تقرير-مالي-${(org || 'حملة').replace(/\s+/g, '_')}`,
      })
      toast('تم تنزيل التقرير المالي', { type: 'success' })
    } catch (e) { console.error(e); toast('تعذر إنشاء التقرير — حاول مجددا.', { type: 'error' }) }
  }

  const maxDaily = Math.max(1, ...detail.daily.map((d) => d.c))
  const last7 = detail.daily.slice(-7).reduce((s, d) => s + d.c, 0)
  const prev7 = detail.daily.slice(-14, -7).reduce((s, d) => s + d.c, 0)
  const trend = prev7 === 0 ? (last7 > 0 ? 100 : 0) : Math.round(((last7 - prev7) / prev7) * 100)

  const topBoardingMax = Math.max(1, ...detail.topBoarding.map(([, c]) => c))

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>المؤشرات الرئيسة</h3>
          <span className="sub">عبر {trips.length} رحلة</span>
        </div>

        {loadErr && (
          <div className="alert err" style={{ marginBottom: 10 }}>
            تعذر تحميل بعض التفاصيل (المنحنى الزمني والتحصيل) — قد تكون الأرقام أدناه غير مكتملة. حدث الصفحة.
          </div>
        )}

        {tt.count === 0 && totalSeats === 0 ? (
          <div className="empty"><div className="em-ttl">لا بيانات بعد</div><div>ستظهر المؤشرات فور إضافة الرحلات والمعتمرين.</div></div>
        ) : (
          <div className="an-bars">
            {bars.map((b) => (
              <div className="an-row" key={b.label}>
                <div className="an-head"><span>{b.label}</span><strong>{b.value}%</strong></div>
                <div className="bar"><span className={`fill-${b.cls}`} style={{ width: b.value + '%' }} /></div>
                <div className="an-sub">{b.sub}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {(hasPricing || detail.refunded > 0 || detail.refundPending > 0) && (
        <section className="panel">
          <div className="panel-head">
            <h3>التحصيل المالي</h3>
            <span className="sub">عبر الحملة</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-em btn-sm" onClick={() => setShowReport(true)} disabled={trips.length === 0}>
              <Icon name="manifest" size={14} /> تقرير PDF
            </button>
            <button className="btn btn-ghost btn-sm" onClick={exportFinancial} disabled={trips.length === 0}>
              <Icon name="edit" size={14} /> تقرير Word
            </button>
            {hasPricing && (
              <span className={`tag ${expectedRevenue > 0 && detail.collected >= expectedRevenue ? 'ok' : 'warn'}`}>
                {pct(detail.collected, expectedRevenue)}% محصل
              </span>
            )}
          </div>
          {hasPricing && (
            <div className="an-row" style={{ marginTop: 4 }}>
              <div className="an-head"><span>المحصل من المتوقع</span><strong>{money(detail.collected)} / {money(expectedRevenue)} ﷼</strong></div>
              <div className="bar"><span className="fill-ok" style={{ width: pct(detail.collected, expectedRevenue) + '%' }} /></div>
              <div className="an-sub">المتبقي: {money(Math.max(0, expectedRevenue - detail.collected))} ﷼</div>
            </div>
          )}
          <div className="stats" style={{ marginTop: 12 }}>
            <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={15} /></span>المحصل</div><div className="v" style={{ fontSize: 20 }}>{money(detail.collected)} <span style={{ fontSize: 12, color: 'var(--cr-300)' }}>﷼</span></div></div>
            <div className="stat"><div className="top"><span className="ic"><Icon name="trash" size={15} /></span>المسترد</div><div className="v" style={{ fontSize: 20 }}>{money(detail.refunded)} <span style={{ fontSize: 12, color: 'var(--cr-300)' }}>﷼</span></div></div>
            <div className="stat info"><div className="top"><span className="ic"><Icon name="badge" size={15} /></span>الصافي</div><div className="v" style={{ fontSize: 20 }}>{money(detail.collected - detail.refunded)} <span style={{ fontSize: 12, color: 'var(--cr-300)' }}>﷼</span></div></div>
          </div>
          {detail.refundPending > 0 && (
            <div className="alert warn" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="bell" size={16} />
              <span>{detail.refundPendingCount} طلب استرداد بانتظار المعالجة — بمبلغ {money(detail.refundPending)} ﷼. عالجها من «طلبات الاسترداد» داخل الرحلة.</span>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>منحنى التسجيلات</h3>
          <span className="sub">آخر ٣٠ يوما</span>
          <span style={{ flex: 1 }} />
          <span className={`tag ${trend >= 0 ? 'ok' : 'warn'}`}>
            {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% آخر ٧ أيام
          </span>
        </div>
        <div className="spark">
          {detail.daily.map((d) => (
            <div key={d.day} className="spark-bar" style={{ height: `${(d.c / maxDaily) * 100}%` }} title={`${d.day} · ${d.c}`} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--cr-300)', marginTop: 6 }}>
          <span>قبل ٣٠ يوما</span><span>اليوم</span>
        </div>
      </section>

      {ratingSummary.count > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>تقييم الحملة</h3>
            <span className="sub">من المعتمرين</span>
            <span style={{ flex: 1 }} />
            <RatingStars value={ratingSummary.avg} size={18} count={ratingSummary.count} />
          </div>
          {ratingSummary.recent.length > 0 && (
            <div className="rating-reviews">
              {ratingSummary.recent.map((r, i) => (
                <div className="rating-review" key={r.created_at || i}>
                  <RatingStars value={r.stars} size={14} />
                  <p>{r.comment}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {detail.topBoarding.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h3>أكثر نقاط الركوب طلبا</h3></div>
          <div className="an-bars">
            {detail.topBoarding.map(([name, c]) => (
              <div className="an-row" key={name}>
                <div className="an-head"><span>{name}</span><strong>{c}</strong></div>
                <div className="bar"><span className="fill-em" style={{ width: (c / topBoardingMax) * 100 + '%' }} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {trips.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h3>مقارنة الرحلات</h3></div>
          <div className="tbl-wrap">
            <table className="tbl tbl-cards">
              <thead><tr><th>الرحلة</th><th>الإشغال</th><th>مدفوع</th><th>صعد الباص</th><th>تسكين</th></tr></thead>
              <tbody>
                {trips.map((t) => {
                  const e = byTrip?.get(t.id) || { count: 0, paid: 0, boarded: 0, checked_in: 0 }
                  const cap = Number(t.capacity) || 0
                  return (
                    <tr key={t.id}>
                      <td data-label="الرحلة">{t.title || '—'}</td>
                      <td data-label="الإشغال">{e.count}/{cap || '—'} <span className="muted">({pct(e.count, cap)}%)</span></td>
                      <td data-label="مدفوع">{e.paid}</td>
                      <td data-label="صعد الباص">{e.boarded}</td>
                      <td data-label="تسكين">{e.checked_in}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showReport && (
        <FinancialReport trips={trips} byTrip={byTrip} sub={sub} onClose={() => setShowReport(false)} />
      )}
    </>
  )
}
