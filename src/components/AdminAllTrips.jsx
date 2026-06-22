import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'

const STATUS_LABEL = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', done: 'منتهية' }
const STATUS_TONE  = { draft: 'muted', open: 'ok', closed: 'warn', done: 'info' }

function fmtDate(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: '2-digit' }) }
  catch { return '—' }
}

/**
 * كل الرحلات في المنصة — للإدارة فقط (RLS يحرس).
 * فيها بحث بالعنوان/الحملة + فلتر حالة + فرز.
 */
export default function AdminAllTrips() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [stFilter, setStFilter] = useState('all')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('trips')
        .select('id, title, route_from, route_to, depart_at, capacity, status, created_at, subscriber_id, subscribers:subscriber_id(org_name)')
        .order('depart_at', { ascending: false, nullsFirst: false })
        .limit(500)
      if (!alive) return
      setRows(data ?? [])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    const safe = q.trim().toLowerCase()
    return rows.filter((t) => {
      if (stFilter !== 'all' && t.status !== stFilter) return false
      if (!safe) return true
      const blob = `${t.title || ''} ${t.subscribers?.org_name || ''} ${t.route_from || ''} ${t.route_to || ''}`.toLowerCase()
      return blob.includes(safe)
    })
  }, [rows, q, stFilter])

  return (
    <div className="mlk-tab">
      <header className="mlk-tab-head">
        <h1 className="mlk-tab-title">كل الرحلات</h1>
        <span className="mlk-tab-count">{rows.length} رحلة</span>
      </header>

      <div className="field search" style={{ margin: 0 }}>
        <span className="ic"><Icon name="search" size={16} /></span>
        <input type="text" placeholder="ابحث بالعنوان أو الحملة أو المسار…"
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="mlk-filter">
        {[
          { k: 'all',    l: 'الكل',    n: rows.length },
          { k: 'open',   l: 'مفتوحة',   n: rows.filter((t) => t.status === 'open').length },
          { k: 'closed', l: 'مغلقة',    n: rows.filter((t) => t.status === 'closed').length },
          { k: 'done',   l: 'منتهية',   n: rows.filter((t) => t.status === 'done').length },
          { k: 'draft',  l: 'مسودة',    n: rows.filter((t) => t.status === 'draft').length },
        ].map((x) => (
          <button key={x.k} className={`mlk-fchip ${stFilter === x.k ? 'active' : ''}`}
                  onClick={() => setStFilter(x.k)}>{x.l} ({x.n})</button>
        ))}
      </div>

      {loading ? <SkeletonList count={4} /> :
       filtered.length === 0 ? <div className="mlk-empty">لا رحلات تطابق هذا البحث/الفلتر</div> :
       <ul className="mlk-list">
         {filtered.map((t) => (
           <li key={t.id} className="mlk-list-row">
             <div className="mlk-list-body">
               <div className="mlk-list-meta">
                 <span className={`mlk-pill ${STATUS_TONE[t.status] || 'muted'}`}>{STATUS_LABEL[t.status] || t.status}</span>
                 <span style={{ color: 'var(--em-500)', fontWeight: 600 }}>{t.subscribers?.org_name || '—'}</span>
                 <span className="mlk-list-time" style={{ marginInlineStart: 'auto' }}>{fmtDate(t.depart_at)}</span>
               </div>
               <div className="mlk-list-title">{t.title || '—'}</div>
               <div className="mlk-list-meta">
                 <span>{(t.route_from || '—')} ← {(t.route_to || '—')}</span>
                 <span>·</span>
                 <span>سعة {t.capacity || '—'}</span>
               </div>
             </div>
           </li>
         ))}
       </ul>}
    </div>
  )
}
