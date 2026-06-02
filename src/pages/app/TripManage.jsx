import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icon from '../../components/Icon'
import CompassMark from '../../components/CompassMark'
import PassengerFormModal, { PASSENGER_STATUS } from '../../components/PassengerFormModal'
import CrewFormModal from '../../components/CrewFormModal'
import Manifest from '../../components/Manifest'
import SeatMap from '../../components/SeatMap'
import BusEditor from '../../components/BusEditor'
import BottomSheet from '../../components/BottomSheet'
import { policyLabel } from '../../lib/busLayout'
import { loadTripBuses, busLayout, busName } from '../../lib/buses'

// تحميلٌ كسولٌ — الماسح والتذكرة خارج الحزمة الأساسية (والتذكرة تُحمّل qrcode عند الحاجة)
const Ticket = lazy(() => import('../../components/Ticket'))
const Scanner = lazy(() => import('../../components/Scanner'))

/* غلافٌ بسيطٌ بانتظار تحميل المكوّن الكسول */
function LazyLoading() {
  return (
    <div className="manifest-overlay" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="sl-mark"><CompassMark size={64} /></div>
    </div>
  )
}

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
  const [ticketFor, setTicketFor] = useState(null)   // المعتمر لعرض تذكرته
  const [scanMode, setScanMode] = useState(null)     // 'board' | 'checkin' | null
  const [seatMapOpen, setSeatMapOpen] = useState(false)
  const [busEditOpen, setBusEditOpen] = useState(false)
  const [offersOpen, setOffersOpen] = useState(false)
  const [offerMsg, setOfferMsg] = useState('')
  const [waitlist, setWaitlist] = useState([])
  const [buses, setBuses] = useState([])
  const [mapBusId, setMapBusId] = useState(null)   // الباص المعروض في خريطة المقاعد

  const loadPassengers = useCallback(async () => {
    if (!trip?.id) return
    setLoading(true); setErr('')
    const { data, error } = await supabase
      .from('passengers')
      .select('id, full_name, national_id, phone, nationality, seat_no, boarding_point, status, notes, gender, is_family, ticket_code, boarded_at, checked_in_at, payment_ref, profile_id, bus_id, created_at')
      .eq('trip_id', trip.id)
      .order('seat_no', { ascending: true, nullsFirst: false })
    if (error) setErr('تعذّر تحميل المعتمرين: ' + error.message)
    else setPassengers(data ?? [])
    setLoading(false)

    // قائمة الانتظار للرحلة
    const { data: w } = await supabase
      .from('waitlist').select('id, profile_id, full_name, phone, notified_at, created_at')
      .eq('trip_id', trip.id).order('created_at', { ascending: true })
    setWaitlist(w ?? [])

    // باصات الرحلة (لتعدّد الباصات)
    const bs = await loadTripBuses(trip.id)
    setBuses(bs)
    setMapBusId((cur) => (cur && bs.some((b) => b.id === cur) ? cur : bs[0]?.id ?? null))
  }, [trip])

  const reloadTrip = useCallback(async () => {
    if (!trip?.id) return
    const { data } = await supabase.from('trips').select('*').eq('id', trip.id).maybeSingle()
    if (data) setTrip(data)
    onTripChanged?.()
  }, [trip, onTripChanged])

  useEffect(() => { loadPassengers() }, [loadPassengers])

  // تحديثٌ حيٌّ: عند أي تغيّرٍ على passengers لهذه الرحلة، أعِد التحميل.
  useEffect(() => {
    if (!trip?.id) return
    const ch = supabase
      .channel(`pax-mgr:${trip.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passengers', filter: `trip_id=eq.${trip.id}` }, () => loadPassengers())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [trip?.id, loadPassengers])

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
  if (busEditOpen) {
    return (
      <BusEditor
        trip={trip}
        passengers={passengers}
        onClose={() => setBusEditOpen(false)}
        onSaved={() => { setBusEditOpen(false); reloadTrip() }}
      />
    )
  }
  if (ticketFor) {
    return (
      <Suspense fallback={<LazyLoading />}>
        <Ticket passenger={ticketFor} trip={trip} sub={sub} onClose={() => setTicketFor(null)} />
      </Suspense>
    )
  }
  if (scanMode) {
    return (
      <Suspense fallback={<LazyLoading />}>
        <Scanner trip={trip} mode={scanMode} onClose={() => setScanMode(null)} onUpdated={loadPassengers} />
      </Suspense>
    )
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
          <span className="tag info">{policyLabel(trip?.seating_policy)}</span>
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
          <button className="action info" style={{ flex: 1 }} onClick={() => setScanMode('board')}>
            <Icon name="qr" size={18} /> مسح الصعود
          </button>
          <button className="action warn" style={{ flex: 1 }} onClick={() => setScanMode('checkin')}>
            <Icon name="bed" size={18} /> مسح التسكين
          </button>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="action" style={{ flex: 1 }} onClick={() => setSeatMapOpen(true)}>
            <Icon name="seat" size={18} /> خريطة المقاعد
          </button>
          <button className="action" style={{ flex: 1 }} onClick={() => setBusEditOpen(true)}>
            <Icon name="settings" size={18} /> تعديل الباص
          </button>
        </div>
        <button className="action" onClick={() => setCrewOpen(true)}>
          <Icon name="bus" size={18} /> الباص والطاقم (للكشف)
        </button>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="action ok" style={{ flex: 1 }} onClick={() => setManifestOpen(true)}>
            <Icon name="manifest" size={18} /> الكشف الرسمي
          </button>
          <button className="action violet" style={{ flex: 1 }} onClick={() => setOffersOpen(true)} disabled={count === 0}>
            <Icon name="message" size={18} /> إرسال عرض
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
                  <div className="pax-name">
                    {p.full_name}
                    {p.profile_id && <span className="tag muted" style={{ fontSize: 9, padding: '1px 6px', marginInlineStart: 6 }}>ذاتي</span>}
                  </div>
                  <div className="pax-meta">
                    <span className="ltr">{p.national_id || '—'}</span>
                    <span>·</span>
                    <span className="ltr">{p.phone || '—'}</span>
                    {p.boarding_point && <><span>·</span><span>{p.boarding_point}</span></>}
                    {p.payment_ref && p.status === 'registered' && (
                      <><span>·</span><span style={{ color: 'var(--warn-ink)' }}>دفع بانتظار التأكيد: {p.payment_ref}</span></>
                    )}
                  </div>
                </div>
                <span className={`st ${STATUS_CLS[p.status] || 'muted'}`}>{STATUS_AR[p.status] || p.status}</span>
                <div className="pax-actions">
                  {p.payment_ref && p.status === 'registered' && (
                    <button className="icon-btn" title="تأكيد الدفع" onClick={async () => {
                      const { error } = await supabase.from('passengers').update({ status: 'paid' }).eq('id', p.id)
                      if (error) alert('تعذّر التأكيد: ' + error.message); else loadPassengers()
                    }}><Icon name="check" size={15} /></button>
                  )}
                  <button className="icon-btn" onClick={() => setTicketFor(p)} aria-label="التذكرة"><Icon name="qr" size={15} /></button>
                  <button className="icon-btn" onClick={() => openEdit(p)} aria-label="تعديل"><Icon name="edit" size={15} /></button>
                  <button className="icon-btn danger" onClick={() => removePax(p)} aria-label="حذف"><Icon name="trash" size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {waitlist.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>قائمة الانتظار</h3><span className="sub">({waitlist.length})</span>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: -4, marginBottom: 10 }}>
            عندما يتفرّغ مقعد، يُبلَّغ أوّل ٥ منتظرين تلقائيًّا.
          </p>
          <div className="pax-list">
            {waitlist.map((w, i) => (
              <div className="pax-row" key={w.id}>
                <div className="pax-seat">#{i + 1}</div>
                <div className="pax-main">
                  <div className="pax-name">{w.full_name || 'بانتظار'}</div>
                  <div className="pax-meta">
                    {w.phone && <span className="ltr">{w.phone}</span>}
                    {w.notified_at && <><span>·</span><span className="tag ok" style={{ fontSize: 10 }}>أُبلِغ</span></>}
                  </div>
                </div>
                <button className="icon-btn danger" onClick={async () => {
                  if (!window.confirm('إزالة هذا الشخص من قائمة الانتظار؟')) return
                  const { error } = await supabase.from('waitlist').delete().eq('id', w.id)
                  if (error) alert('تعذّر الحذف: ' + error.message); else loadPassengers()
                }}><Icon name="trash" size={15} /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      {paxOpen && (
        <PassengerFormModal
          open
          key={editingPax?.id || 'new'}
          passenger={editingPax}
          tripId={trip?.id}
          subscriberId={sub?.id}
          seatingPolicy={trip?.seating_policy}
          busRows={trip?.bus_rows}
          busBack={trip?.bus_back_row}
          buses={buses}
          passengers={passengers}
          defaultBoarding={trip?.boarding_point}
          onClose={() => setPaxOpen(false)}
          onSaved={() => { setPaxOpen(false); loadPassengers() }}
        />
      )}

      <BottomSheet
        open={seatMapOpen}
        onClose={() => setSeatMapOpen(false)}
        title="خريطة المقاعد"
        actions={<button className="btn btn-gold btn-block" onClick={() => setSeatMapOpen(false)}>تم</button>}
      >
        <p className="muted" style={{ fontSize: 13, marginTop: -8, marginBottom: 8, textAlign: 'center' }}>
          عرضٌ مباشرٌ للباص — يحدّث فور إضافة معتمرٍ أو نقل مقعده.
        </p>
        {buses.length > 1 && (
          <div className="bus-tabs" style={{ justifyContent: 'center' }}>
            {buses.map((b) => (
              <button key={b.id} type="button" className={`bus-tab ${b.id === mapBusId ? 'active' : ''}`}
                onClick={() => setMapBusId(b.id)}>
                <Icon name="bus" size={15} /> {busName(b)}
              </button>
            ))}
          </div>
        )}
        {(() => {
          const multi = buses.length > 1
          const active = buses.find((b) => b.id === mapBusId)
          const lay = multi && active ? busLayout(active)
            : { rows: trip?.bus_rows, back: trip?.bus_back_row, policy: trip?.seating_policy }
          const pax = multi ? passengers.filter((p) => p.bus_id === mapBusId) : passengers
          return <SeatMap policy={lay.policy} rows={lay.rows} back={lay.back} passengers={pax} readOnly />
        })()}
      </BottomSheet>

      {crewOpen && (
        <CrewFormModal
          open
          trip={trip}
          sub={sub}
          onClose={() => setCrewOpen(false)}
          onSaved={() => { setCrewOpen(false); reloadTrip() }}
        />
      )}

      <OffersSheet
        open={offersOpen}
        onClose={() => setOffersOpen(false)}
        passengers={passengers}
        trip={trip}
        sub={sub}
        msg={offerMsg}
        setMsg={setOfferMsg}
      />
    </>
  )
}

/* ---------- إرسال عرضٍ جماعيٍّ عبر واتساب/الإيميل ---------- */
function normalizePhone(p) {
  let d = String(p || '').replace(/[^\d]/g, '')
  if (!d) return ''
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0')) d = '966' + d.slice(1)        // محلّي سعودي
  else if (d.startsWith('5') && d.length === 9) d = '966' + d
  return d
}

function OffersSheet({ open, onClose, passengers, trip, sub, msg, setMsg }) {
  const withPhone = passengers.filter((p) => normalizePhone(p.phone))
  const defaultMsg = `السلام عليكم، من ${sub?.org_name || 'حملتنا'} بخصوص رحلة «${trip?.title || 'العمرة'}». `
  const text = (msg && msg.trim()) ? msg : defaultMsg

  function waOne(p) {
    const ph = normalizePhone(p.phone)
    if (!ph) return
    window.open(`https://wa.me/${ph}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }
  function mailAll() {
    // لا إيميل في سجلّ الراكب — نفتح رسالةً فارغةً بالنصّ للنسخ (احتياطي)
    window.open(`mailto:?subject=${encodeURIComponent('عرض ' + (sub?.org_name || 'الحملة'))}&body=${encodeURIComponent(text)}`, '_blank')
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="إرسال عرضٍ للمعتمرين"
      actions={<button className="btn btn-gold btn-block" onClick={onClose}>تم</button>}
    >
      <div className="form" style={{ marginTop: 0 }}>
        <div className="field">
          <label>نصّ العرض</label>
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={defaultMsg} />
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          اضغط على معتمرٍ لفتح محادثة واتساب جاهزةً بالنصّ — {withPhone.length} معتمرٍ لديهم رقم جوال.
        </p>
        <button className="btn btn-ghost btn-block btn-sm" onClick={mailAll}>
          <Icon name="message" size={15} /> فتح رسالة بريدٍ بالنصّ
        </button>
        <div className="pax-list" style={{ marginTop: 6 }}>
          {withPhone.length === 0 ? (
            <div className="empty">لا يوجد معتمرون بأرقام جوال.</div>
          ) : withPhone.map((p) => (
            <button type="button" className="pax-row" key={p.id} style={{ cursor: 'pointer', textAlign: 'start' }} onClick={() => waOne(p)}>
              <div className="pax-seat"><Icon name="message" size={15} /></div>
              <div className="pax-main">
                <div className="pax-name">{p.full_name}</div>
                <div className="pax-meta ltr">{p.phone}</div>
              </div>
              <Icon name="external" size={15} />
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  )
}
