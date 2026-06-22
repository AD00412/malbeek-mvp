import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'

/**
 * برجُ تحكّم الباصات — لإدارة ملبّيك (الأدمن فقط).
 * نظرةٌ لحظيّةٌ على أسطول الباصات عبر كلّ الحملات: الإشغال، حالةُ الصعود،
 * وتنبيهاتٌ تشغيليّة (باصٌ بلا سائق / مقاعدُ ناقصة / رحلةٌ بلا باص / تعارضُ لوحة).
 * أرقامٌ حقيقيّةٌ من admin_bus_fleet() (security definer، أدمن فقط).
 */
const STATUS_AR = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', done: 'منتهية' }
const fmtDate = (v) => { if (!v) return '—'; try { return new Date(v).toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit' }) } catch { return '—' } }

export default function AdminBusTower() {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true); setErr('')
      const { data, error } = await supabase.rpc('admin_bus_fleet')
      if (!alive) return
      if (error) setErr('تعذّر تحميل الأسطول: ' + (error.message || ''))
      setRows(data || []); setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  const m = useMemo(() => {
    const fleet = rows || []
    // تعارضُ اللوحات: نفسُ اللوحة على أكثر من رحلةٍ نشطة
    const plateCount = new Map()
    for (const b of fleet) { const pl = (b.bus_plate || '').trim(); if (pl && pl !== '—') plateCount.set(pl, (plateCount.get(pl) || 0) + 1) }

    let totalSeats = 0, totalSeated = 0, totalPax = 0, alertsTotal = 0
    const enriched = fleet.map((b) => {
      const cap = Number(b.capacity) || 0
      const seated = Number(b.seated) || 0
      const pax = Number(b.pax) || 0
      const occ = cap > 0 ? Math.round((seated / cap) * 100) : 0
      const issues = []
      if (cap === 0) issues.push('رحلةٌ بلا باصٍ مُعرَّف')
      if (!b.has_driver) issues.push('بلا سائق')
      if (pax > seated) issues.push(`${pax - seated} بلا مقعد`)
      if (cap > 0 && pax > cap) issues.push('تجاوزُ السعة')
      if ((b.bus_plate || '').trim() && plateCount.get((b.bus_plate || '').trim()) > 1) issues.push('تعارضُ لوحة')
      totalSeats += cap; totalSeated += seated; totalPax += pax; alertsTotal += issues.length
      return { ...b, cap, seated, pax, occ, issues }
    })
    // الأكثرُ إلحاحًا أولًا: ذواتُ التنبيهات ثم الأقربُ موعدًا
    enriched.sort((a, b) => (b.issues.length - a.issues.length) || (new Date(a.depart_at || 0) - new Date(b.depart_at || 0)))
    const occRate = totalSeats > 0 ? Math.round((totalSeated / totalSeats) * 100) : 0
    return { fleet: enriched, count: fleet.length, totalSeats, totalSeated, totalPax, occRate, alertsTotal }
  }, [rows])

  if (loading) return <SkeletonList count={4} />
  if (err) return <div className="alert err">{err}</div>

  return (
    <div className="ops" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* لوحةُ المؤشّرات اللحظيّة */}
      <section className="mlk-card">
        <h2 className="mlk-h2"><Icon name="trips" size={16} /> برجُ تحكّم الباصات — كلُّ الحملات</h2>
        <div className="stats">
          <div className="stat"><div className="top">باصات نشطة</div><div className="v">{m.count}</div></div>
          <div className="stat info"><div className="top">مقاعد مُسنَدة</div><div className="v">{m.totalSeated}/{m.totalSeats}</div></div>
          <div className="stat ok"><div className="top">الإشغال</div><div className="v">{m.occRate}٪</div></div>
          <div className={`stat ${m.alertsTotal > 0 ? 'warn' : ''}`}><div className="top">تنبيهات</div><div className="v">{m.alertsTotal}</div></div>
        </div>
      </section>

      {/* الأسطول */}
      {m.fleet.length === 0 ? (
        <div className="mlk-empty">لا باصاتٍ نشطةٍ حاليًّا.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {m.fleet.map((b) => (
            <li key={b.unit_key} className="mlk-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Icon name="trips" size={16} />
                <strong>{b.bus_label || 'الباص'}</strong>
                {b.bus_plate && b.bus_plate !== '—' && <span className="badge muted ltr">{b.bus_plate}</span>}
                <span className="badge info">{STATUS_AR[b.trip_status] || b.trip_status}</span>
                <span className="muted" style={{ marginInlineStart: 'auto', fontSize: 12 }}>{b.org_name} · {fmtDate(b.depart_at)}</span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>{b.trip_title}</div>

              {/* شريطُ الإشغال */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 8, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, b.occ)}%`, height: '100%', background: b.occ >= 100 ? 'var(--em-600)' : 'var(--em-500)' }} />
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--cr-100)', whiteSpace: 'nowrap' }}>{b.seated}/{b.cap || '—'} مقعد</span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12.5 }}>
                <span className="badge">المعتمرون: {b.pax}</span>
                <span className="badge info">صَعِد: {b.boarded}</span>
                <span className="badge ok">استلم الغرفة: {b.checked_in}</span>
                <span className={`badge ${b.has_driver ? 'ok' : 'warn'}`}>{b.has_driver ? 'سائقٌ مُسنَد' : 'بلا سائق'}</span>
              </div>

              {b.issues.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {b.issues.map((is, i) => <span key={i} className="badge warn">⚠ {is}</span>)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
