import Icon from './Icon'

function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0 }

/**
 * تحليلات الحملة — مؤشّراتٌ حقيقيّةٌ محسوبةٌ من الرحلات والمعتمرين.
 * @param {Array}  trips
 * @param {object} byTrip   Map(trip_id -> {count, paid, boarded, checked_in})
 * @param {object} totals   { count, paid, boarded, checked_in }
 */
export default function CampaignAnalytics({ trips = [], byTrip, totals }) {
  const tt = totals || { count: 0, paid: 0, boarded: 0, checked_in: 0 }
  const totalSeats = trips.reduce((s, t) => s + (Number(t.capacity) || 0), 0)
  const occupancy = pct(tt.count, totalSeats)
  const payRate = pct(tt.paid, tt.count)
  const boardRate = pct(tt.boarded, tt.count)
  const checkinRate = pct(tt.checked_in, tt.count)

  const bars = [
    { label: 'نسبة الإشغال', value: occupancy, sub: `${tt.count}/${totalSeats || '—'} مقعد`, cls: 'em' },
    { label: 'نسبة الدفع', value: payRate, sub: `${tt.paid} مدفوع`, cls: 'ok' },
    { label: 'نسبة الصعود', value: boardRate, sub: `${tt.boarded} صعدوا`, cls: 'info' },
    { label: 'نسبة التسكين', value: checkinRate, sub: `${tt.checked_in} مُسكّن`, cls: 'warn' },
  ]

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>تحليلات الحملة</h3>
        <span className="sub">عبر {trips.length} رحلة</span>
      </div>

      {tt.count === 0 && totalSeats === 0 ? (
        <div className="empty"><div className="em-ttl">لا بيانات بعد</div><div>ستظهر المؤشّرات فور إضافة الرحلات والمعتمرين.</div></div>
      ) : (
        <>
          <div className="an-bars">
            {bars.map((b) => (
              <div className="an-row" key={b.label}>
                <div className="an-head"><span>{b.label}</span><strong>{b.value}%</strong></div>
                <div className="bar"><span className={`fill-${b.cls}`} style={{ width: b.value + '%' }} /></div>
                <div className="an-sub">{b.sub}</div>
              </div>
            ))}
          </div>

          {trips.length > 0 && (
            <div className="tbl-wrap" style={{ marginTop: 16 }}>
              <table className="tbl">
                <thead><tr><th>الرحلة</th><th>الإشغال</th><th>مدفوع</th><th>صعدوا</th></tr></thead>
                <tbody>
                  {trips.map((t) => {
                    const e = byTrip?.get(t.id) || { count: 0, paid: 0, boarded: 0 }
                    const cap = Number(t.capacity) || 0
                    return (
                      <tr key={t.id}>
                        <td>{t.title || '—'}</td>
                        <td>{e.count}/{cap || '—'} <span className="muted">({pct(e.count, cap)}%)</span></td>
                        <td>{e.paid}</td>
                        <td>{e.boarded}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
