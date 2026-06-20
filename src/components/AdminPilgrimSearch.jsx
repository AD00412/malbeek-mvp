import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'

const STATUS_AR = { registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة' }
const STATUS_TONE = { registered: 'muted', paid: 'ok', boarded: 'info', checked_in: 'warn' }

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

  const safeQ = q.replace(/[,()%*:]/g, '').trim()

  return (
    <div className="mlk-tab">
      <header className="mlk-tab-head">
        <h1 className="mlk-tab-title">بحث المعتمرين</h1>
        {rows.length > 0 && <span className="mlk-tab-count">{rows.length} نتيجة</span>}
      </header>

      <div className="field search" style={{ margin: 0 }}>
        <span className="ic"><Icon name="search" size={17} /></span>
        <input autoFocus type="text"
               placeholder="الاسم / رقم الهوية / الجوال — في كلّ الحملات"
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? <div className="mlk-empty">جارٍ البحث…</div> :
       safeQ.length < 2 ? <div className="mlk-empty">اكتب حرفين على الأقلّ — يَبحث في كلّ المعتمرين عبر كلّ الحملات</div> :
       rows.length === 0 && searched ? <div className="mlk-empty">لا معتمرَ يُطابق بحثك في أيّ حملة</div> :
       <ul className="mlk-list">
         {rows.map((p) => (
           <li key={p.id} className="mlk-list-row">
             <div className="mlk-list-body">
               <div className="mlk-list-meta">
                 <span className={`mlk-pill ${STATUS_TONE[p.status] || 'muted'}`}>{STATUS_AR[p.status] || p.status}</span>
                 {p.seat_no && <span className="mlk-pill muted">مقعد {p.seat_no}</span>}
                 <span style={{ marginInlineStart: 'auto', color: 'var(--em-500)', fontWeight: 600, fontSize: 12 }}>
                   {p.subscribers?.org_name || 'حملة'}
                 </span>
               </div>
               <div className="mlk-list-title">{p.full_name || '—'}</div>
               <div className="mlk-list-meta">
                 <span className="ltr">{p.national_id || '—'}</span>
                 <span>·</span>
                 <span className="ltr">{p.phone || '—'}</span>
                 <span>·</span>
                 <span>{p.trips?.title || 'رحلة'}</span>
               </div>
             </div>
           </li>
         ))}
       </ul>}
    </div>
  )
}
