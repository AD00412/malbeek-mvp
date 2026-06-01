import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icon from '../../components/Icon'
import CompassMark from '../../components/CompassMark'
import PassengerFormModal, { PASSENGER_STATUS } from '../../components/PassengerFormModal'
import CrewFormModal from '../../components/CrewFormModal'
import Manifest from '../../components/Manifest'

const STATUS_AR = { registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة' }
const STATUS_CLS = { registered: 'muted', paid: 'ok', boarded: 'info', checked_in: 'warn' }

function fmt(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return '—' }
}

/**
 * شاشة إدارة رحلةٍ واحدة: المعتمرون + المقاعد + الطاقم + الكشف الرسمي.
 * @param {object} trip
 * @param {object} sub      بيانات المؤسسة
 * @param {Function} onBack
 * @param {Function} onTripChanged  لإعادة تحميل قائمة الرحلات في الأب عند تغيّر الطاقم
 */
export default function TripManage({ trip: initialTrip, sub, onBack, onTripChanged }) {
  const [trip, setTrip] = useState(initialTrip)
  const [passengers, setPassengers] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')

  const [paxOpen, setPaxOpen] = useState(false)
  const [editingPax, setEditingPax] = useState(null)
  const [crewOpen, setCrewOpen] = useState(false)
  const [manifestOpen, setManifestOpen] = useState(false)

  const loadPassengers = useCallback(async () => {
    if (!trip?.id) return
    setLoading(true); setErr('')
    const { data, error } = await supabase
      .from('passengers')
      .select('id, full_name, national_id, phone, nationality, seat_no, boarding_point, status, notes, created_at')
      .eq('trip_id', trip.id)
      .order('seat_no', { ascending: true, nullsFirst: false })
    if (error) setErr('تعذّر تحميل المعتمرين: ' + error.message)
    else setPassengers(data ?? [])
    setLoading(false)
  }, [trip])

  const reloadTrip = useCallback(async () => {
    if (!trip?.id) return
    const { data } = await supabase.from('trips').select('*').eq('id', trip.id).maybeSingle()
    if (data) setTrip(data)
    onTripChanged?.()
  }, [trip, onTripChanged])

  useEffect(() => { loadPassengers() }, [loadPassengers])

  function openAdd() { setEditingPax(null); setPaxOpen(true) }
  function openEdit(p) { setEditingPax(p); setPaxOpen(true) }

  async function removePax(p) {
    if (!p?.id) return
    if (!window.confirm(`حذف «${p.full_name}» من الكشف؟`)) return
    const { error } = await supabase.from('passengers').delete().eq('id', p.id)
    if (error) { setErr('تعذّر الحذف: ' + error.message); return }
    loadPassengers()
  }

  const cap = Number(trip?.capacity) || 0
  const count = passengers.length
  const paid = passengers.filter((p) => p.status === 'paid' || p.status === 'boarded' || p.status === 'checked_in').length
  const boarded = passengers.filter((p) => p.status === 'boarded' || p.status === 'checked_in').length
  const pct = cap > 0 ? Math.min(100, Math.round((count / cap) * 100)) : 0

  const q = search.trim().toLowerCase()
  const filtered = q
    ? passengers.filter((p) => [p.full_name, p.national_id, p.phone, p.seat_no, p.boarding_point]
        .filter(Boolean).join(' ').toLowerCase().includes(q))
    : passengers

  if (manifestOpen) {
    return <Manifest trip={trip} sub={sub} passengers={passengers} onClose={() => setManifestOpen(false)} />
  }

  return (
    <>
      {/* رأس الشاشة */}
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 6 }}>
        <Icon name="arrowRight" size={16} /> رجوع للرحلات
      </button>

      <section className="hero">
        <div className="tags">
          <span className="tag gold">عمرة</span>
          <span className="tag muted">{trip?.bus_label || 'بدون باص'}</span>
        </div>
        <h2 style={{ marginTop: 8 }}>{trip?.title || 'رحلة'}</h2>
        <p>{(trip?.route_from || '—') + ' ← ' + (trip?.route_to || '—')} · {fmt(trip?.depart_at)}</p>
      </section>

      <div className="stats">
        <div className="stat"><div className="top"><span className="ic"><Icon name="customers" size={15} /></span>المسجّلون</div><div className="v">{count}{cap ? <span style={{ fontSize: 16, color: 'var(--cr-300)' }}>/{cap}</span> : null}</div></div>
        <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={15} /></span>مدفوع</div><div className="v">{paid}</div></div>
        <div className="stat info"><div className="top"><span className="ic"><Icon name="bus" size={15} /></span>صعدوا</div><div className="v">{boarded}</div></div>
        <div className="stat warn"><div className="top"><span className="ic"><Icon name="seat" size={15} /></span>الإشغال</div><div className="v">{pct}%</div></div>
      </div>

      {/* أزرار الإجراءات */}
      <div className="actions" style={{ marginTop: 16 }}>
        <button className="action primary" onClick={openAdd}><Icon name="plus" size={18} /> إضافة معتمر</button>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="action" style={{ flex: 1 }} onClick={() => setCrewOpen(true)}>
            <Icon name="bus" size={18} /> الباص والطاقم
          </button>
          <button className="action ok" style={{ flex: 1 }} onClick={() => setManifestOpen(true)}>
            <Icon name="manifest" size={18} /> الكشف الرسمي
          </button>
        </div>
      </div>

      {err && <div className="alert err" style={{ marginTop: 14 }}>{err}</div>}

      {/* قائمة المعتمرين */}
      <section className="panel">
        <div className="panel-head">
          <h3>المعتمرون</h3><span className="sub">({count})</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-gold btn-sm" onClick={openAdd}><Icon name="plus" size={16} /> إضافة</button>
        </div>

        <div className="field search" style={{ marginBottom: 4 }}>
          <span className="ic"><Icon name="search" size={17} /></span>
          <input type="text" placeholder="بحث: اسم / هوية / جوال / مقعد" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {loading ? (
          <div className="empty"><div className="em-mark"><CompassMark size={48} /></div>جارٍ التحميل…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <div className="em-mark"><CompassMark size={52} /></div>
            <div className="em-ttl">{count === 0 ? 'لا يوجد معتمرون بعد' : 'لا نتائج للبحث'}</div>
            <div>{count === 0 ? 'أضف أوّل معتمرٍ ليظهر في الكشف الرسمي.' : 'جرّب كلمةً أخرى.'}</div>
          </div>
        ) : (
          <div className="pax-list">
            {filtered.map((p, i) => (
              <div className="pax-row" key={p.id}>
                <div className="pax-seat">{p.seat_no || (i + 1)}</div>
                <div className="pax-main">
                  <div className="pax-name">{p.full_name}</div>
                  <div className="pax-meta">
                    <span className="ltr">{p.national_id || '—'}</span>
                    <span>·</span>
                    <span className="ltr">{p.phone || '—'}</span>
                    {p.boarding_point && <><span>·</span><span>{p.boarding_point}</span></>}
                  </div>
                </div>
                <span className={`st ${STATUS_CLS[p.status] || 'muted'}`}>{STATUS_AR[p.status] || p.status}</span>
                <div className="pax-actions">
                  <button className="icon-btn" onClick={() => openEdit(p)} aria-label="تعديل"><Icon name="edit" size={15} /></button>
                  <button className="icon-btn danger" onClick={() => removePax(p)} aria-label="حذف"><Icon name="trash" size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <PassengerFormModal
        open={paxOpen}
        passenger={editingPax}
        tripId={trip?.id}
        subscriberId={sub?.id}
        defaultBoarding={trip?.boarding_point}
        onClose={() => setPaxOpen(false)}
        onSaved={() => { setPaxOpen(false); loadPassengers() }}
      />

      <CrewFormModal
        open={crewOpen}
        trip={trip}
        sub={sub}
        onClose={() => setCrewOpen(false)}
        onSaved={() => { setCrewOpen(false); reloadTrip() }}
      />
    </>
  )
}
