import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { translateRpcError } from '../lib/rpcErrors'
import Icon from './Icon'
import BottomSheet from './BottomSheet'

const ROOM_GENDER = [
  { v: 'mixed',  t: 'مختلطة (عائلات)' },
  { v: 'male',   t: 'رجال' },
  { v: 'female', t: 'نساء' },
]

/**
 * مديرُ الفنادق والغرف — شاشةٌ كاملة. يدير فنادق رحلةٍ معيّنة + غرفها + إسناد
 * المعتمرين للغرف. يحترم حدّ السعة وتوافق الجنس عبر تريغر القاعدة.
 */
export default function HotelsManager({ trip, sub, passengers = [], onClose, onChanged }) {
  const [hotels, setHotels] = useState([])
  const [rooms, setRooms] = useState([])
  const [activeHotelId, setActiveHotelId] = useState(null)
  const [hotelOpen, setHotelOpen] = useState(false)
  const [editingHotel, setEditingHotel] = useState(null)
  const [roomOpen, setRoomOpen] = useState(false)
  const [editingRoom, setEditingRoom] = useState(null)
  const [picking, setPicking] = useState(null)        // {room}
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!trip?.id) return
    const [h, r] = await Promise.all([
      supabase.from('hotels').select('*').eq('trip_id', trip.id).order('created_at', { ascending: true }),
      supabase.from('hotel_rooms').select('*').eq('trip_id', trip.id).order('room_number', { ascending: true }),
    ])
    const hs = h.data ?? []
    setHotels(hs)
    setRooms(r.data ?? [])
    setActiveHotelId((cur) => (cur && hs.some((x) => x.id === cur) ? cur : hs[0]?.id ?? null))
    setLoading(false)
  }, [trip])

  useEffect(() => { load() }, [load])

  const activeHotel = hotels.find((h) => h.id === activeHotelId) || null
  const hotelRooms = useMemo(() => rooms.filter((r) => r.hotel_id === activeHotelId), [rooms, activeHotelId])
  // عدد ساكني كل غرفة (من passengers الحاليّين)
  const occupancy = useMemo(() => {
    const m = new Map()
    for (const p of passengers) if (p.room_id) m.set(p.room_id, (m.get(p.room_id) || 0) + 1)
    return m
  }, [passengers])
  const passengersByRoom = useMemo(() => {
    const m = new Map()
    for (const p of passengers) if (p.room_id) {
      const arr = m.get(p.room_id) || []
      arr.push(p); m.set(p.room_id, arr)
    }
    return m
  }, [passengers])
  const unassigned = passengers.filter((p) => !p.room_id)

  async function removeHotel(h) {
    if (!window.confirm(`حذف فندق «${h.name}» وكلّ غرفه؟ سيُلغى إسناد ساكنيه.`)) return
    const { error } = await supabase.from('hotels').delete().eq('id', h.id)
    if (error) { setErr(translateRpcError(error)); return }
    onChanged?.(); load()
  }
  async function removeRoom(r) {
    if (!window.confirm(`حذف غرفة ${r.room_number}؟`)) return
    const { error } = await supabase.from('hotel_rooms').delete().eq('id', r.id)
    if (error) { setErr(translateRpcError(error)); return }
    onChanged?.(); load()
  }
  async function assignPassenger(roomId, passengerId) {
    setErr('')
    const { error } = await supabase.from('passengers').update({ room_id: roomId }).eq('id', passengerId)
    if (error) { setErr(translateRpcError(error)); return false }
    onChanged?.()
    return true
  }
  async function unassign(p) {
    const { error } = await supabase.from('passengers').update({ room_id: null }).eq('id', p.id)
    if (error) { setErr(translateRpcError(error)); return }
    onChanged?.()
  }

  return (
    <div className="manifest-overlay">
      <div className="manifest-toolbar no-print">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <Icon name="arrowRight" size={16} /> رجوع
        </button>
        <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 900, color: 'var(--cr-50)' }}>
          الفنادق والتسكين
        </div>
        <button className="btn btn-gold btn-sm" onClick={() => { setEditingHotel(null); setHotelOpen(true) }}>
          <Icon name="plus" size={16} /> فندق جديد
        </button>
      </div>

      <div className="manifest-scroll" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 14 }}>
        {err && <div className="alert err">{err}</div>}
        {loading ? (
          <div className="empty">جارٍ التحميل…</div>
        ) : hotels.length === 0 ? (
          <div className="empty">
            <div className="em-ttl">لا توجد فنادقُ بعد</div>
            <div>أضِف فندقَك الأوّل لتبدأ التسكين.</div>
            <button className="btn btn-gold" style={{ marginTop: 12 }} onClick={() => { setEditingHotel(null); setHotelOpen(true) }}>
              <Icon name="plus" size={16} /> فندق جديد
            </button>
          </div>
        ) : (
          <>
            {/* شرائح الفنادق */}
            <div className="bus-tabs" style={{ flexWrap: 'wrap' }}>
              {hotels.map((h) => (
                <button key={h.id} type="button"
                  className={`bus-tab ${h.id === activeHotelId ? 'active' : ''}`}
                  onClick={() => setActiveHotelId(h.id)}>
                  <Icon name="bed" size={15} /> {h.name}
                </button>
              ))}
            </div>

            {/* بطاقة الفندق النشِط */}
            {activeHotel && (
              <section className="panel">
                <div className="panel-head">
                  <h3>{activeHotel.name}</h3>
                  <span className="sub">{activeHotel.city || '—'}</span>
                  <span style={{ flex: 1 }} />
                  <button className="icon-btn" title="تعديل" onClick={() => { setEditingHotel(activeHotel); setHotelOpen(true) }}>
                    <Icon name="edit" size={15} />
                  </button>
                  <button className="icon-btn danger" title="حذف" onClick={() => removeHotel(activeHotel)}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {activeHotel.distance_text && <>{activeHotel.distance_text} · </>}
                  {activeHotel.check_in && <>الدخول: {fmtDate(activeHotel.check_in)} </>}
                  {activeHotel.check_out && <> · الخروج: {fmtDate(activeHotel.check_out)}</>}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 8 }}>
                  <span className="sec-label" style={{ flex: 1, margin: 0 }}>الغرف ({hotelRooms.length})</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setEditingRoom(null); setRoomOpen(true) }}>
                    <Icon name="plus" size={14} /> غرفة
                  </button>
                </div>

                {hotelRooms.length === 0 ? (
                  <div className="muted" style={{ fontSize: 13 }}>أضف غرفًا لتبدأ التسكين.</div>
                ) : (
                  <div className="rooms-grid">
                    {hotelRooms.map((r) => {
                      const used = occupancy.get(r.id) || 0
                      const list = passengersByRoom.get(r.id) || []
                      const full = used >= r.capacity
                      return (
                        <div key={r.id} className={`room-card ${full ? 'full' : ''}`}>
                          <div className="room-head">
                            <div className="room-num">غرفة {r.room_number}</div>
                            <span className={`tag ${r.gender === 'male' ? 'info' : r.gender === 'female' ? 'warn' : 'muted'}`} style={{ fontSize: 10 }}>
                              {r.gender === 'male' ? 'رجال' : r.gender === 'female' ? 'نساء' : 'عائلات'}
                            </span>
                            <span style={{ flex: 1 }} />
                            <button className="icon-btn" title="تعديل" onClick={() => { setEditingRoom(r); setRoomOpen(true) }}>
                              <Icon name="edit" size={13} />
                            </button>
                            <button className="icon-btn danger" title="حذف" onClick={() => removeRoom(r)}>
                              <Icon name="trash" size={13} />
                            </button>
                          </div>
                          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                            {used} / {r.capacity}
                          </div>
                          <div className="room-occupants">
                            {list.length === 0 ? (
                              <div className="muted" style={{ fontSize: 12 }}>فارغة</div>
                            ) : list.map((p) => (
                              <div key={p.id} className="occ-row">
                                <span className="occ-name">{p.full_name}</span>
                                <button className="icon-btn danger" title="إخراج" onClick={() => unassign(p)}>
                                  <Icon name="trash" size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                          {!full && (
                            <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => setPicking({ room: r })}>
                              <Icon name="plus" size={13} /> إضافة معتمر
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )}

            {/* غير المسكَّنين */}
            <section className="panel">
              <div className="panel-head">
                <h3>غير المسكَّنين</h3>
                <span className="sub">({unassigned.length})</span>
              </div>
              {unassigned.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>كلّ المعتمرين مسكَّنون ✓</div>
              ) : (
                <div className="chip-list">
                  {unassigned.map((p) => (
                    <span key={p.id} className={`chip ${p.gender === 'female' ? 'warn' : 'info'}`}>
                      {p.full_name}
                    </span>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {hotelOpen && (
        <HotelFormSheet
          open
          hotel={editingHotel}
          tripId={trip?.id}
          subscriberId={sub?.id}
          onClose={() => setHotelOpen(false)}
          onSaved={() => { setHotelOpen(false); onChanged?.(); load() }}
        />
      )}
      {roomOpen && activeHotelId && (
        <RoomFormSheet
          open
          room={editingRoom}
          hotelId={activeHotelId}
          tripId={trip?.id}
          subscriberId={sub?.id}
          onClose={() => setRoomOpen(false)}
          onSaved={() => { setRoomOpen(false); onChanged?.(); load() }}
        />
      )}
      {picking && (
        <PickPassenger
          room={picking.room}
          candidates={unassigned}
          onClose={() => setPicking(null)}
          onPick={async (id) => {
            const ok = await assignPassenger(picking.room.id, id)
            if (ok) setPicking(null)
          }}
        />
      )}
    </div>
  )
}

/* ------------------ مودالات الفندق والغرفة ------------------ */
function HotelFormSheet({ open, hotel, tripId, subscriberId, onClose, onSaved }) {
  const isEdit = Boolean(hotel?.id)
  const [f, setF] = useState({
    name: hotel?.name ?? '',
    city: hotel?.city ?? 'مكة المكرمة',
    check_in: hotel?.check_in ?? '',
    check_out: hotel?.check_out ?? '',
    distance_text: hotel?.distance_text ?? '',
    notes: hotel?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))

  async function save() {
    if (busy) return
    if (!f.name.trim()) { setErr('اسم الفندق مطلوب.'); return }
    setBusy(true); setErr('')
    const payload = {
      name: f.name.trim(),
      city: f.city.trim() || null,
      check_in: f.check_in || null,
      check_out: f.check_out || null,
      distance_text: f.distance_text.trim() || null,
      notes: f.notes.trim() || null,
    }
    const { error } = isEdit
      ? await supabase.from('hotels').update(payload).eq('id', hotel.id)
      : await supabase.from('hotels').insert({ ...payload, trip_id: tripId, subscriber_id: subscriberId })
    setBusy(false)
    if (error) { setErr(translateRpcError(error)); return }
    onSaved?.()
  }

  return (
    <BottomSheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title={isEdit ? 'تعديل الفندق' : 'فندق جديد'}
      actions={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        <button className="btn btn-gold" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : 'حفظ'}</button>
      </>}
    >
      <div className="form" style={{ marginTop: 0 }}>
        <div className="field">
          <label>اسم الفندق *</label>
          <input type="text" placeholder="مثال: فندق المكّيّ" value={f.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>المدينة</label>
            <select value={f.city} onChange={(e) => set('city', e.target.value)}>
              <option value="مكة المكرمة">مكة المكرمة</option>
              <option value="المدينة المنورة">المدينة المنورة</option>
              <option value="جدة">جدة</option>
            </select>
          </div>
          <div className="field">
            <label>المسافة من الحرم (اختياري)</label>
            <input type="text" placeholder="مثال: ٢٠٠م" value={f.distance_text} onChange={(e) => set('distance_text', e.target.value)} />
          </div>
        </div>
        <div className="grid-2">
          <div className="field ltr">
            <label>الدخول</label>
            <input type="date" value={f.check_in} onChange={(e) => set('check_in', e.target.value)} />
          </div>
          <div className="field ltr">
            <label>الخروج</label>
            <input type="date" value={f.check_out} onChange={(e) => set('check_out', e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>ملاحظات (اختياري)</label>
          <textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {err && <div className="alert err">{err}</div>}
      </div>
    </BottomSheet>
  )
}

function RoomFormSheet({ open, room, hotelId, tripId, subscriberId, onClose, onSaved }) {
  const isEdit = Boolean(room?.id)
  const [f, setF] = useState({
    room_number: room?.room_number ?? '',
    capacity: room?.capacity ?? 2,
    gender: room?.gender ?? 'mixed',
    notes: room?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))

  async function save() {
    if (busy) return
    if (!f.room_number.trim()) { setErr('رقم الغرفة مطلوب.'); return }
    setBusy(true); setErr('')
    const payload = {
      room_number: f.room_number.trim(),
      capacity: Math.max(1, Number(f.capacity) || 1),
      gender: f.gender,
      notes: f.notes.trim() || null,
    }
    const { error } = isEdit
      ? await supabase.from('hotel_rooms').update(payload).eq('id', room.id)
      : await supabase.from('hotel_rooms').insert({ ...payload, hotel_id: hotelId, trip_id: tripId, subscriber_id: subscriberId })
    setBusy(false)
    if (error) { setErr(translateRpcError(error)); return }
    onSaved?.()
  }

  return (
    <BottomSheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title={isEdit ? 'تعديل غرفة' : 'غرفة جديدة'}
      actions={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        <button className="btn btn-gold" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : 'حفظ'}</button>
      </>}
    >
      <div className="form" style={{ marginTop: 0 }}>
        <div className="grid-2">
          <div className="field">
            <label>رقم الغرفة *</label>
            <input type="text" placeholder="مثال: 305" value={f.room_number} onChange={(e) => set('room_number', e.target.value)} />
          </div>
          <div className="field ltr">
            <label>السعة</label>
            <input type="number" min="1" max="20" value={f.capacity} onChange={(e) => set('capacity', e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>نوع الغرفة</label>
          <select value={f.gender} onChange={(e) => set('gender', e.target.value)}>
            {ROOM_GENDER.map((g) => <option key={g.v} value={g.v}>{g.t}</option>)}
          </select>
        </div>
        <div className="field">
          <label>ملاحظات</label>
          <textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {err && <div className="alert err">{err}</div>}
      </div>
    </BottomSheet>
  )
}

function PickPassenger({ room, candidates, onClose, onPick }) {
  const filtered = candidates.filter((p) => room.gender === 'mixed' || p.gender === room.gender)
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={`إسناد لغرفة ${room.room_number}`}
      actions={<button className="btn btn-gold btn-block" onClick={onClose}>إلغاء</button>}
    >
      {filtered.length === 0 ? (
        <div className="empty">
          <div className="em-ttl">لا معتمرين متاحين</div>
          <div>{candidates.length > 0 ? 'الموجودون لا يطابقون نوع الغرفة.' : 'جميع المعتمرين مسكَّنون.'}</div>
        </div>
      ) : (
        <div className="pax-list">
          {filtered.map((p) => (
            <button key={p.id} type="button" className="pax-row" onClick={() => onPick(p.id)} style={{ cursor: 'pointer', textAlign: 'start' }}>
              <div className="pax-seat">
                <Icon name={p.gender === 'female' ? 'customers' : 'customers'} size={15} />
              </div>
              <div className="pax-main">
                <div className="pax-name">{p.full_name}</div>
                <div className="pax-meta">
                  {p.gender === 'female' ? 'أنثى' : 'ذكر'}
                  {p.seat_no && <> · مقعد {p.seat_no}</>}
                </div>
              </div>
              <Icon name="check" size={15} />
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  )
}

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return '—' }
}
