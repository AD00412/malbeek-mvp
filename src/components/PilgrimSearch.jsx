import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import Icon from './Icon'

const STATUS_AR = { registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة' }
const STATUS_CLS = { registered: 'muted', paid: 'ok', boarded: 'info', checked_in: 'warn' }

/**
 * بحثٌ عن معتمرٍ عبر كلّ رحلات الحملة (RLS تحرس النطاق).
 * @param {boolean} open
 * @param {string}  subscriberId
 * @param {Function} onClose
 * @param {Function} onOpenTrip   (tripId) => void — يفتح رحلة المعتمر
 */
export default function PilgrimSearch({ open, subscriberId, onClose, onOpenTrip }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => { if (!open) { setQ(''); setRows([]); setSearched(false) } }, [open])

  useEffect(() => {
    if (!open || !subscriberId) return
    // تطهيرٌ من رموز فلاتر PostgREST لتفادي كسر الاستعلام (الـ RLS تحرس النطاق أصلًا)
    const safe = q.replace(/[,()%*:]/g, '').trim()
    if (safe.length < 2) { setRows([]); setSearched(false); return }
    let alive = true
    setLoading(true)
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('passengers')
        .select('id, full_name, national_id, phone, seat_no, status, trip_id, trips:trip_id(title)')
        .eq('subscriber_id', subscriberId)
        .or(`full_name.ilike.%${safe}%,national_id.ilike.%${safe}%,phone.ilike.%${safe}%`)
        .order('created_at', { ascending: false })
        .limit(40)
      if (!alive) return
      setRows(data ?? [])
      setSearched(true)
      setLoading(false)
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q, open, subscriberId])

  return (
    <BottomSheet open={open} onClose={onClose} title="بحثٌ عن معتمر">
      <div className="field search" style={{ marginBottom: 10 }}>
        <span className="ic"><Icon name="search" size={17} /></span>
        <input autoFocus type="text" placeholder="الاسم / رقم الهوية / الجوال — عبر كلّ الرحلات"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? (
        <div className="empty">جارٍ البحث…</div>
      ) : q.replace(/[,()%*:]/g, '').trim().length < 2 ? (
        <div className="muted" style={{ fontSize: 13, textAlign: 'center', padding: 12 }}>اكتب حرفين على الأقلّ للبحث.</div>
      ) : rows.length === 0 && searched ? (
        <div className="empty"><div className="em-ttl">لا نتائج</div><div>لا معتمرَ يطابق بحثك في أيّ رحلة.</div></div>
      ) : (
        <div className="pax-list">
          {rows.map((p) => (
            <button key={p.id} type="button" className="pax-row" style={{ cursor: 'pointer', textAlign: 'start' }}
              onClick={() => { if (p.trip_id) { onOpenTrip?.(p.trip_id); onClose?.() } }}>
              <div className="pax-seat">{p.seat_no || '—'}</div>
              <div className="pax-main">
                <div className="pax-name">{p.full_name || '—'}</div>
                <div className="pax-meta">
                  <span className="ltr">{p.national_id || '—'}</span>
                  <span>·</span>
                  <span>{p.trips?.title || 'رحلة'}</span>
                </div>
              </div>
              <span className={`st ${STATUS_CLS[p.status] || 'muted'}`}>{STATUS_AR[p.status] || p.status}</span>
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  )
}
