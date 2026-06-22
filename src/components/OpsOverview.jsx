import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'

/**
 * لوحة العمليات لصاحب الحملة — «طراز التحكم».
 * نظرة موحدة حية: نبض مالي + إشغال المقاعد والفنادق + عدادات الحالات
 * + تنبيهات تشغيلية قابلة للتنفيذ (رحلات بلا تسكين / مقاعد ناقصة / دفع معلق).
 * أرقام حقيقية من القاعدة (استعلامان فقط: passengers + hotel_rooms).
 *
 * @param {object}   sub        { id, ... }
 * @param {object[]} trips      رحلات الحملة (من الأب)
 * @param {Function} onManage   فتح إدارة رحلة بعينها
 */
const money = (n) => Number(n || 0).toLocaleString('en-US')
const PAID = ['paid', 'boarded', 'checked_in']

function daysTo(iso) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

export default function OpsOverview({ sub, trips = [], onManage }) {
  const [pax, setPax] = useState(null)      // صفوف المعتمرين
  const [rooms, setRooms] = useState([])    // غرف الفنادق
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!sub?.id) { setLoading(false); return }
    let alive = true
    ;(async () => {
      setLoading(true)
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from('passengers')
          .select('trip_id, status, seat_no, room_id, amount, price_at_booking')
          .eq('subscriber_id', sub.id),
        supabase.from('hotel_rooms').select('trip_id, capacity').eq('subscriber_id', sub.id),
      ])
      if (!alive) return
      setPax(p || []); setRooms(r || []); setLoading(false)
    })()
    return () => { alive = false }
  }, [sub?.id])

  const m = useMemo(() => {
    const rows = pax || []
    const tripById = new Map(trips.map((t) => [t.id, t]))
    const roomTrips = new Set(rooms.map((r) => r.trip_id))
    const roomsCapacity = rooms.reduce((s, r) => s + (Number(r.capacity) || 0), 0)

    let expected = 0, collected = 0
    const status = { registered: 0, paid: 0, boarded: 0, checked_in: 0 }
    let seated = 0, roomed = 0
    for (const p of rows) {
      const t = tripById.get(p.trip_id)
      const seat = p.price_at_booking != null ? Number(p.price_at_booking) : (t?.price != null ? Number(t.price) : 0)
      expected += seat
      if (PAID.includes(p.status)) collected += Number(p.amount) || 0
      if (p.status in status) status[p.status]++
      if (p.seat_no) seated++
      if (p.room_id) roomed++
    }
    const outstanding = Math.max(0, expected - collected)
    const collectRate = expected > 0 ? Math.round((collected / expected) * 100) : null
    const total = rows.length

    // تنبيهات تشغيلية للرحلات القادمة (مفتوحة/مسودة، لم يفت موعدها)
    const now = Date.now()
    const byTrip = new Map()
    for (const p of rows) {
      const a = byTrip.get(p.trip_id) || { count: 0, unpaid: 0, unseated: 0, unroomed: 0 }
      a.count++
      if (p.status === 'registered') a.unpaid++
      if (!p.seat_no) a.unseated++
      if (!p.room_id) a.unroomed++
      byTrip.set(p.trip_id, a)
    }
    const alerts = []
    for (const t of trips) {
      const upcoming = t.depart_at && new Date(t.depart_at).getTime() > now && t.status !== 'done' && t.status !== 'closed'
      if (!upcoming) continue
      const a = byTrip.get(t.id)
      if (!a || a.count === 0) continue
      const issues = []
      if (a.unpaid > 0) issues.push({ tone: 'warn', text: `${a.unpaid} بانتظار الدفع` })
      if (a.unseated > 0) issues.push({ tone: 'info', text: `${a.unseated} بلا مقعد` })
      if (roomTrips.has(t.id)) {
        if (a.unroomed > 0) issues.push({ tone: 'info', text: `${a.unroomed} بلا تسكين` })
      } else {
        issues.push({ tone: 'muted', text: 'لا فنادق مضافة' })
      }
      if (issues.length) alerts.push({ trip: t, days: daysTo(t.depart_at), issues })
    }
    alerts.sort((x, y) => (x.days ?? 1e9) - (y.days ?? 1e9))

    return { expected, collected, outstanding, collectRate, status, total, seated, roomed, roomsCapacity, roomsCount: rooms.length, alerts }
  }, [pax, rooms, trips])

  if (loading) return <SkeletonList count={4} />

  return (
    <div className="ops" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ١) النبض المالي */}
      <section className="mlk-card">
        <h2 className="mlk-h2"><Icon name="payments" size={16} /> النبض المالي</h2>
        <div className="stats">
          <div className="stat ok"><div className="top">المحصل</div><div className="v">{money(m.collected)} <span style={{ fontSize: 12 }}>﷼</span></div></div>
          <div className="stat"><div className="top">المتوقع</div><div className="v">{money(m.expected)} <span style={{ fontSize: 12 }}>﷼</span></div></div>
          <div className="stat warn"><div className="top">المتبقي</div><div className="v">{money(m.outstanding)} <span style={{ fontSize: 12 }}>﷼</span></div></div>
          <div className="stat info"><div className="top">نسبة التحصيل</div><div className="v">{m.collectRate == null ? '—' : m.collectRate + '٪'}</div></div>
        </div>
      </section>

      {/* ٢) المعتمرون بالحالات */}
      <section className="mlk-card">
        <h2 className="mlk-h2"><Icon name="customers" size={16} /> المعتمرون ({m.total})</h2>
        <div className="stats">
          <div className="stat"><div className="top">مسجل</div><div className="v">{m.status.registered}</div></div>
          <div className="stat ok"><div className="top">مدفوع</div><div className="v">{m.status.paid}</div></div>
          <div className="stat info"><div className="top">صعد</div><div className="v">{m.status.boarded}</div></div>
          <div className="stat warn"><div className="top">استلم الغرفة</div><div className="v">{m.status.checked_in}</div></div>
        </div>
      </section>

      {/* ٣) الإشغال — مقاعد وفنادق */}
      <section className="mlk-card">
        <h2 className="mlk-h2"><Icon name="seat" size={16} /> الإشغال</h2>
        <div className="stats">
          <div className="stat info"><div className="top"><Icon name="seat" size={13} /> مقاعد مسندة</div><div className="v">{m.seated}/{m.total}</div></div>
          <div className="stat"><div className="top"><Icon name="bed" size={13} /> غرف الفنادق</div><div className="v">{m.roomsCount}</div></div>
          <div className="stat ok"><div className="top"><Icon name="bed" size={13} /> مسكنون</div><div className="v">{m.roomed}{m.roomsCapacity > 0 ? `/${m.roomsCapacity}` : ''}</div></div>
        </div>
      </section>

      {/* ٤) التنبيهات التشغيلية */}
      <section className="mlk-card">
        <h2 className="mlk-h2"><Icon name="bell" size={16} /> تنبيهات تشغيلية</h2>
        {m.alerts.length === 0 ? (
          <div className="muted" style={{ padding: '8px 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="check" size={15} /> كل الرحلات القادمة جاهزة — لا تنبيهات.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {m.alerts.map(({ trip, days, issues }) => (
              <li key={trip.id} className="ops-alert" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10 }}>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--cr-50)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{trip.title || 'رحلة'}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{days != null ? (days === 0 ? 'تنطلق اليوم' : `بعد ${days} يوم`) : '—'}</div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {issues.map((is, i) => <span key={i} className={`badge ${is.tone}`}>{is.text}</span>)}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => onManage?.(trip)}>إدارة</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
