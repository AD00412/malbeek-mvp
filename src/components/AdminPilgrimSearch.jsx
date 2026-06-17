import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'

const STATUS_AR = { registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة' }
const STATUS_CLS = { registered: 'muted', paid: 'ok', boarded: 'info', checked_in: 'warn' }

/**
 * بحثٌ عبر المنصّة كلّها — للإدارة فقط (RLS يمنح الأدمن قراءة كلّ المعتمرين).
 * يُظهر اسم الحملة لكلّ معتمرٍ لتمييز السجلات المتشابهة.
 */
export default function AdminPilgrimSearch() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    const safe = q.replace(/[,()%*:]/g, '').trim()
    if (safe.length < 2) { setRows([]); setSearched(false); return }
    let alive = true
    setLoading(true)
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('passengers')
        .select('id, full_name, national_id, phone, seat_no, status, trip_id, subscriber_id, trips:trip_id(title), subscribers:subscriber_id(org_name)')
        .or(`full_name.ilike.%${safe}%,national_id.ilike.%${safe}%,phone.ilike.%${safe}%`)
        .order('created_at', { ascending: false })
        .limit(60)
      if (!alive) return
      setRows(data ?? [])
      setSearched(true)
      setLoading(false)
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>بحث المعتمرين — كامل المنصّة</h3>
      </div>

      <div className="field search" style={{ marginBottom: 8 }}>
        <span className="ic"><Icon name="search" size={17} /></span>
        <input autoFocus type="text" placeholder="الاسم / رقم الهوية / الجوال — في كلّ الحملات"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? (
        <div className="empty">جارٍ البحث…</div>
      ) : q.replace(/[,()%*:]/g, '').trim().length < 2 ? (
        <div className="muted" style={{ fontSize: 13, textAlign: 'center', padding: 14 }}>اكتب حرفين على الأقلّ — يبحث في كلّ المعتمرين عبر كلّ الحملات.</div>
      ) : rows.length === 0 && searched ? (
        <div className="empty"><div className="em-ttl">لا نتائج</div><div>لا معتمرَ يطابق بحثك في أيّ حملة.</div></div>
      ) : (
        <div className="pax-list">
          {rows.map((p) => (
            <div className="pax-row" key={p.id}>
              <div className="pax-seat">{p.seat_no || '—'}</div>
              <div className="pax-main">
                <div className="pax-name">{p.full_name || '—'}</div>
                <div className="pax-meta">
                  <span className="ltr">{p.national_id || '—'}</span>
                  <span>·</span>
                  <span>{p.phone || '—'}</span>
                </div>
                <div className="pax-meta" style={{ marginTop: 2 }}>
                  <span style={{ color: 'var(--gd-300)' }}>{p.subscribers?.org_name || 'حملة'}</span>
                  <span>·</span>
                  <span>{p.trips?.title || 'رحلة'}</span>
                </div>
              </div>
              <span className={`st ${STATUS_CLS[p.status] || 'muted'}`}>{STATUS_AR[p.status] || p.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
